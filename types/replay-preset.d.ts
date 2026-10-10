// Type declarations of ournotes-player/replay/preset: declared input plans for an `ournotes.replay/1` request. The
// functions rewrite the judgement grades of the request in place; conversion, state updates and scoring stay with
// the replay that runs the request.

/** A probability segment of `applySegmentPreset`: the first covers the song (`startMs` and `endMs` null), later
 *  ones cover chart times `[startMs, endMs)` and win over earlier ones. */
export interface ReplaySegment {
  startMs: number | null;
  endMs: number | null;
  great: number;
  good: number;
  bad: number;
  miss: number;
  /** Probability of Just for a Perfect input that can be Just. */
  just: number;
}

/** The judgement types that can be Just, from an `nnnotes.deck-data/1` document (JSON text or parsed). */
export function parseJustJudgementTypes(deckData: string | Record<string, unknown>): number[];

/** Sets rounded counts of Great and Just inputs, spread evenly over the request's input order. */
export function applyAccuracyPreset(
  request: Record<string, unknown>,
  description: Record<string, unknown>,
  justTypes: readonly number[] | Set<number>,
  greatFraction: number,
  justFraction: number,
): { great: number; just: number; perfect: number; total: number; justEligible: number };

/** Draws one grade per judged input from its segment with a uint32 `planSeed` (two draws per input). */
export function applySegmentPreset(
  request: Record<string, unknown>,
  description: Record<string, unknown>,
  justTypes: readonly number[] | Set<number>,
  segments: readonly ReplaySegment[],
  planSeed: number,
): { great: number; good: number; bad: number; miss: number; just: number; perfect: number; total: number };
