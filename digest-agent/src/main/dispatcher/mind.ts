/**
 * Mind dispatcher.
 *
 * Subscribes to every cognition-triggering event on the bus (durable, name
 * "mind-dispatcher"). Per event, spawns a Claude Code subprocess in
 * permissionless mode with the mind-substrate MCP and the role's external
 * MCPs. Awaits exit. Emits `mind.invocation.done`.
 *
 * Serialization: the bus runs durable subscribers' handlers sequentially per
 * emit. Since this is a single subscriber on the `'*'` channel, we never run
 * two mind invocations concurrently — exactly what design/03-cycle.md
 * specifies ("one event, one invocation").
 *
 * Subscriber kind: `'*'` (wildcard). We filter inside the handler by trigger
 * set. This is because the bus's `on()` is one-kind-per-call and durable
 * subscribers must have unique names — using `'*'` keeps a single cursor
 * tracking progress across every cognition trigger.
 */

import type { Bus } from '../bus.js';
import type { Clock } from '../clock.js';
import type { Db } from '../db/index.js';
import type { AppConfig } from '@shared/types/config.js';
import type { BusKind, WebhookEventPayload } from '@shared/types/events.js';
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

const TRIGGER_KINDS = new Set<BusKind>([
  'webhook.persona',
  'webhook.gmail',
  'webhook.gcal',
  'reminder.fired',
  'diary.comment.added',
  'diary.note.added',
  'task.completed',
  'task.failed',
]);

export interface MindDispatcher {
  start(): void;
  /** Resolves once the mind dispatcher's queue is empty and no invocation is in flight. */
  whenIdle(): Promise<void>;
  /** Diagnostic — is a mind invocation currently in flight? */
  isBusy(): boolean;
}

export interface MindDispatcherOptions {
  substrateServerPath: string;
  nodeExecutable?: string;
  nodeExecutableEnv?: Record<string, string>;
  claudeExecutable?: string;
  invoke?: typeof invokeClaudeCode;
  timeoutMs?: number;
  /** Clock for the substrate `--clock-anchor` at spawn. Defaults to wall-clock. */
  clock?: Clock;
  /** Test-mode persona-services MCP injection. */
  personaServices?: PersonaServices;
}

export function createMindDispatcher(
  config: AppConfig,
  bus: Bus,
  db: Db,
  opts: MindDispatcherOptions,
): MindDispatcher {
  const invoke = opts.invoke ?? invokeClaudeCode;
  const gate = new IdleGate();

  async function handleEvent(payload: unknown, kind: BusKind): Promise<void> {
    if (!TRIGGER_KINDS.has(kind)) return;

    const invocationId = `inv_${nanoid(10)}`;
    const start = Date.now();

    await tracer.startActiveSpan('agent.invocation.mind', async (span) => {
    gate.setBusy();
    let personaDay: string | undefined;
    if (kind === 'webhook.persona' || kind === 'webhook.gmail' || kind === 'webhook.gcal') {
      const wh = payload as WebhookEventPayload;
      personaDay = wh.occurred_at?.slice(0, 10);
    }
    const sessionId = setLangfuseTraceContext(span, {
      role: 'mind',
      invocationId,
      ...(personaDay ? { personaDay } : {}),
      triggeringKind: kind,
      input: { kind, payload },
    });
    span.setAttributes({
      'digest.role': 'mind',
      'digest.invocation_id': invocationId,
      'digest.triggering_kind': kind,
    });
    let outcome: ClaudeCodeOutcome | null = null;
    let error: string | undefined;

    try {
      const systemPrompt = loadSystemPrompt('mind', db);
      const userPrompt = [
        `A new event has arrived. Process it against the current substrate, following the steps in your system prompt: read the relevant anchors/entities, decide what (if anything) to create / update / promote / predict, write the updates, and append a thinking-layer note.`,
        '',
        `Event kind: ${kind}`,
        '',
        'Event payload (JSON):',
        '```json',
        JSON.stringify(payload, null, 2),
        '```',
        '',
        'Begin now.',
      ].join('\n');

      const mcpConfig = buildDispatcherMcpConfig('mind', config, opts);

      outcome = await invoke({
        systemPrompt,
        userPrompt,
        mcpConfig,
        executable: opts.claudeExecutable ?? config.claude_code.executable,
        model: config.model.mind_agent,
        extraFlags: config.claude_code.extra_flags ?? [],
        tools: agentTools(mcpConfig),
        telemetryEnv: subprocessTelemetryEnv(currentTraceparent(), { personaDay, invocationId }),
        // Default untimed: mind processes one event at a time and must work to
        // completion. A hard cap that fires mid-run leaves the substrate half-updated.
        // Pass opts.timeoutMs explicitly to re-impose a cap (e.g. in tests).
        timeoutMs: opts.timeoutMs ?? 0,
      });

      if (outcome.exitCode !== 0) {
        error = outcome.timedOut
          ? `mind agent timed out after ${outcome.durationMs}ms`
          : `mind agent exited ${outcome.exitCode} (signal=${outcome.signal ?? 'none'})`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (err instanceof Error) span.recordException(err);
    } finally {
      if (error) span.setStatus({ code: SpanStatusCode.ERROR, message: error });
      setLangfuseTraceOutput(span, error ? { error } : outcome?.finalMessage ?? null);
      // Fire-and-forget: patch Claude Code's subprocess traces in Langfuse with
      // the correct sessionId, userId, and token counts (they land with wrong defaults).
      void correlateSubprocessTraces({
        sessionId,
        userId: process.env['DIGEST_TEST_PERSONA'],
        startedAt: new Date(start).toISOString(),
        endedAt: new Date().toISOString(),
        parentTraceId: span.spanContext().traceId,
      }).catch(() => {});
      gate.setIdle();
      // Capture triggering event so the persona-clock driver can advance
      // sim-time to its occurred_at AFTER mind finishes processing it.
      const triggering: { kind: string; source_id?: string; occurred_at?: string } = { kind };
      if (kind === 'webhook.persona' || kind === 'webhook.gmail' || kind === 'webhook.gcal') {
        const wh = payload as WebhookEventPayload;
        if (wh.id) triggering.source_id = wh.id;
        if (wh.occurred_at) triggering.occurred_at = wh.occurred_at;
      }
      await bus.emit('mind.invocation.done', {
        invocation_id: invocationId,
        role: 'mind',
        exit_code: outcome?.exitCode ?? -1,
        duration_ms: Date.now() - start,
        ...(outcome?.finalMessage ? { outcome: { final: outcome.finalMessage } as Record<string, unknown> } : {}),
        ...(error ? { error } : {}),
        triggering,
      });
      span.end();
    }
    });
  }

  return {
    start() {
      bus.on(
        '*',
        async (payload, meta) => { await handleEvent(payload, meta.kind); },
        { durable: true, name: 'mind-dispatcher' },
      );
    },
    isBusy: () => gate.isBusy(),
    whenIdle: () => gate.whenIdle(),
  };
}
