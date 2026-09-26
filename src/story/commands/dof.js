import { floatParam } from "../params.js";

// DoF (AdvDoFCommand): character / background blur through the field renderer, like Focus's blur but per row.
// CanvasLayers: none -> the character (PositionType, else TargetName's position); Background 0 / Character 2.

const LAYER = { Background: 0, Character: 2 };

// ExecuteCharacterDoF: quality gate, the position, then (after DelaySeconds on the position's own DoF token) the blur
// radius of the current focus distance and SetCharacterBlurAsync
const characterDoF = async (c, p, dur, intensity, delay, ease, gen) => {
  const ctx = p.ctx, s = p.session, fr = ctx.fieldRenderer;
  if (!ctx.quality.characterBlur) return;
  let pos = c.PositionType || 0;
  if (pos === 0) {
    if (s.targetNameToPosition.has(c.TargetName)) pos = s.targetNameToPosition.get(c.TargetName);
    else console.warn(`TargetName to PositionType mapping not found for ${c.TargetName}`);
  }
  const token = gen.character.get(pos) + 1 || 1;                        // RefreshCharacterDoFCancellationToken(pos)
  gen.character.set(pos, token);
  if (!await p.delay(delay) || gen.character.get(pos) !== token) return;
  fr.applyBlurRadiusByCameraDistance(s.focusCameraDistance, 0, ease);   // the instant ApplyBlurRadiusByCameraDistance
  await fr.setCharacterBlur(pos, dur, intensity, ease);
};

// ExecuteBackgroundDoF
const backgroundDoF = async (c, p, dur, intensity, delay, ease, gen) => {
  const ctx = p.ctx, fr = ctx.fieldRenderer;
  if (!ctx.quality.backgroundBlur) return;
  const token = ++gen.background;                                       // RefreshBackgroundDoFCancellationToken
  if (!await p.delay(delay) || gen.background !== token) return;
  fr.applyBlurRadiusByCameraDistance(p.session.focusCameraDistance, 0, ease);
  await fr.setBackgroundBlur(dur, intensity, ease);
};

const tokens = new WeakMap();

export const DoF = (c, p) => p.noWait(c, (async () => {
  let gen = tokens.get(p);
  if (!gen) { gen = { character: new Map(), background: 0 }; tokens.set(p, gen); }
  const dur = p.calcDuration(c.Duration || 0, 0), intensity = floatParam(c.Parameter1);
  const delay = p.calcDuration(c.DelaySeconds || 0, 0), ease = p.ease(c.Parameter2);
  const layers = c.CanvasLayers || [];
  if (!layers.length) { await characterDoF(c, p, dur, intensity, delay, ease, gen); return; }
  const tasks = [];
  for (const layer of layers) {
    if (layer === LAYER.Background) tasks.push(backgroundDoF(c, p, dur, intensity, delay, ease, gen));
    else if (layer === LAYER.Character) tasks.push(characterDoF(c, p, dur, intensity, delay, ease, gen));
    else console.warn(`DoF command is not supported for ${JSON.stringify(layers)} layer`);
  }
  await Promise.all(tasks);
})());
