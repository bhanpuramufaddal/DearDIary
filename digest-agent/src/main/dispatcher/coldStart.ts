/**
 * Cold-start dispatcher.
 *
 * Subscribes to `profile.changed` (emitted by the profile watcher). On fire,
 * runs a two-pass onboarding sequence:
 *
 *   1. seed   — reconstructs the substrate from profile.md + full history.
 *   2. validate — independent auditor: inventories what seed wrote, re-surveys
 *                 history, fills the gaps. Runs regardless of seed outcome.
 *
 * Both passes use the same tools (full substrate write surface + history MCPs)
 * and are driven by Claude Code's `/goal` directive, which keeps the agent
 * working until a coverage report appears in the transcript.
 *
 * Not durable: missed `profile.changed` events during downtime don't replay.
 * Fresh-install seeding is handled in boot.ts via `fireWithRetry()`.
 *
 * Architecture: design/03-cycle.md § "Cold-start agent".
 */

import type { Bus } from '../bus.js';
import type { Db } from '../db/index.js';
import type { AppConfig } from '@shared/types/config.js';
import { invokeClaudeCode, type ClaudeCodeOutcome } from '../claudeCode.js';
import { loadSystemPrompt, composeSystemPrompt, COLD_START_VALIDATOR_NAME } from '../prompts.js';
import { IdleGate, buildDispatcherMcpConfig, agentTools, type PersonaServices } from './shared.js';
import { nanoid } from 'nanoid';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  currentTraceparent,
  subprocessTelemetryEnv,
  setLangfuseTraceContext,
  setLangfuseTraceOutput,
  correlateSubprocessTraces,
} from '../telemetry/langfuse.js';

const tracer = trace.getTracer('digest-agent');

export interface ColdStartDispatcher {
  start(): void;
  /** Manually trigger cold-start (e.g. from `digest init`). */
  fireNow(): Promise<void>;
  /**
   * Seed pass with one retry, then validate pass. Resolves when both are
   * exhausted. Returns whether the seed succeeded and how many attempts it took.
   */
  fireWithRetry(): Promise<{ ok: boolean; attempts: number; error?: string }>;
  isBusy(): boolean;
  whenIdle(): Promise<void>;
}

export interface ColdStartDispatcherOptions {
  substrateServerPath: string;
  nodeExecutable?: string;
  nodeExecutableEnv?: Record<string, string>;
  claudeExecutable?: string;
  invoke?: typeof invokeClaudeCode;
  timeoutMs?: number;
  /** Clock for the substrate `--clock-anchor` at spawn. */
  clock?: import('../clock.js').Clock;
  /** Test-mode persona-services MCP injection. */
  personaServices?: PersonaServices;
}

export function createColdStartDispatcher(
  config: AppConfig,
  bus: Bus,
  db: Db,
  opts: ColdStartDispatcherOptions,
): ColdStartDispatcher {
  const invoke = opts.invoke ?? invokeClaudeCode;
  const gate = new IdleGate();

  /**
   * Run one onboarding pass. Returns undefined on success, an error string on
   * failure. Skips silently if already busy (re-entrancy guard).
   *
   * Both passes run untimed (timeoutMs 0) by default — they're one-time boot
   * steps with no recurring tick to fall back on.
   */
  async function runPass(pass: 'seed' | 'validate', reason: string): Promise<string | undefined> {
    if (gate.isBusy()) return undefined;

    const invocationId = `inv_${nanoid(10)}`;
    const start = Date.now();
    const roleLabel = pass === 'seed' ? 'cold-start' : 'cold-start-validate';

    let outcome: ClaudeCodeOutcome | null = null;
    let error: string | undefined;

    await tracer.startActiveSpan(`agent.invocation.${roleLabel}`, async (span) => {
    gate.setBusy();
    const personaDay = (opts.clock?.now() ?? new Date()).toISOString().slice(0, 10);
    const sessionId = setLangfuseTraceContext(span, {
      role: roleLabel,
      invocationId,
      personaDay,
      triggeringKind: 'profile.changed',
      input: { reason, pass },
    });
    span.setAttributes({
      'digest.role': roleLabel,
      'digest.invocation_id': invocationId,
      'digest.trigger_reason': reason,
      'digest.cold_start_pass': pass,
    });

    try {
      const systemPrompt =
        pass === 'seed'
          ? loadSystemPrompt('cold-start', db)
          : composeSystemPrompt(COLD_START_VALIDATOR_NAME, db);

      const userPrompt = pass === 'seed' ? seedUserPrompt(reason) : validateUserPrompt(reason);
      const mcpConfig = buildDispatcherMcpConfig('cold-start', config, opts);

      outcome = await invoke({
        systemPrompt,
        userPrompt,
        mcpConfig,
        executable: opts.claudeExecutable ?? config.claude_code.executable,
        model: config.model.cold_start_agent,
        extraFlags: config.claude_code.extra_flags ?? [],
        tools: agentTools(mcpConfig),
        telemetryEnv: subprocessTelemetryEnv(currentTraceparent(), { personaDay, invocationId }),
        timeoutMs: opts.timeoutMs ?? 0,
      });

      if (outcome.exitCode !== 0) {
        error = outcome.timedOut
          ? `${roleLabel} agent timed out after ${outcome.durationMs}ms`
          : `${roleLabel} agent exited ${outcome.exitCode} (signal=${outcome.signal ?? 'none'})`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (err instanceof Error) span.recordException(err);
    } finally {
      if (error) span.setStatus({ code: SpanStatusCode.ERROR, message: error });
      setLangfuseTraceOutput(span, error ? { error } : outcome?.finalMessage ?? null);
      void correlateSubprocessTraces({
        sessionId,
        userId: process.env['DIGEST_TEST_PERSONA'],
        startedAt: new Date(start).toISOString(),
        endedAt: new Date().toISOString(),
        parentTraceId: span.spanContext().traceId,
      }).catch(() => {});
      gate.setIdle();
      await bus.emit('coldstart.invocation.done', {
        invocation_id: invocationId,
        role: 'cold_start',
        exit_code: outcome?.exitCode ?? -1,
        duration_ms: Date.now() - start,
        ...(outcome?.finalMessage ? { outcome: { final: outcome.finalMessage } as Record<string, unknown> } : {}),
        ...(error ? { error } : {}),
      });
      span.end();
    }
    });

    return error;
  }

  /** Second pass — independent auditor. Non-fatal: failure never blocks boot. */
  async function runValidatePass(reason: string): Promise<void> {
    const err = await runPass('validate', reason);
    if (err) {
      console.warn(`[cold-start] validation pass incomplete: ${err}. Proceeding with seeded substrate.`);
    } else {
      console.log('[cold-start] validation pass complete.');
    }
  }

  return {
    start() {
      bus.on('profile.changed', async (payload) => {
        await runPass('seed', `profile.md changed (mtime=${payload.mtime})`);
      });
    },
    fireNow: () => runPass('seed', 'manual trigger').then(() => void 0),
    async fireWithRetry() {
      let attempts = 1;
      let seedError = await runPass('seed', 'boot');
      if (seedError) {
        attempts = 2;
        console.warn(`[cold-start] seed attempt 1 failed: ${seedError}. Retrying once.`);
        seedError = await runPass('seed', 'boot (retry after failure)');
      }
      const seedOk = !seedError;
      if (!seedOk) {
        console.error(`[cold-start] seed failed after ${attempts} attempt(s): ${seedError}. Running validation pass anyway.`);
      }

      // Validate pass always runs — even on seed failure it can populate a sparse substrate.
      await runValidatePass(seedOk ? 'boot validation' : 'boot validation (seed pass failed)');

      return seedOk
        ? { ok: true, attempts }
        : { ok: false, attempts, error: seedError };
    },
    isBusy: () => gate.isBusy(),
    whenIdle: () => gate.whenIdle(),
  };
}

// ─── User prompts (kept out of the main function body for readability) ────────

function seedUserPrompt(reason: string): string {
  return [
    `/goal Cold-start onboarding is COMPLETE — the substrate now models this principal's world, reconstructed from their COMPLETE available history (trigger: ${reason}).`,
    '',
    "This is the one pass that catches the mind up from nothing: it never got to process the principal's history event-by-event from the start, so reconstruct that understanding now from the full record. profile.md is in place and the substrate started empty. Every later event is incremental — this is your only shot at the back-history, so be thorough.",
    '',
    'Execute EVERY step of your cold-start role as defined in your system prompt — do not stop early, do not defer work to "once the mind sees more evidence":',
    '  • Read profile.md.',
    '  • Survey the FULL observable history across email, calendar, and notes — the widest window your context allows. Do not thin the scan; reading thinly here degrades the first weeks of mind quality.',
    '  • Compose the `_principal` anchor (slow layer, real source_ids).',
    '  • Seed high-conviction anchors for the people / projects that matter, entities for the long tail, relationships from `_principal`, predictions for visible cadences, and reminders for time-anchored matters — each grounded in real source_ids, at the quality bar in your system prompt.',
    '  • Derive the persona plays from the recurring patterns in the history (a REQUIRED onboarding output — the diary reads them as few-shots).',
    '',
    'COMPLETION: the goal is met once you have worked through every step above and the substrate sufficiently models the principal\'s world as of now, AND your final message reports COVERAGE: the history window and volume you scanned, a count per category (anchors, entities, relationships, predictions, reminders, plays), and any significant matter you deliberately deferred and why. The quality bar holds — a well-grounded sparse substrate beats a padded one — but you must have surveyed the whole history to know what is worth keeping.',
  ].join('\n');
}

function validateUserPrompt(reason: string): string {
  return [
    `/goal The cognitive substrate now sufficiently models this principal's world — audited against their COMPLETE history, with every gap filled (trigger: ${reason}).`,
    '',
    'The substrate has already been populated once; treat it as an unverified draft, not ground truth. Do NOT assume it is complete or correct. Follow your system prompt:',
    '  • Read profile.md.',
    '  • Inventory the current substrate with run_sql — counts AND rows for anchors, entities, relationships, predictions, reminders, and persona plays.',
    "  • Independently survey the principal's FULL observable history via the email / calendar / notes MCPs. Do not rely on the substrate to tell you what the history contains.",
    '  • Compare the two and find the gaps: missing subjects, mis-tiered subjects, thin/ungrounded layers, missing relationships, missing predictions, missing reminders, and — most commonly skipped — missing persona plays.',
    '  • Fill every gap with grounded writes (real source_ids). Update or deepen existing rows rather than duplicating them.',
    '',
    "COMPLETION: the goal is met once you have inventoried the substrate, independently surveyed the whole history, closed the gaps, and your final message reports COVERAGE — the history window/volume reviewed, and per category (anchors, entities, relationships, predictions, reminders, persona plays) how many were already present, how many you added, and how many you deepened or fixed, plus any gap you deliberately left and why. Quality bar holds: well-grounded beats padded, but \"sparse\" must reflect a sparse history, not an incomplete prior pass.",
  ].join('\n');
}
