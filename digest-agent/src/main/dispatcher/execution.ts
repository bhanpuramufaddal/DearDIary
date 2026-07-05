/**
 * Execution dispatcher.
 *
 * Subscribes to `task.fired`. Per fire, spawns a permissionless Claude Code
 * subprocess scoped to external MCPs only (no substrate) — its only job is to
 * act on the world (send an email, accept a calendar invite, …).
 *
 * Parallelism: tasks run concurrently (unlike the mind dispatcher's
 * one-at-a-time serialization). Two principal-fired tasks have no causal
 * dependency — the user chose to act on both.
 *
 * Outcomes:
 *   success → task.completed + component status → 'acted'
 *   failure → task.failed with the error string
 * In both cases the mind dispatcher's subscription on task.completed/failed
 * fires and the mind agent updates the anchor's case base / efference prediction.
 *
 * Architecture: design/02-diary-model.md § "Action affordances and the
 * execution boundary" + design/11-backend-architecture.md § "Subsystem 12".
 */

import type { Bus } from '../bus.js';
import type { Db } from '../db/index.js';
import type { AppConfig } from '@shared/types/config.js';
import type { TaskFiredEvent, TaskOutcomeEvent } from '@shared/types/tasks.js';
import { invokeClaudeCode, type ClaudeCodeOutcome } from '../claudeCode.js';
import { loadSystemPrompt } from '../prompts.js';
import { buildDispatcherMcpConfig, agentTools } from './shared.js';
import { currentTraceparent, subprocessTelemetryEnv } from '../telemetry/langfuse.js';
import { makeDiaryRepo } from '../db/diary.js';
import type { DiaryComponentId } from '@shared/types/ids.js';

export interface ExecutionDispatcher {
  start(): void;
  /** Number of executions currently in flight — diagnostic. */
  inFlight(): number;
}

export interface ExecutionDispatcherOptions {
  /**
   * Unused by the execution role (no substrate access), but required for
   * type-symmetry with other dispatchers.
   */
  substrateServerPath: string;
  nodeExecutable?: string;
  nodeExecutableEnv?: Record<string, string>;
  claudeExecutable?: string;
  invoke?: typeof invokeClaudeCode;
  /** Per-execution hard cap. Default 10 minutes. */
  timeoutMs?: number;
  /**
   * When true, log each task.fired and do nothing else — no subprocess, no
   * completion/failure event, no status flip. For persona-emulator runs where
   * the principal can "observe" actions without real side effects.
   */
  blocked?: boolean;
}

export function createExecutionDispatcher(
  config: AppConfig,
  bus: Bus,
  db: Db,
  opts: ExecutionDispatcherOptions,
): ExecutionDispatcher {
  const invoke = opts.invoke ?? invokeClaudeCode;
  const diary = makeDiaryRepo(db);
  let inFlightCount = 0;

  async function runOne(task: TaskFiredEvent): Promise<void> {
    inFlightCount++;
    const start = Date.now();
    let outcome: ClaudeCodeOutcome | null = null;
    let error: string | undefined;

    try {
      const componentContent = readComponentContent(db, task.component_id);
      const systemPrompt = loadSystemPrompt('execution', db);
      const userPrompt = JSON.stringify(
        {
          task_id: task.task_id,
          component_id: task.component_id,
          diary_date: task.diary_date,
          action: task.action,
          principal_input: task.principal_input,
          context_pointers: task.context_pointers,
          component_content: componentContent,
        },
        null,
        2,
      );

      const mcpConfig = buildDispatcherMcpConfig('execution', config, opts);

      outcome = await invoke({
        systemPrompt,
        userPrompt,
        mcpConfig,
        executable: opts.claudeExecutable ?? config.claude_code.executable,
        model: config.model.execution_agent,
        extraFlags: config.claude_code.extra_flags ?? [],
        tools: agentTools(mcpConfig),
        timeoutMs: opts.timeoutMs ?? 10 * 60 * 1000,
        telemetryEnv: subprocessTelemetryEnv(currentTraceparent(), { invocationId: task.task_id }),
      });

      if (outcome.exitCode !== 0) {
        error = outcome.timedOut
          ? `execution agent timed out after ${outcome.durationMs}ms`
          : `execution agent exited ${outcome.exitCode} (signal=${outcome.signal ?? 'none'})`;
      } else {
        const parsed = parseFinalOutcome(outcome.finalMessage);
        if (parsed?.status === 'failed') {
          error = parsed.error ?? 'execution agent reported failure with no error string';
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      inFlightCount--;

      const succeeded = !error;
      if (succeeded) {
        // Flip status before the bus event so any subscriber calling assembleDiary sees 'acted'.
        diary.updateComponentStatus(task.component_id as DiaryComponentId, 'acted');
      }

      const evidence = extractEvidence(outcome?.finalMessage);
      const payload: TaskOutcomeEvent = {
        task_id: task.task_id,
        component_id: task.component_id,
        ...(succeeded ? {} : { error: error! }),
        ...(evidence ? { outcome: evidence } : {}),
      };
      await bus.emit(succeeded ? 'task.completed' : 'task.failed', payload);

      const durationMs = Date.now() - start;
      console.log(
        `[execution] ${task.task_id} ${succeeded ? 'completed' : 'failed'} in ${durationMs}ms` +
          (error ? ` — ${error}` : ''),
      );
    }
  }

  return {
    start() {
      if (opts.blocked) {
        bus.on('task.fired', (payload) => {
          console.log(
            `[execution] BLOCKED in test mode — task=${payload.task_id} ` +
              `component=${payload.component_id} action=${payload.action.kind}`,
          );
        });
        return;
      }
      // Fire-and-forget: concurrent tasks are not serialized through the bus subscriber loop.
      bus.on('task.fired', (payload) => { void runOne(payload); });
    },
    inFlight: () => inFlightCount,
  };
}

function readComponentContent(db: Db, componentId: string): unknown {
  const row = db
    .prepare('SELECT content FROM diary_components WHERE id = ?')
    .get(componentId) as { content: string } | undefined;
  if (!row) throw new Error(`execution: component not found: ${componentId}`);
  return JSON.parse(row.content);
}

interface FinalOutcome {
  status?: 'completed' | 'failed';
  error?: string;
  evidence?: Record<string, unknown>;
}

/**
 * Extract the structured outcome JSON the execution agent emits as its final
 * assistant message. Tries three shapes: direct object, Claude Code envelope
 * (`{content:[{type:'text',text:'…'}]}`), and result-line wrapper.
 * Returns null if none match — the caller treats the run as opaquely-succeeded.
 */
function parseFinalOutcome(final: unknown): FinalOutcome | null {
  if (!final || typeof final !== 'object') return null;

  // Direct {status, …} shape.
  if ('status' in final) return final as FinalOutcome;

  // Claude Code assistant message envelope: {content:[{type:'text',text:'…'}]}.
  const envelope = final as { content?: Array<{ type?: string; text?: string }> };
  if (Array.isArray(envelope.content)) {
    for (const block of envelope.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const trimmed = block.text.trim();
        const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
        const candidate = fenced ? fenced[1]!.trim() : trimmed;
        try {
          const obj = JSON.parse(candidate) as FinalOutcome;
          if (obj && typeof obj === 'object') return obj;
        } catch {
          // Text block was not valid JSON — try next block.
        }
      }
    }
  }

  // Result-line wrapper: {type:'result', result:'…'}.
  const resultWrap = final as { result?: unknown };
  if (typeof resultWrap.result === 'string') {
    try {
      const obj = JSON.parse(resultWrap.result) as FinalOutcome;
      if (obj && typeof obj === 'object') return obj;
    } catch {
      // Not valid JSON.
    }
  }

  return null;
}

function extractEvidence(final: unknown): Record<string, unknown> | undefined {
  const parsed = parseFinalOutcome(final);
  return parsed?.evidence && typeof parsed.evidence === 'object' ? parsed.evidence : undefined;
}
