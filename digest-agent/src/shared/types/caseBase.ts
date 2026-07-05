import type { CaseBaseEntryId, NodeId, SourceId } from './ids.js';
import type { LayerName } from './precision.js';

/**
 * Case-base entry: a citation from a node's layer to an external source.
 * See design/03a-agent-shape.md#case_base_entry.
 *
 * - source_id  — `<source-tag>:<stable-id>`, the canonical pointer.
 * - date       — when the event occurred (local metadata, not source content).
 * - note       — optional agent commentary stamp.
 *
 * For entities, `layer` is null (entities are flat).
 * For anchors, `layer` is one of slow/mid/fast.
 */
export interface CaseBaseEntry {
  id: CaseBaseEntryId;
  node_id: NodeId;
  layer: LayerName | null;
  source_id: SourceId;
  date: string; // ISO 8601 date
  note?: string;
  position: number;
}
