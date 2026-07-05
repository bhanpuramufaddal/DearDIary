import type { AnchorId, NodeId, RelationshipId } from './ids.js';
import type { Precision } from './precision.js';

/**
 * Per-layer slice of a relationship.
 * See design/03a-agent-shape.md#relationship_object.
 */
export interface RelationshipLayer {
  claim: string;
  precision: Precision;
}

/**
 * Directed edge from a subject node (anchor or entity) to a target anchor.
 * Entities never appear as targets — enforced by trigger in the storage layer.
 */
export interface Relationship {
  id: RelationshipId;
  subject_id: NodeId;
  target_id: AnchorId;
  slow: RelationshipLayer;
  mid: RelationshipLayer;
  fast: RelationshipLayer;
}
