import type { AnchorId, PredictionId } from './ids.js';
import type { LayerName, Precision } from './precision.js';

export type PredictionKind = 'event' | 'fact' | 'pattern';

/**
 * Standing prediction attached to an anchor.
 * See design/03a-agent-shape.md#prediction_object.
 *
 * - `expected_by` is required for `event`, omitted for `fact` and `pattern`.
 * - `based_on` lists anchor layers that cascade on support/contradict.
 * - `source_dispatchable` is set for efference-copy predictions tied to a diary component.
 */
export interface Prediction {
  id: PredictionId;
  anchor_id: AnchorId;
  kind: PredictionKind;
  claim: string;
  expected_by?: string; // ISO 8601 datetime
  based_on: LayerName[];
  precision: Precision;
  created_at: string;
  source_dispatchable?: string; // `diary/<date>#<component_id>`
}

export type EvidenceKind = 'support' | 'contradict';
