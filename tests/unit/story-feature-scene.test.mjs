// PostEffect child volumes, StageEnv, RimLight and Flash on stand-in scene objects. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerLoop } from "../../src/engine/loop.js";
import { commandHandler, createStoryUILayers } from "../../src/story/interfaces.js";
import { disposeStoryFeatures, installStoryFeatures } from "../../src/story/features/index.js";
import { postEffects } from "../../src/story/features/posteffect.js";
import { parseStageEnvType, rimColor } from "../../src/story/commands/stageenv.js";

const flush = () => new Promise((res) => setImmediate(res));
const steps = async (loop, n) => { await flush(); for (let i = 0; i < n; i++) await loop.step(); };

const makePlayer = ({ quality = {}, profiles = {} } = {}) => {
  const loop = new PlayerLoop(30);
  const calls = [];
  const volume = { children: [], marked: 0,
    addChildVolume(v) { if (!this.children.includes(v)) this.children.push(v); },
    removeChildVolume(v) { const i = this.children.indexOf(v); if (i >= 0) this.children.splice(i, 1); },
    markUpdateOnce() { this.marked++; },
    applyStageAllVolume(stage, i) { calls.push(["volume", stage.name, i]); } };
  const stage = { name: "st", changeLights(i) { calls.push(["lights", i]); }, changeParticleEffects(i) { calls.push(["effects", i]); } };
  const characters = new Map();
  const ui = { layers: createStoryUILayers(), flash(d) { calls.push(["flash", d]); return loop.delay(d); } };
  const ctx = { loop, ui, volume, quality: { unityLighting: true, stageParticleEffect: true, stagePostEffect: true, ...quality },
                field: { applyFocusStagePositions(st, i) { calls.push(["focus", st.name, i]); } },
                fieldRenderer: { sortCharacters() { calls.push(["sort"]); } },
                characters: { get: (n) => characters.get(n) }, episode: { commands: [] },
                story: { postEffects: "posteffects.json" }, assets: { json: () => ({ postEffects: profiles }) }, gl: null };
  const p = { ctx, playbackSpeed: 10, shortCutIndex: -1, session: { stage }, cancelled: false,
              speedRate() { return this.playbackSpeed / 10; }, get shortcut() { return this.shortCutIndex >= 0; },
              calcDuration(d, def = 0) { return this.shortcut ? 0 : (d ? Math.max(d, 0) : def) / this.speedRate(); },
              noWait(c, task) { return c.IsNoWait ? Promise.resolve() : task; } };
  return { ctx, p, loop, calls, characters, volume };
};

const profile = (name) => ({ asset: "VolumeProfile", name, components: [] });

test("PostEffect: toggles a child volume per profile name with OutQuad weight fades; a blank profile fades all out", async () => {
  const t = makePlayer({ profiles: { a: profile("pa"), b: profile("pb") } });
  await installStoryFeatures(t.ctx, t.p);
  const run = (row) => commandHandler("PostEffect")({ cmd: "PostEffect", ...row }, t.p);
  await run({ TargetAssetName: "a", Duration: 1 });                      // never waits
  const pe = postEffects(t.ctx), a = pe.children.get("pa");
  assert.deepEqual(t.volume.children, [a.volume]);                        // enabled at once, registered
  await steps(t.loop, 15);
  assert.ok(a.volume.weight > 0.7 && a.volume.weight < 0.8);              // OutQuad at half time
  await steps(t.loop, 20);
  assert.equal(a.volume.weight, 1);
  await run({ TargetAssetName: "b" });                                    // no fade: weight 1 at once
  const b = pe.children.get("pb");
  assert.deepEqual(t.volume.children, [a.volume, b.volume]);
  await run({ TargetAssetName: "a" });                                    // toggle off at once: unregistered
  assert.equal(a.volume.enabled, false);
  assert.deepEqual(t.volume.children, [b.volume]);
  await run({ TargetAssetName: "a" });                                    // on again: registered after b
  assert.deepEqual(t.volume.children, [b.volume, a.volume]);
  await run({ TargetAssetName: "", Parameter1: "0.5" });                  // blank: every child fades out
  await steps(t.loop, 20);
  assert.deepEqual(t.volume.children, []);
  assert.equal(a.volume.weight, 0);
  // a second fade-out during a fade-out disables the volume at once (the first one's finally runs in the kill)
  await run({ TargetAssetName: "b", Parameter1: "1" });
  await steps(t.loop, 40);
  await run({ TargetAssetName: "b", Parameter1: "1" });
  await steps(t.loop, 3);
  await run({ TargetAssetName: "", Parameter1: "1" });
  assert.deepEqual(t.volume.children, []);
  assert.ok(t.volume.marked >= 8);
  disposeStoryFeatures(t.ctx);
});

test("StageEnv: Enum.TryParse of the env type; quality gates; focus positions re-sort", async () => {
  assert.equal(parseStageEnvType("FocusPosition"), 4);
  assert.equal(parseStageEnvType(" Light "), 1);
  assert.equal(parseStageEnvType("light"), 0);                            // case-sensitive: fails -> All
  assert.equal(parseStageEnvType("Light, Effect"), 3);
  assert.equal(parseStageEnvType("7"), 7);
  assert.equal(parseStageEnvType(""), 0);
  const t = makePlayer({ quality: { unityLighting: false } });
  const run = (row) => commandHandler("StageEnv")({ cmd: "StageEnv", ...row }, t.p);
  await run({ Parameter1: "FocusPosition", Parameter2: "4" });
  assert.deepEqual(t.calls, [["focus", "st", 4], ["sort"]]);
  t.calls.length = 0;
  await run({ Parameter2: "2" });                                         // All, lights gated off
  assert.deepEqual(t.calls, [["effects", 2], ["volume", "st", 2], ["focus", "st", 2], ["sort"]]);
  t.calls.length = 0;
  const warn = console.warn; let w = 0; console.warn = () => { w++; };
  await run({ Parameter1: "9" });
  t.p.session.stage = null;
  await run({ Parameter1: "Light" });
  console.warn = warn;
  assert.equal(w, 2);
  assert.deepEqual(t.calls, []);
});

test("RimLight flips the rim light and writes colour and shadow intensity; Flash uses Duration or 0.3 s", async () => {
  assert.deepEqual(rimColor("nonsense"), { r: 1, g: 1, b: 1, a: 1 });
  assert.deepEqual(rimColor("#ff0000"), { r: 1, g: 0, b: 0, a: 1 });
  const t = makePlayer();
  const ch = { isRimLightingEnabled: false, log: [],
               setRimLightEnabled(v) { this.isRimLightingEnabled = v; this.log.push(["on", v]); },
               setRimLightColor(c) { this.log.push(["color", c.r]); }, setShadowIntensity(x) { this.log.push(["shadow", x]); } };
  t.characters.set("rana", ch);
  await commandHandler("RimLight")({ cmd: "RimLight", TargetName: "rana", Parameter1: "#ff0000", Parameter2: "0.5" }, t.p);
  await commandHandler("RimLight")({ cmd: "RimLight", TargetName: "rana" }, t.p);
  await commandHandler("RimLight")({ cmd: "RimLight", TargetName: "nobody" }, t.p);
  assert.deepEqual(ch.log, [["on", true], ["color", 1], ["shadow", 0.5], ["on", false], ["color", 1], ["shadow", 0]]);
  await commandHandler("Flash")({ cmd: "Flash", IsNoWait: 1 }, t.p);
  t.p.playbackSpeed = 20;
  const f = commandHandler("Flash")({ cmd: "Flash", Duration: 1 }, t.p);
  await steps(t.loop, 16);
  await f;
  assert.deepEqual(t.calls, [["flash", 0.3], ["flash", 0.5]]);
});
