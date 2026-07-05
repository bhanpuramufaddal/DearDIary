/**
 * Precision is the per-claim calibration scalar, clamped to [0.05, 0.95].
 * The architecture's arithmetic for support / contradict lives in Phase 3
 * (`src/main/db/predictions.ts`); this module just defines the type and bounds.
 *
 * See design/01-anchor-model.md and design/03a-agent-shape.md#precision_arithmetic.
 */

export type Precision = number;

export const PRECISION_MIN = 0.05;
export const PRECISION_MAX = 0.95;
export const SUPPORT_RATE = 0.1; // p ← min(max, p + (1-p)·0.10)
export const CONTRADICT_RATE = 0.3; // p ← max(min, p − p·0.30)

export function clampPrecision(p: number): Precision {
  if (p < PRECISION_MIN) return PRECISION_MIN;
  if (p > PRECISION_MAX) return PRECISION_MAX;
  return p;
}

export function applySupport(p: Precision): Precision {
  return clampPrecision(p + (1 - p) * SUPPORT_RATE);
}

export function applyContradict(p: Precision): Precision {
  return clampPrecision(p - p * CONTRADICT_RATE);
}

export type LayerName = 'slow' | 'mid' | 'fast';
export const LAYER_NAMES: readonly LayerName[] = ['slow', 'mid', 'fast'] as const;
