/**
 * Diary dispatcher.
 *
 * Fires on `schedule.diary_tick`. Waits for mind to be idle ("always-fresh"
 * guarantee) before spawning the diary-agent subprocess. One composition at a
 * time — a second tick arriving mid-compose is dropped (the in-flight result
 * already covers it).
 *
 * Not durable: missed ticks during downtime don't replay — the next scheduled
 * tick covers everything.
 *
 * Architecture: design/03-cycle.md § "Always-fresh: how it's enforced".
 */

import type { Bus } from '../bus.js';
import type { Db } from '../db/index.js';
import type { AppConfig } from '@shared/types/config.js';
import type { MindDispatcher } from './mind.js';
import { invokeClaudeCode, type ClaudeCodeOutcome } from '../claudeCode.js';
import { loadSystemPrompt } from '../prompts.js';
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

export interface DiaryDispatcher {
  start(): void;
  /** Manually trigger a diary tick — used by `digest_run` (Phase 9). */
  fireNow(): Promise<void>;
  isBusy(): boolean;
  whenIdle(): Promise<void>;
}

export interface DiaryDispatcherOptions {
  substrateServerPath: string;
  nodeExecutable?: string;
  nodeExecutableEnv?: Record<string, string>;
  claudeExecutable?: string;
  invoke?: typeof invokeClaudeCode;
  /**
   * Diary composition can take longer than a mind tick and grows with the
   * substrate. Default 0 (untimed) — the re-entrancy guard prevents pileup.
   * Set explicitly to re-impose a cap.
   */
  timeoutMs?: number;
  /** Clock for the substrate `--clock-anchor` at spawn. */
  clock?: import('../clock.js').Clock;
  /** Test-mode persona-services MCP injection. */
  personaServices?: PersonaServices;
}

export function createDiaryDispatcher(
  config: AppConfig,
  bus: Bus,
  db: Db,
  mind: MindDispatcher,
  opts: DiaryDispatcherOptions,
): DiaryDispatcher {
  const invoke = opts.invoke ?? invokeClaudeCode;
  const gate = new IdleGate();

  async function runOnce(triggerAt: string): Promise<void> {
    if (gate.isBusy()) return; // in-flight composition already covers this tick

    const invocationId = `inv_${nanoid(10)}`;
    const start = Date.now();

    await tracer.startActiveSpan('agent.invocation.diary', async (span) => {
    gate.setBusy();
    const personaDay = triggerAt.slice(0, 10);
    const sessionId = setLangfuseTraceContext(span, {
      role: 'diary',
      invocationId,
      personaDay,
      triggeringKind: 'schedule.diary_tick',
      input: { trigger_at: triggerAt, day: personaDay },
    });
    span.setAttributes({
      'digest.role': 'diary',
      'digest.invocation_id': invocationId,
      'digest.trigger_at': triggerAt,
    });
    let outcome: ClaudeCodeOutcome | null = null;
    let error: string | undefined;

    try {
      await mind.whenIdle();

      const systemPrompt = loadSystemPrompt('diary', db);
      const today = triggerAt.slice(0, 10);
      const userPrompt = [
        `Compose today's digest. Today is ${today}. Trigger fired at ${triggerAt}.`,
        '',
        'Follow the process in your system prompt:',
        '1. Read `customize` from the playbook.',
        "2. Read the principal's profile.md (treat it as a guideline, not authority — substrate observation wins on conflict).",
        '3. Read the substrate (`list_anchors`, `list_entities`, `list_diaries`, then `read_anchor` / `read_entity` on live matters; `read_diary` on yesterday\'s entries to carry forward unresolved items).',
        '4. Read live sources via your email / calendar / notes MCPs (recent inbound + today\'s calendar).',
        '5. Decide what merits attention today. Pick sections + templates.',
        '6. Write each component with `supporting_artifact_ids` citing source events.',
        '7. Apply suppression + honesty discipline.',
        '8. Append a thinking-layer journal entry.',
        '9. Emit efference predictions for any dispatchable drafts.',
        '',
        'If after surveying substrate and live sources there is genuinely nothing worth surfacing today, write zero components — the renderer paints an empty page and that is correct. Do not write a placeholder.',
        '',
        'Begin now.',
      ].join('\n');

      const mcpConfig = buildDispatcherMcpConfig('diary', config, opts);

      outcome = await invoke({
        systemPrompt,
        userPrompt,
        mcpConfig,
        executable: opts.claudeExecutable ?? config.claude_code.executable,
        model: config.model.diary_agent,
        extraFlags: config.claude_code.extra_flags ?? [],
        tools: agentTools(mcpConfig),
        telemetryEnv: subprocessTelemetryEnv(currentTraceparent(), { personaDay, invocationId }),
        timeoutMs: opts.timeoutMs ?? 0,
      });

      if (outcome.exitCode !== 0) {
        error = outcome.timedOut
          ? `diary agent timed out after ${outcome.durationMs}ms`
          : `diary agent exited ${outcome.exitCode} (signal=${outcome.signal ?? 'none'})`;
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
      await bus.emit('diary.invocation.done', {
        invocation_id: invocationId,
        role: 'diary',
        exit_code: outcome?.exitCode ?? -1,
        duration_ms: Date.now() - start,
        ...(outcome?.finalMessage ? { outcome: { final: outcome.finalMessage } as Record<string, unknown> } : {}),
        ...(error ? { error } : {}),
      });
      span.end();
    }
    });
  }

  return {
    start() {
      bus.on('schedule.diary_tick', async (payload) => { await runOnce(payload.trigger_at); });
    },
    fireNow: () => runOnce(new Date().toISOString()),
    isBusy: () => gate.isBusy(),
    whenIdle: () => gate.whenIdle(),
  };
}
