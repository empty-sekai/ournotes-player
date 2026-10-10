// Compile-only check of ournotes-player/replay/preset (npm run typecheck). Nothing here runs.
import { applyAccuracyPreset, applySegmentPreset, parseJustJudgementTypes, type ReplaySegment } from "ournotes-player/replay/preset";

export function plan(request: Record<string, unknown>, description: Record<string, unknown>, deckData: string): number {
  const justTypes = parseJustJudgementTypes(deckData);
  const counts = applyAccuracyPreset(request, description, justTypes, 0.1, 0.5);
  const whole: ReplaySegment = { startMs: null, endMs: null, great: 0.1, good: 0, bad: 0, miss: 0, just: 0.5 };
  const drawn = applySegmentPreset(request, description, new Set(justTypes), [whole, { ...whole, startMs: 0, endMs: 1000 }], 1);
  return counts.justEligible + counts.perfect + drawn.miss + drawn.total;
}
