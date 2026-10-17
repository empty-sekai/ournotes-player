import { AnimClip } from "../../src/engine/anim.js";
import { Prefab } from "../../src/engine/prefab.js";

// Resource doubles for front-canvas state and layout tests. Geometry, components, and font bindings have separate ids.
export const uiResources = (spec, fonts, language) => {
  let next = 1;
  const prefabs = new Map(), bindings = {}, sprites = {};
  const windows = spec.nodes.filter((n) => n.talkWindow).map((n) => n.path);
  const cb = (cls, fields) => ({ type: "MonoBehaviour", script: `Test||${cls}`, pathId: String(next++), fields });
  const rootNode = (path) => ({ path, name: path.split("/").at(-1), active: true,
    localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 }, components: [] });
  const make = (id, source, list) => {
    const pathOf = (path) => path.replace(source, source.split("/").at(-1));
    const refs = (v) => {
      if (typeof v === "string" && v.startsWith("UIAdvWidget/")) return { gameObject: pathOf(v) };
      if (Array.isArray(v)) return v.map(refs);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, refs(x)]));
      return v;
    };
    const nodes = list.map((n) => {
      const r = { ...rootNode(pathOf(n.path)), rect: n.rect, active: n.active, components: [] };
      for (const k of ["localPosition", "localRotation", "localScale"]) r[k] = n[k];
      const add = (cls, fields) => { if (fields) r.components.push(cb(cls, fields)); };
      add("Canvas", n.canvas); add("CanvasScaler", n.canvasScaler); add("CanvasGroup", n.canvasGroup);
      if (n.image) add("Image", { ...n.image, m_Sprite: n.image.sprite, m_Material: n.image.material });
      add("HorizontalLayoutGroup", n.layoutGroup); add("ContentSizeFitter", n.contentSizeFitter); add("LayoutElement", n.layoutElement);
      add("UIAdvTalkWindow", n.talkWindow); add("AdvFlashView", refs(n.flashView)); add("AdvSubtitlesView", refs(n.subtitlesView));
      add("AdvTalkLogView", refs(n.talkLogView)); add("AdvChoiceView", refs(n.choiceView));
      if (n.ruleTransition) add("UIAdvRuleTransitionView", { _material: n.ruleTransition.material });
      if (n.tweenSequence) add("DOTweenSequence", { ...n.tweenSequence.raw, _list: n.tweenSequence.list });
      if (n.buttonImageState) add("ButtonImageState", { _target: refs(n.buttonImageState.target), _normaledSprite: n.buttonImageState.normal });
      if (n.safeAreaEdgeAnchor) add("UISafeAreaEdgeAnchor", { ...n.safeAreaEdgeAnchor, m_Enabled: n.safeAreaEdgeAnchor.enabled });
      for (const [cls, records] of Object.entries(n.behaviours || {})) for (const record of records) add(cls, refs(record));
      if (n.animator) add("Animator", { m_Controller: n.animator.controller, m_Enabled: n.animator.enabled,
        m_UpdateMode: n.animator.updateMode, m_KeepAnimatorStateOnDisable: n.animator.keepStateOnDisable });
      if (n.textStyle) {
        const t = fonts.texts[n.path], c = cb(t.class, { ...t, ...t.ruby, m_Enabled: t.enabled });
        r.components.push(c);
        bindings[`fixture:${c.pathId}`] = { style: n.textStyle, font: t.localized, localizeKoreanAdjust: t.localizeKoreanAdjust };
        if (t.spriteAsset) sprites[`fixture:${c.pathId}`] = { spriteAsset: t.spriteAsset };
        add("UIRubyText", t.uiRubyText);
      }
      return r;
    });
    if (nodes[0]?.path !== pathOf(source)) nodes.unshift(rootNode(pathOf(source)));
    const p = new Prefab({ key: id, nodes });
    prefabs.set(id, p);
    return p;
  };
  const widgetNodes = spec.nodes.filter((n) => !windows.some((w) => n.path === w || n.path.startsWith(`${w}/`)));
  const widget = make("fixture:widget", "UIAdvWidget", widgetNodes);
  const canvases = spec.widget?.canvases || [];
  for (const c of canvases) if (!widget.nodes.has(c.path)) {
    const n = rootNode(c.path); n.components.push(cb("Canvas", { m_SortingOrder: c.sortingOrder }));
    widget.nodes.set(c.path, { node: n });
  }
  widget.nodes.get("UIAdvWidget").node.components.push(cb("UIAdvWidget", { _canvases: canvases.map((c) => ({ gameObject: c.path })) }));
  const talkWindows = Object.fromEntries(windows.map((w, i) => {
    const id = `fixture:window${i}`;
    make(id, w, spec.nodes.filter((n) => n.path === w || n.path.startsWith(`${w}/`)));
    return [w.split("/").at(-1), id];
  }));
  const objects = {
    prefab: (id) => prefabs.get(id), id: (id) => id || null,
    mono: (id) => id === "dotween" ? spec.dotween : spec.transitions[id],
    uiBlur: () => spec.blur || null,
    material: (id) => ({ ...spec.materials[id], shader: spec.materials[id].shader.shader }),
    sprite: (id) => ({ ...spec.sprites[id], id, name: id, pixelsToUnits: spec.sprites[id].pixelsPerUnit,
      texture: { ...spec.textures[spec.sprites[id].texture], id: spec.sprites[id].texture } }),
    controller: (id) => {
      const ctrl = spec.controllers[id];
      return { name: ctrl.name, defaultState: ctrl.states.findIndex((s) => s.name === ctrl.defaultState),
        states: ctrl.states.map((s) => ({ ...s, writeDefaults: false, transitions: [],
          clip: spec.clips[`${ctrl.name}/${s.clip}`] ? AnimClip.fromCurves(spec.clips[`${ctrl.name}/${s.clip}`]) : null })),
        anyState: [], parameters: new Map() };
    },
  };
  for (const v of Object.values(spec.transitions)) v._texture = v._texture?.texture || null;
  const doc = { widget: "fixture:widget", talkWindows, language, letterbox: spec.letterBoxSprite,
    settings: { dotween: "dotween" }, graphics: { graphics: "graphics" } };
  const data = { fonts: { ...fonts, texts: bindings, sprites }, language: language.code, fontDir: "fonts",
    episode: { commands: Object.keys(talkWindows).map((name) => ({ cmd: "TalkWindow", TargetAssetName: name })) },
    asset: (address) => {
      const key = address.slice("Adv/Transition/".length);
      if (!spec.transitions[key]) throw new Error(`${address}: not in the data`);
      return { objects: [key] };
    } };
  return { doc, data, objects };
};
