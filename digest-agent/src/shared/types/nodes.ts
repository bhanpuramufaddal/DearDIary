import type { AnchorId, EntityId } from './ids.js';
import type { CaseBaseEntry } from './caseBase.js';
import type { LayerName, Precision } from './precision.js';
import type { Relationship } from './relationships.js';
import type { Prediction } from './predictions.js';

/**
 * Layer body — used directly by anchors (slow/mid/fast).
 * `case_base` is populated when the layer is assembled for the agent view;
 * the storage layer keeps entries in a separate table indexed by (node_id, layer).
 */
export interface LayerObject {
  content: string;
  precision: Precision;
  case_base: CaseBaseEntry[];
}

/**
 * Committed cognitive primitive. See design/01-anchor-model.md.
 */
export interface Anchor {
  id: AnchorId;
  kind: string; // free-form: person | project | deal | …
  display_name?: string;
  created_at: string;
  activation: number;
  last_bumped: string;
  identity_handles: string[];
  slow: LayerObject;
  mid: LayerObject;
  fast: LayerObject;
  notes?: string;
  relationships: Relationship[];
  predictions: Prediction[];
}

/**
 * Provisional cognitive primitive. See design/01a-entity-model.md.
 * Flat — no layers. Promoted to anchor by the mind agent when evidence accumulates.
 */
export interface Entity {
  id: EntityId;
  kind: string;
  first_seen: string;
  last_seen: string;
  mention_count: number;
  identity_handles: string[];
  notes?: string;
  case_base: CaseBaseEntry[];
  relationships: Relationship[];
}

export type NodeKind = 'anchor' | 'entity';

export interface NodeRow {
  id: AnchorId | EntityId;
  kind: NodeKind;
  created_at: string;
}

export type { LayerName };
