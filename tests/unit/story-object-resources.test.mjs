import assert from "node:assert/strict";
import test from "node:test";
import { AssetStore } from "../../src/data/assets.js";
import { ObjectResources } from "../../src/engine/objects.js";
import { AdvStageData } from "../../src/story/stage.js";
import { uiTree, uiTextBinding } from "../../src/story/ui-objects.js";
import { StoryPlayerCore } from "../../src/story/player-core.js";
import { StoryData } from "../../src/story/data.js";
import { ModelObjects, node, mb, component, ref } from "./live2d-objects.mjs";

test("controllers resolve clips by object id even when clip names coincide", () => {
  const o = new ModelObjects();
  const clips = [0.2, 0.8].map((value) => o.clip({ name: "fade", bindings: [{ cls: "CanvasGroup", path: "", attribute: "m_Alpha" }], constant: [value] }));
  const ctrl = o.add("AnimatorController", "controller", { json: JSON.stringify({ name: "controller", layers: [{ stateMachine: 0 }], clips: clips.map(ref), parameters: [],
    stateMachines: [{ defaultState: 0, anyStateTransitions: [], states: clips.map((_, i) => ({ name: `state${i}`, speed: 1, writeDefaultValues: false,
      transitions: [], blendTrees: [[{ clip: i, children: [] }]] })) }] }) });
  const root = o.prefab([node("Root", [component("Animator", { m_Controller: ref(ctrl) })])]);
  const objects = new ObjectResources(new AssetStore({ objects: o.objects }), { bindings: [{ [root]: { Root: o.bindings } }] });
  const controller = objects.controller(ref(ctrl), root, "Root");
  assert.deepEqual(controller.states.map((s) => s.clip.curves[0].constant), [Math.fround(0.2), Math.fround(0.8)]);
  assert.equal(objects.controller(ctrl, root, "Root"), controller);
  assert.notEqual(controller.states[0].clip, controller.states[1].clip);
  assert.throws(() => objects.controller(root, root, "Root"), /not a AnimatorController/);
  assert.throws(() => objects.clip(clips[0], root, "Absent"), /bindings/);
});

test("prefab references resolve game objects, transforms and script components", () => {
  const o = new ModelObjects();
  const root = o.prefab([node("Root", [mb("Control", {})], { pathId: "100", transformPathId: "101" }),
    node("Root/Child", [{ ...component("Light", { m_Intensity: 2 }), pathId: "104" }], { pathId: "102", transformPathId: "103" })]);
  const resources = new ObjectResources(new AssetStore({ objects: o.objects })), p = resources.prefab(root);
  assert.equal(p.pathOf(ref("CAB-test:102")), "Root/Child");
  assert.equal(p.transformOf(ref("CAB-test:103")), p.transform("Root/Child"));
  assert.equal(p.componentOf(ref("CAB-test:104"), "Light").fields.m_Intensity, 2);
  assert.throws(() => p.componentOf(ref("CAB-test:104"), "Camera"), /expected Camera/);
  assert.throws(() => p.pathOf(ref("CAB-test:999")), /outside the hierarchy/);
});

test("stage profiles resolve by object identity even when their names coincide", () => {
  const o = new ModelObjects();
  const componentA = o.mono("Bloom", "Bloom", { intensity: { m_OverrideState: true, m_Value: 0.2 } });
  const componentB = o.mono("Bloom", "Bloom", { intensity: { m_OverrideState: true, m_Value: 0.9 } });
  const profiles = [componentA, componentB].map((c) => o.mono("VolumeProfile", "Profile", { components: [ref(c)] }));
  const root = o.prefab([node("Stage", [mb("AdvStage", {
    _backgroundSprite: null, _shadowTexture: null, _focusPointsCollection: { _entries: [] },
    _particleEffectGroupCollection: { _groups: [] }, _lightGroupCollection: { _groups: [] },
    _allVolumeProfileCollection: { _profiles: profiles.map(ref) },
  })])]);
  const resources = new ObjectResources(new AssetStore({ objects: o.objects }));
  const stage = new AdvStageData(resources.prefab(root), resources);
  assert.deepEqual(stage.volumeProfiles.map((p) => p.components[0].intensity.m_Value), [0.2, 0.9]);
  assert.equal(stage.volumeProfile(0), resources.profile(profiles[0]));
  assert.equal(stage.volumeProfile(0).components[0].asset, "Bloom");
});

test("parented UI instances keep font component identities and local reference targets", () => {
  const o = new ModelObjects(), rect = { m_AnchorMin: { x: 0, y: 0 }, m_AnchorMax: { x: 1, y: 1 },
    m_AnchoredPosition: { x: 0, y: 0 }, m_SizeDelta: { x: 0, y: 0 }, m_Pivot: { x: 0.5, y: 0.5 } };
  const root = o.prefab([node("Window", [mb("Control", { target: { transform: "Window/Text" } })], { rect }),
    node("Window/Text", [{ ...mb("TextMeshProUGUI", { m_fontSize: 30, m_Enabled: 1 }), pathId: "27" }], { rect })]);
  const resources = new ObjectResources(new AssetStore({ objects: o.objects })), nodes = new Map();
  const parent = { path: "Canvas/Talk", children: [] }, window = uiTree(resources, root, { parent, nodes });
  const text = window.ref(window.fields("Control").target);
  assert.equal(text.path, "Canvas/Talk/Window/Text");
  const font = { fontAsset: "Face", material: "Default", lineSpacing: 3 };
  const binding = uiTextBinding(text, { texts: { "CAB-test:27": { localized: { fontAsset: "Source Face" }, font } } });
  assert.equal(binding.id, "CAB-test:27");
  assert.equal(binding.m_fontSize, 30);
  assert.equal(binding.localized, font);
  assert.throws(() => uiTextBinding(text, { texts: {} }), /no font binding/);
});

test("camera focus settings are read through the referenced asset", () => {
  const o = new ModelObjects();
  const id = o.mono("AdvFocusDataSettings", "Focus", { _focusData: [{ _cameraDistance: 2, _fov: 30 }] });
  const objects = new ObjectResources(new AssetStore({ objects: o.objects }));
  const ctx = { objects, settings: { player: { _focusDataSettingsMap: { _list: [{ Key: "near", Value: ref(id) }] } } } };
  assert.equal(StoryPlayerCore.prototype.focusDataSettings.call({ ctx }, "near")._focusData[0]._fov, 30);
  assert.equal(StoryPlayerCore.prototype.focusDataSettings.call({ ctx }, "missing"), null);
});

test("CRI Lips and shared chat documents are resolved under their product directories", () => {
  const parts = { crilips: "crilips/default.json", chat: "storychat/default.json" };
  const weights = new Uint8Array(new Float32Array([0.25, 0.75]).buffer);
  const assets = new AssetStore({ info: { product: "story", dir: "stories/1", products: {} }, text: {
    "stories/1/story.json": JSON.stringify({ episode: "episode.json", parts }), "stories/1/episode.json": "{}",
    "crilips/default/crilips.json": JSON.stringify({ dimensions: [2] }),
    "storychat/default/chat.json": JSON.stringify({ format: 1, text: [], sounds: [], cueSheets: [] }),
  }, bytes: { "crilips/default/crilips.bin": weights } });
  const data = new StoryData(assets);
  assert.deepEqual(data.crilips.descriptor.dimensions, [2]);
  assert.deepEqual([...new Float32Array(data.crilips.data)], [0.25, 0.75]);
  assert.deepEqual(data.chat.sounds, []);
});
