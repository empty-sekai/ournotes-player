import { StoryCommandError } from "../interfaces.js";
import { netTrim } from "../../engine/tween.js";
import { floatParam, htmlColor, intParam } from "../params.js";

// AdvSystem.Asset.AdvStageEnvType
export const ADV_STAGE_ENV_TYPE = { All: 0, Light: 1, Effect: 2, PostEffect: 3, FocusPosition: 4 };

// Enum.TryParse<AdvStageEnvType>(s, out t): trimmed; an integer string gives its value (defined or not); otherwise
// comma-separated names (ordinal, case-sensitive), their values ORed; anything else fails and leaves 0 (All).
export const parseStageEnvType = (s) => {
  const t = netTrim(String(s ?? ""));
  if (t === "") return 0;
  if (/^[+-]?[0-9]+$/.test(t)) {
    const n = Number(t);
    return n < -2147483648 || n > 2147483647 ? 0 : n;
  }
  let v = 0;
  for (const part of t.split(",")) {
    const name = netTrim(part);
    if (!Object.prototype.hasOwnProperty.call(ADV_STAGE_ENV_TYPE, name)) return 0;
    v |= ADV_STAGE_ENV_TYPE[name];
  }
  return v;
};

// StageEnv (AdvStageEnvCommand.Execute): synchronous. The current stage's light group (UnityLighting quality),
// particle effect group (stage particle effects), stage volume profile (stage post effects) and focus positions (no
// gate, then the characters re-sort) switch to group Parameter2; Parameter1 picks which (AdvStageEnvType, All when it
// does not parse). No stage: a warning, nothing else.
export const StageEnv = (c, p) => {
  const ctx = p.ctx, stage = p.session.stage;
  if (!stage) { console.warn("StageEnv: no stage is set"); return Promise.resolve(); }
  const type = parseStageEnvType(c.Parameter1), index = intParam(c.Parameter2), q = ctx.quality;
  const light = () => { if (q.unityLighting) stage.changeLights(index); };
  const effect = () => { if (q.stageParticleEffect) stage.changeParticleEffects(index); };
  const post = () => { if (q.stagePostEffect) ctx.volume.applyStageAllVolume(stage, index); };
  const focus = () => { ctx.field.applyFocusStagePositions(stage, index); ctx.fieldRenderer.sortCharacters(); };
  switch (type) {
    case 0: light(); effect(); post(); focus(); break;
    case 1: light(); break;
    case 2: effect(); break;
    case 3: post(); break;
    case 4: focus(); break;
    default: console.warn(`StageEnv: unknown env type ${type}`);
  }
  return Promise.resolve();
};

// ColorUtility.TryParseHtmlString(s, out c) ? c : white (RimLight Parameter1)
const HTML_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const rimColor = (s) => {
  if (HTML_HEX.test(s ?? "")) return htmlColor(s);
  htmlColor(s);                         // raises for a colour name (their values are not implemented)
  return { r: 1, g: 1, b: 1, a: 1 };
};

// RimLight (AdvRimLightCommand.Execute): synchronous. A loaded character's rim light flips on / off on every row; the
// rim colour (Parameter1, white when it does not parse) and the shadow intensity (Parameter2, clamped by the character)
// are written either way. An unknown TargetName does nothing.
export const RimLight = (c, p) => {
  const ch = p.ctx.characters.get(c.TargetName);
  if (!ch) return Promise.resolve();
  if (typeof ch.setRimLightEnabled !== "function") throw new StoryCommandError("RimLight: the character has no rim light control");
  ch.setRimLightEnabled(!ch.isRimLightingEnabled);
  ch.setRimLightColor(rimColor(c.Parameter1));
  ch.setShadowIntensity(floatParam(c.Parameter2));
  return Promise.resolve();
};
