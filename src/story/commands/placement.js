import { EASE } from "../../engine/tween.js";
import { floatParam } from "../params.js";

// Character placement: MoveToRight / Left / Up / Down / Forward / Back (AdvCharacterField.MoveTo*) and Forward / Back
// (AdvFieldRendererManager.SetCharacterForward / SetCharacterBack: the draw priority at equal depth).

// AdvCharacterField.MoveTo*: the stage transform of PositionType moves by the offset along one axis:
// DOLocalMove(end, duration).SetEase(OutQuad), set at once for duration <= 0; MoveToForward / Back re-sort the
// characters on every update (and once for duration <= 0)
const move = (axis, sign, sort) => (c, p) => {
  const ctx = p.ctx, dur = p.calcDuration(c.Duration || 0, 0), offset = floatParam(c.Parameter1);
  const pos = c.PositionType || 0;
  const task = (async () => {
    const t = ctx.field.stageTransform(pos);
    if (!t) throw new Error(`${c.cmd}: position type ${pos} has no character stage`);
    const onUpdate = sort ? () => ctx.fieldRenderer.sortCharacters() : null;
    const p0 = t.localPosition, end = { ...p0, [axis]: p0[axis] + sign * offset };
    if (!(dur > 0)) { t.localPosition = end; if (onUpdate) onUpdate(); return; }
    await ctx.loop.tweens.to(() => ({ ...t.localPosition }), end, dur, EASE.OutQuad, (v) => {
      t.localPosition = { ...v };
      if (onUpdate) onUpdate();
    }).promise;
  })();
  return p.noWait(c, task);
};

export const MoveToRight = move("x", 1, false);
export const MoveToLeft = move("x", -1, false);
export const MoveToUp = move("y", 1, false);
export const MoveToDown = move("y", -1, false);
export const MoveToForward = move("z", -1, true);
export const MoveToBack = move("z", 1, true);

// AdvFieldRenderPass.SetCharacterForward / SetCharacterBack: a copy of the default order with the entry moved to the
// end (drawn last, in front) / the start; the priority map rewritten from it, then SetCharacterEntries. Each call starts
// from the default order. A position type without an entry (-1) leaves the default order in place.
export const reorderCharacters = (fr, pos, forward) => {
  const idx = fr.constructor.entryIndex(pos);
  const list = fr.defaultOrder.filter((e) => e !== idx);
  if (forward) list.push(idx); else list.unshift(idx);
  for (const k of Object.keys(fr.priority)) delete fr.priority[k];
  list.forEach((e, i) => { fr.priority[e] = i; });
  fr.setCharacterEntries();
};

export const Forward = (c, p) => { reorderCharacters(p.ctx.fieldRenderer, c.PositionType || 0, true); return Promise.resolve(); };
export const Back = (c, p) => { reorderCharacters(p.ctx.fieldRenderer, c.PositionType || 0, false); return Promise.resolve(); };
