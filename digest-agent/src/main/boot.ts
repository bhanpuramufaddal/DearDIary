/**
 * Boot orchestration.
 *
 * Sequence:
 *   1. Load config + open DB.
 *   2. Resolve test-mode env.
 *   3. Construct clock and bus.
 *   4. Register all durable subscribers (mind dispatcher) BEFORE replay.
 *   5. bus.replayDurableSubscribers() — drains any backlog from the previous run.
 *   6. Start schedulers (reminders, diary, profile watcher).
 *   7. Seed _principal anchor via cold-start if missing.
 *   8. Open the gates: tunnel + webhook server.
 *   9. Start persona emulator (test mode only).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, type Db } from './db/index.js';
import { applyMigrations } from './db/migrate.js';
import { seedHousePlays } from './db/seedPlays.js';
import { seedPrompts } from './db/seedPrompts.js';
import { initLangfuse, shutdownLangfuse } from './telemetry/langfuse.js';
import { migrationsDir } from './db/migrations-path.js';
import { Bus } from './bus.js';
import { AdjustableClock, WallClock, type Clock } from './clock.js';
import { createPersonaClockDriver } from './test/personaClockDriver.js';
import { configExists, defaultConfigPath, loadConfig } from './config.js';
import { createTunnelManager, type TunnelManager } from './webhook/tunnel.js';
import { createWebhookServer, type WebhookServer } from './webhook/server.js';
import { createReminderScheduler, type ReminderScheduler } from './scheduler/reminders.js';
import { createDiaryScheduler, type DiaryScheduler } from './scheduler/diary.js';
import { createProfileWatcher, type ProfileWatcher } from './scheduler/profileWatcher.js';
import { createMindDispatcher, type MindDispatcher } from './dispatcher/mind.js';
import { createDiaryDispatcher, type DiaryDispatcher } from './dispatcher/diary.js';
import {
  createColdStartDispatcher,
  type ColdStartDispatcher,
} from './dispatcher/coldStart.js';
import {
  createExecutionDispatcher,
  type ExecutionDispatcher,
} from './dispatcher/execution.js';
import { createEventRelay, type EventRelay } from './dispatcher/eventRelay.js';
import { createWindowManager, type WindowManager } from './windows.js';
import { createIpcHandlers, type IpcHandlers } from './ipc.js';
import {
  substrateServerPath,
  personaEmailServerPath,
  personaCalendarServerPath,
  personaNotesServerPath,
} from './runtime-paths.js';
import { resolveTestMode } from './testMode.js';
import {
  createPersonaEmulator,
  resolvePersonaDbPath,
  type PersonaEmulator,
} from './test/personaEmulator.js';
import type { AppConfig } from '@shared/types/config.js';

let db: Db | null = null;
let bus: Bus | null = null;
let webhookServer: WebhookServer | null = null;
let tunnel: TunnelManager | null = null;
let reminderScheduler: ReminderScheduler | null = null;
let diaryScheduler: DiaryScheduler | null = null;
let profileWatcher: ProfileWatcher | null = null;
let mindDispatcher: MindDispatcher | null = null;
let diaryDispatcher: DiaryDispatcher | null = null;
let coldStartDispatcher: ColdStartDispatcher | null = null;
let executionDispatcher: ExecutionDispatcher | null = null;
let eventRelay: EventRelay | null = null;
let windowManager: WindowManager | null = null;
let ipcHandlers: IpcHandlers | null = null;
let personaEmulator: PersonaEmulator | null = null;
let config: AppConfig | null = null;

export async function boot(): Promise<void> {
  // Initialize Langfuse OTel pipeline before anything that might create spans.
  // No-op if LANGFUSE_PUBLIC_KEY isn't set.
  initLangfuse();

  config = loadConfig({ path: process.env['DIGEST_CONFIG'] });

  // DIGEST_DIR env var is a global override for dev/test — it shifts the DB
  // path, the profile watcher target, the logs dir, etc.
  if (process.env['DIGEST_DIR']) {
    const dir = process.env['DIGEST_DIR'];
    config = { ...config, digest_dir: dir, log_dir: join(dir, 'logs') };
  }
  const dbPath = join(config.digest_dir, 'digest.db');

  db = openDatabase(dbPath);
  const { applied, latest } = applyMigrations(db, migrationsDir());
  const seededPlays = seedHousePlays(db);
  console.log(`[boot] seeded ${seededPlays} house play(s) into the plays table`);
  const seededPrompts = seedPrompts(db, config.digest_dir);
  console.log(`[boot] seeded ${seededPrompts} prompt(s) into the prompts table`);

  // ────────────────────────────────────────────────────────────────────
  // Test mode resolution. Throws on misconfiguration — no silent fallback
  // to "production with looser auth" if env vars are partially set.
  // ────────────────────────────────────────────────────────────────────
  const testEnv = resolveTestMode(process.env, config);

  // Clock. Default WallClock; test mode uses AdjustableClock driven by
  // persona-emulator event arrivals. The persona-clock driver is wired
  // below after the bus exists.
  //
  // SKIP_DAYS: when configured, the clock starts at clockStart + skipDays so
  // that schedulers arming below see post-skip "now" and don't fire 5 days of
  // diary ticks at boot. The emulator filters the matching range of events.
  let clock: Clock;
  let adjustableClock: AdjustableClock | null = null;
  let personaSkipBefore: Date | null = null;
  let personaSkipAfter: Date | null = null;
  if (testEnv.testMode) {
    const effectiveStart =
      testEnv.personaSkipDays > 0
        ? new Date(testEnv.clockStart!.getTime() + testEnv.personaSkipDays * 86_400_000)
        : testEnv.clockStart!;
    adjustableClock = new AdjustableClock(effectiveStart);
    clock = adjustableClock;
    if (testEnv.personaSkipDays > 0) personaSkipBefore = effectiveStart;
    if (testEnv.personaMaxDays !== null) {
      personaSkipAfter = new Date(
        effectiveStart.getTime() + testEnv.personaMaxDays * 86_400_000,
      );
    }
  } else {
    clock = new WallClock();
  }

  bus = new Bus(db, { now: () => clock.now().toISOString() });

  // Persona-clock driver: feeds webhook event timestamps into the adjustable
  // clock so digest-agent's notion of "now" tracks the persona's timeline.
  // Registered BEFORE the dispatchers so the clock advances first (mind
  // invocations see the persona's "now" rather than wall-clock).
  if (adjustableClock) {
    createPersonaClockDriver(bus, adjustableClock).start();
  }

  // ────────────────────────────────────────────────────────────────────
  // 1. Register ALL durable subscribers BEFORE replay.
  //    The mind dispatcher is the durable serialized subscriber that drains
  //    backlog from the previous run. Diary and cold-start dispatchers are
  //    non-durable (missed ticks during downtime don't replay; the next
  //    schedule fire / profile mtime change covers them).
  // ────────────────────────────────────────────────────────────────────

  const subPath = substrateServerPath();

  // In test mode, wire the three persona-services MCPs (email / calendar /
  // notes) into mind, diary, AND cold-start so all three agents read the
  // persona's synthetic history via the same MCP surfaces they'd use against
  // real Gmail / Calendar / Notes in production.
  const personaServicesWiring =
    testEnv.testMode && testEnv.personaSlug
      ? {
          emailServerPath: personaEmailServerPath(),
          calendarServerPath: personaCalendarServerPath(),
          notesServerPath: personaNotesServerPath(),
          personaDbPath: resolvePersonaDbPath(testEnv.personaSlug),
        }
      : null;

  mindDispatcher = createMindDispatcher(config, bus, db, {
    substrateServerPath: subPath,
    clock,
    ...(personaServicesWiring ? { personaServices: personaServicesWiring } : {}),
  });
  mindDispatcher.start();

  diaryDispatcher = createDiaryDispatcher(config, bus, db, mindDispatcher, {
    substrateServerPath: subPath,
    clock,
    ...(personaServicesWiring ? { personaServices: personaServicesWiring } : {}),
  });
  diaryDispatcher.start();

  coldStartDispatcher = createColdStartDispatcher(config, bus, db, {
    substrateServerPath: subPath,
    clock,
    ...(personaServicesWiring ? { personaServices: personaServicesWiring } : {}),
  });
  coldStartDispatcher.start();

  executionDispatcher = createExecutionDispatcher(config, bus, db, {
    substrateServerPath: subPath,
    blocked: testEnv.executionBlocked,
  });
  executionDispatcher.start();

  // Window manager subscribes to the bus '*' early so renderer windows opened
  // later receive every event from the moment they open. We hand it the clock
  // so the diary's refresh-on-show IPC reflects the agent's "now".
  windowManager = createWindowManager(bus, () => clock.now());

  // Pre-create the diary window so a tray click is instant. Its spec has
  // autoShowOnReady: false → BrowserWindow loads the bundle and stays hidden
  // until the tray toggles it visible.
  windowManager.open('diary');

  // IPC handlers for the renderer (getDiary, addComment, addNote, fireTask, …).
  ipcHandlers = createIpcHandlers({
    bus,
    db,
    config,
    now: () => clock.now().toISOString(),
    onConfigSaved: async (next) => {
      // Hot-reload the in-memory config so IPC reads see the new value.
      config = next;
      console.log('[boot] config saved — some changes (tunnel kind, ports) require restart');
    },
    restartTunnel: async () => {
      if (tunnel) {
        await tunnel.stop();
        tunnel = createTunnelManager(config!, bus!);
        tunnel.start();
      }
    },
  });
  ipcHandlers.register();

  await bus.replayDurableSubscribers();

  // External event relay drains pending_bus_events (written by the surface MCP
  // subprocess running under the principal's Claude Code) and re-emits on the
  // in-process bus. The diary dispatcher's existing `schedule.diary_tick`
  // subscription picks up relay-fired ticks from `digest_run` naturally.
  //
  // Starts AFTER replay so any pending rows enqueued during downtime land
  // chronologically after the replayed events instead of interleaving with them.
  eventRelay = createEventRelay(db, bus);
  eventRelay.start();

  // ────────────────────────────────────────────────────────────────────
  // 2. Start schedulers FIRST — they subscribe to events but don't emit until
  //    explicit triggers (timer pops, profile.md change). Doing this before
  //    the webhook server / tunnel means a webhook event landing mid-boot
  //    has its reminder-table re-check subscription already in place.
  // ────────────────────────────────────────────────────────────────────

  reminderScheduler = createReminderScheduler(db, bus, { clock });
  reminderScheduler.start();

  diaryScheduler = createDiaryScheduler(config, bus, { clock });
  // In test mode the persona-emulator drives diary fires day-by-day after
  // each day's events drain — the time-based scheduler would race with
  // that loop (and fires in the system timezone, not the persona's), so
  // we leave it constructed but never start it. Production runs it as usual.
  if (!testEnv.testMode) {
    diaryScheduler.start();
  }
  const nextDiary = testEnv.testMode ? null : diaryScheduler.nextFire();

  profileWatcher = createProfileWatcher(config, bus);
  profileWatcher.start();

  // Seed `_principal` anchor at boot if it doesn't exist yet and profile.md is
  // present. Cold-start normally fires on profile.changed (a real file mtime
  // change), but a fresh install / fresh sandbox has the file existing on day
  // one — the watcher never sees it change, so cold-start never runs, and the
  // principal anchor stays missing. Trigger it explicitly here once.
  const profileMdPath = join(config.digest_dir, 'profile.md');
  const principalExists = !!db
    .prepare("SELECT 1 FROM anchors WHERE id = '_principal'")
    .get();
  if (!principalExists && existsSync(profileMdPath)) {
    // Block boot until cold-start finishes — day-1 events must not stream
    // against an unseeded substrate.
    console.log('[boot] _principal anchor missing; firing cold-start to seed.');
    const result = await coldStartDispatcher.fireWithRetry();
    if (!result.ok) {
      throw new Error(
        `[boot] cold-start failed after ${result.attempts} attempt(s): ${result.error ?? 'unknown'}`,
      );
    }
    console.log(`[boot] cold-start succeeded in ${result.attempts} attempt(s).`);
  }

  // ────────────────────────────────────────────────────────────────────
  // 3. Open the gates: tunnel first (establishes the public URL), then the
  //    webhook server (loopback bind; safe to listen even if tunnel is still
  //    handshaking — ngrok takes seconds, listen takes milliseconds).
  // ────────────────────────────────────────────────────────────────────

  // Tunnel is for inbound public webhooks (Gmail, GCal) — pointless in test
  // mode where the persona-emulator runs in-process.
  if (!testEnv.testMode) {
    tunnel = createTunnelManager(config, bus);
    tunnel.start();
  }

  // In test mode, force loopback bind so a misconfigured bind_host cannot
  // expose the (skeletal /health-only) webhook server publicly.
  const webhookConfig: AppConfig = testEnv.testMode
    ? { ...config, webhook: { ...config.webhook, bind_host: '127.0.0.1' } }
    : config;
  webhookServer = createWebhookServer(webhookConfig, bus);
  const { address } = await webhookServer.listen();
  console.log(`[boot] webhook server listening at ${address}`);

  // In-process persona emulator. Starts AFTER all subscribers are wired so
  // the first emitted event lands on a complete pipeline. Don't await — let
  // it stream on its own pace; shutdown stops it.
  if (testEnv.testMode) {
    personaEmulator = createPersonaEmulator(bus, {
      slug: testEnv.personaSlug!,
      rate: testEnv.personaRate!,
      ...(personaSkipBefore ? { skipBefore: personaSkipBefore } : {}),
      ...(personaSkipAfter ? { skipAfter: personaSkipAfter } : {}),
      // Strict sequencing: wait for cold-start, then day-by-day fire diary
      // at morning-of-day-in-persona-TZ → stream day's events → next day.
      strictSequence: {
        clock: adjustableClock!,
        coldStart: coldStartDispatcher,
        mind: mindDispatcher,
        diary: diaryDispatcher,
      },
    });
    console.log(
      `[boot] TEST MODE — clock=persona @ ${adjustableClock!.now().toISOString()}, ` +
        `persona=${testEnv.personaSlug}, rate=${testEnv.personaRate}, ` +
        (testEnv.personaSkipDays > 0 ? `skip=${testEnv.personaSkipDays}d, ` : '') +
        (testEnv.personaMaxDays !== null ? `max=${testEnv.personaMaxDays}d, ` : '') +
        `execution=${testEnv.executionBlocked ? 'blocked' : 'live'}, tunnel=off`,
    );
    void personaEmulator.start().catch((err: unknown) => {
      console.error('[persona-emulator] streaming failed:', err);
    });
  }

  console.log(
    `[boot] digest-agent ready — db at ${dbPath}, schema v${latest} ` +
      `(applied ${applied} migration(s) this boot), bus initialized, ` +
      `tunnel=${testEnv.testMode ? 'off (test mode)' : config.webhook.tunnel?.kind ?? 'external'}, ` +
      `next diary fire=${nextDiary ? nextDiary.toISOString() : 'none'}`,
  );

  // First-run: if no config existed on disk, surface the onboarding window.
  // In test mode we deliberately suppress this — DEFAULT_CONFIG is already
  // loaded in memory, DIGEST_DIR points at the sandbox, and onboarding would
  // just be friction for a non-interactive test run.
  if (!testEnv.testMode && !configExists()) {
    console.log(`[boot] no config at ${defaultConfigPath()} — opening onboarding window`);
    windowManager.open('onboarding');
  }
}

export function getDb(): Db {
  if (!db) throw new Error('database not initialized');
  return db;
}

export function getBus(): Bus {
  if (!bus) throw new Error('bus not initialized');
  return bus;
}

export function getConfig(): AppConfig {
  if (!config) throw new Error('config not loaded');
  return config;
}

export function getDispatchers(): {
  mind: MindDispatcher;
  diary: DiaryDispatcher;
  coldStart: ColdStartDispatcher;
  execution: ExecutionDispatcher;
} {
  if (
    !mindDispatcher ||
    !diaryDispatcher ||
    !coldStartDispatcher ||
    !executionDispatcher
  ) {
    throw new Error('dispatchers not initialized');
  }
  return {
    mind: mindDispatcher,
    diary: diaryDispatcher,
    coldStart: coldStartDispatcher,
    execution: executionDispatcher,
  };
}

export function getWindowManager(): WindowManager {
  if (!windowManager) throw new Error('window manager not initialized');
  return windowManager;
}

export async function shutdown(): Promise<void> {
  if (personaEmulator) personaEmulator.stop();
  if (ipcHandlers) ipcHandlers.unregister();
  if (windowManager) windowManager.closeAll();
  if (eventRelay) eventRelay.stop();
  if (profileWatcher) profileWatcher.stop();
  if (diaryScheduler) diaryScheduler.stop();
  if (reminderScheduler) reminderScheduler.stop();
  if (webhookServer) await webhookServer.close();
  if (tunnel) await tunnel.stop();
  if (db) db.close();
  // Flush Langfuse last so any final spans from teardown make it out.
  await shutdownLangfuse();
}
