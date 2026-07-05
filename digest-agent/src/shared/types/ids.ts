/**
 * Branded id types — make ids of different categories distinguishable at the type level.
 *
 * Plain `string` everywhere lets us mix up an `AnchorId` and an `EntityId` at the call
 * site without the compiler catching it. With branding, the compiler does.
 *
 * Runtime representation: plain strings. The brand is a phantom field that vanishes
 * after type-check; it has zero runtime cost.
 */

declare const __brand: unique symbol;
export type Brand<K, T extends string> = K & { readonly [__brand]: T };

export type AnchorId = Brand<string, 'AnchorId'>;
export type EntityId = Brand<string, 'EntityId'>;
export type NodeId = AnchorId | EntityId;
export type RelationshipId = Brand<string, 'RelationshipId'>;
export type PredictionId = Brand<string, 'PredictionId'>;
export type CaseBaseEntryId = Brand<string, 'CaseBaseEntryId'>;
export type ReminderId = Brand<string, 'ReminderId'>;
export type DiaryComponentId = Brand<string, 'DiaryComponentId'>;
export type DiaryCommentId = Brand<string, 'DiaryCommentId'>;
export type DiaryNoteId = Brand<string, 'DiaryNoteId'>;
export type DiaryThinkingEntryId = Brand<string, 'DiaryThinkingEntryId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type EventId = Brand<number, 'EventId'>;

/**
 * Lift a plain string into a branded id. No runtime validation —
 * callers are responsible for ensuring the string is a valid id of the kind.
 * The runtime trust boundary is at the storage layer / IPC layer (zod schemas).
 */
export function mkId<K extends Brand<string, string>>(s: string): K {
  return s as K;
}

export function mkEventId(n: number): EventId {
  return n as EventId;
}

/** Source-ID format: `<source-tag>:<stable-id>` — e.g. `gmail:msg_abc`, `persona:avery:email:001`. */
export type SourceId = Brand<string, 'SourceId'>;

export function mkSourceId(s: string): SourceId {
  return s as SourceId;
}
