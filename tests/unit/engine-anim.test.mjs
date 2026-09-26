// engine/anim.js: Mecanim clips with discrete PPtr curves (SpriteRenderer.m_Sprite) in the streamed clip, next to float
// curves; the Animator writing the mapped objects. Synthetic clips only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AnimClip, AnimController, AnimError, Animator } from "../../src/engine/anim.js";

const F = Math.fround, NEG = -3.4028234663852886e38;
const sprites = [{ sprite: "s0" }, { sprite: "s1" }, { sprite: "s2" }];

// a float curve (curve 0: GameObject m_IsActive-like, constant segments) and a PPtr curve (curve 1)
const rawClip = (over = {}) => ({
  clip: "sheet", sampleRate: 60, wrapMode: 0, startTime: 0, stopTime: 0.2, loopTime: true, cycleOffset: 0,
  bindings: [
    { path: "Glow", typeID: 1, class: "GameObject", attribute: "m_IsActive" },
    { path: "Shadow", typeID: 212, class: "SpriteRenderer", attribute: null, pptr: true, attributeCrc: 0 },
  ],
  streamed: {
    curveCount: 1, discreteCurveCount: 1,
    frames: [[NEG, [[0, 0, 0, 0, 1], [1, 0, 0, 0, 0]]], [0.05, [[1, 0, 0, 0, 1]]], [0.1, [[0, 0, 0, 0.5, 0], [1, 0, 0, 0, 2]]],
             [0.15, [[1, 0, 0, 0, -1]]]],
  },
  dense: { curveCount: 0, frameCount: 0, sampleRate: 60, beginTime: 0, samples: [] },
  constant: [], pptrCurveMapping: sprites, events: [],
  ...over,
});

const at = (clip, t) => { const v = []; clip.sample(t, (i, x) => { v[i] = x; }); return v; };

test("fromMecanim: streamed PPtr curves step through pptrCurveMapping; float curves stay cubic", () => {
  const clip = AnimClip.fromMecanim(rawClip());
  assert.deepEqual(clip.curves.map((c) => c.binding.attr), ["m_IsActive", "m_Sprite"]);
  assert.deepEqual(at(clip, 0), [1, sprites[0]]);
  assert.deepEqual(at(clip, 0.049), [1, sprites[0]]);
  assert.deepEqual(at(clip, F(0.05)), [1, sprites[1]]);                     // a key at t belongs to t
  assert.deepEqual(at(clip, 0.12), [F(F(0.5) * F(F(0.12) - F(0.1))), sprites[2]]);
  assert.deepEqual(at(clip, 0.16), [F(F(0.5) * F(F(0.16) - F(0.1))), null]);    // a negative index: no object
  assert.deepEqual(at(clip, 0.2 + 0.06), [1, sprites[1]]);                  // looping: 0.26 wraps to 0.06
});

test("fromMecanim: only streamed SpriteRenderer PPtr curves; the counts must match the bindings", () => {
  const b = rawClip().bindings;
  assert.throws(() => AnimClip.fromMecanim(rawClip({ bindings: [b[0], { ...b[1], typeID: 114, class: "MonoBehaviour" }] })),
                /PPtr curve MonoBehaviour/);
  assert.throws(() => AnimClip.fromMecanim(rawClip({ bindings: [b[0], { ...b[1], attributeCrc: 1234 }] })), AnimError);
  assert.throws(() => AnimClip.fromMecanim(rawClip({ streamed: { ...rawClip().streamed, discreteCurveCount: 0 } })),
                /binding count/);
  assert.throws(() => AnimClip.fromMecanim(rawClip({ dense: { curveCount: 1 } })), /dense/);
  assert.throws(() => AnimClip.fromMecanim(rawClip({ discreteCurveCount: 1 })), /outside the streamed clip/);
  const bad = rawClip();
  bad.streamed.frames[2][1][1][4] = 3;
  assert.throws(() => at(AnimClip.fromMecanim(bad), 0.1), /outside pptrCurveMapping/);
});

test("Animator: a PPtr curve writes the mapped object; write defaults restore the bound one; no cross-fade over it", () => {
  const clip = AnimClip.fromMecanim(rawClip());
  const raw = {
    name: "ctrl", layers: [{ stateMachine: 0 }], clips: [{ clip: "sheet" }], parameters: [{ name: "go", type: 9 }],
    stateMachines: [{ defaultState: 0, anyStateTransitions: [], states: [
      { name: "A", speed: 1, writeDefaultValues: true, blendTrees: [[{ clip: 0, children: [] }]],
        transitions: [{ destination: 1, duration: 0.1, offset: 0, exitTime: 0, hasExitTime: false, fixedDuration: true,
                        canTransitionToSelf: false, conditions: [{ mode: 1, event: "go", threshold: 0 }] }] },
      { name: "B", speed: 1, writeDefaultValues: true, blendTrees: [], transitions: [] },
    ] }],
  };
  const ctrl = AnimController.fromMecanim(raw, () => clip);
  const target = { sprite: { sprite: "start" }, active: 0 };
  const anim = new Animator(ctrl, (b) => (b.attr === "m_Sprite" ? { get: () => target.sprite, set: (v) => { target.sprite = v; } }
    : { get: () => target.active, set: (v) => { target.active = v; } }));
  anim.update(F(0.06));
  assert.equal(target.sprite, sprites[1]);
  assert.equal(target.active, 1);
  anim.setTrigger("go");
  assert.throws(() => anim.update(F(1 / 60)), /cross-fade over a discrete/);
});
