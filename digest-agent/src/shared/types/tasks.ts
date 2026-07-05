import type { AnchorId, DiaryComponentId, SourceId, TaskId } from './ids.js';

/**
 * task.fired — emitted by the renderer (or surface MCP's diary_act) when the
 * principal acts on a HITL component. Consumed by the execution dispatcher,
 * which spawns a fresh Claude Code subprocess (permissionless) to execute against the world.
 * See design/02-diary-model.md#action-affordances-and-the-execution-boundary.
 */
export interface TaskFiredEvent {
  task_id: TaskId;
  component_id: DiaryComponentId;
  diary_date: string;
  action: {
    id: string;
    kind: string;
  };
  principal_input: unknown | null;
  context_pointers: {
    anchor_ids: AnchorId[];
    source_id?: SourceId;
  };
}

export interface TaskOutcomeEvent {
  task_id: TaskId;
  component_id: DiaryComponentId;
  /** Free-form structured outcome from the execution Claude Code instance. */
  outcome?: Record<string, unknown>;
  /** Populated on task.failed. */
  error?: string;
}
