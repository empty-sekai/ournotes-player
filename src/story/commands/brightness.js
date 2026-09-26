import { EASE } from "../../engine/tween.js";
import { floatParam } from "../params.js";

// Brightness (AdvBrightnessCommand): a character's brightness through its field renderer entry (or the controller
// when it is loaded but not placed), or the background sprite's.

const LAYER = { Background: 0, Character: 2 };
const clamp01 = (v) => (v > 1 ? 1 : v < 0 ? 0 : v);
const entryTweens = new WeakMap();                  // field renderer entry -> its brightness tween

// AdvFieldRendererManager.SetCharacterBrightness(entry, fallback, v): the entry's value, its character's and the
// fallback controller's (when that is another one)
const setEntryBrightness = (entry, fallback, v) => {
  entry.brightness = v;
  if (entry.target) entry.target.setBrightness(v);
  if (fallback && fallback !== entry.target) fallback.setBrightness(v);
};

// AdvFieldRendererManager.SetCharacterBrightnessAsync(pos, duration, brightness, fallback): the entry's previous
// brightness tween ends (its CTS is refreshed); clamp01; DOTween.To on the entry (DOTween's default ease OutQuad), the
// final value set again on completion
export const setCharacterBrightnessAsync = async (ctx, pos, dur, brightness, fallback) => {
  const fr = ctx.fieldRenderer, entry = fr.entryOf(pos);
  if (!entry) { console.warn(`Brightness: position type ${pos} has no field renderer entry`); return; }
  const prev = entryTweens.get(entry);
  if (prev) { prev.kill(); entryTweens.delete(entry); }
  const b = clamp01(brightness);
  if (!(dur > 0)) { setEntryBrightness(entry, fallback, b); return; }
  const t = ctx.loop.tweens.to(() => entry.brightness, b, dur, EASE.OutQuad, (v) => setEntryBrightness(entry, fallback, v));
  entryTweens.set(entry, t);
  if (await t.promise) setEntryBrightness(entry, fallback, b);
};

// AdvBackgroundField.SetBrightness(brightness, duration): _brightness = clamp01; ApplyBrightness(duration): DOKill,
// DOColor(original.rgb x brightness, original.a) with DOTween's default ease. The field keeps `brightness` and
// `originalColor` (SetStageInfo applies the kept brightness to the new stage colour) and its colour tween.
export const setBackgroundBrightness = async (ctx, brightness, dur) => {
  const bg = ctx.background, b = bg.brightness = clamp01(brightness), o = bg.originalColor;
  if (bg.colorTween) { bg.colorTween.kill(); bg.colorTween = null; }
  const end = { r: o.r * b, g: o.g * b, b: o.b * b, a: o.a };
  if (!(dur > 0)) { bg.color = end; return; }
  const t = bg.colorTween = ctx.loop.tweens.to(() => ({ ...bg.color }), end, dur, EASE.OutQuad, (v) => { bg.color = { ...v }; });
  await t.promise;
};

// Live2DCharacterController.SetBrightness(brightness, duration): clamp01; each frame (the first in the calling frame)
// elapsed += the unscaled delta time and the brightness moves by clamp01(elapsed / duration) of the rest of the way
// (from the current value); then the target
export const setControllerBrightness = async (ctx, ch, brightness, dur) => {
  const b = clamp01(brightness), loop = ctx.loop;
  if (!(dur > 0)) { ch.setBrightness(b); return; }
  let elapsed = 0;
  while (elapsed < dur) {
    elapsed += loop.deltaTime;
    const k = clamp01(elapsed / dur);
    ch.setBrightness(ch.brightness + (b - ch.brightness) * k);
    await loop.yield("Update");
  }
  ch.setBrightness(b);
};

// AdvBrightnessCommand.Brightness
export const Brightness = (c, p) => p.noWait(c, (async () => {
  const ctx = p.ctx, s = p.session;
  const dur = p.calcDuration(c.Duration || 0, 0), b = floatParam(c.Parameter1), pos = c.PositionType || 0;
  const ch = ctx.characters.get(c.TargetName);
  if (!ch) {
    const layers = c.CanvasLayers || [];
    if (layers.length) {
      const tasks = [];
      for (const layer of layers) {
        if (layer === LAYER.Character) {
          const target = s.positionToCharacter.get(pos);
          if (s.positionToCharacter.has(pos)) tasks.push(setCharacterBrightnessAsync(ctx, pos, dur, b, target));
        } else if (layer === LAYER.Background) tasks.push(setBackgroundBrightness(ctx, b, dur));
        else console.warn(`Brightness ${JSON.stringify(layers)}`);
      }
      await Promise.all(tasks);
    } else if (pos !== 0) {
      if (s.positionToCharacter.has(pos)) await setCharacterBrightnessAsync(ctx, pos, dur, b, s.positionToCharacter.get(pos));
    } else await setBackgroundBrightness(ctx, b, dur);
  } else if (s.targetNameToPosition.has(c.TargetName)) {
    await setCharacterBrightnessAsync(ctx, s.targetNameToPosition.get(c.TargetName), dur, b, ch);
  } else await setControllerBrightness(ctx, ch, b, dur);
})());
