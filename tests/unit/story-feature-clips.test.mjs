// AnimRecords: controllers and clips written once per data file resolve across prefabs. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AnimRecords } from "../../src/story/features/clips.js";

const FLT_MIN = -3.4028234663852886e+38;
const clip = (name, to) => ({ clip: name, sampleRate: 60, wrapMode: 0, startTime: 0, stopTime: 1, loopTime: false, cycleOffset: 0,
  events: [], bindings: [{ path: "", typeID: 225, class: "CanvasGroup", attribute: "m_Alpha" }],
  streamed: { curveCount: 1, frames: [[FLT_MIN, [[0, 0, 0, 0, 0]]], [0, [[0, 0, 0, to, 0]]], [1, [[0, 0, 0, 0, to]]]] },
  dense: { curveCount: 0 }, constant: [] });
const ctrl = (name, clips) => ({ controller: name, name, parameters: [], defaultValues: [],
  layers: [{ name: "Base Layer", stateMachine: 0 }],
  clips, stateMachines: [{ defaultState: 0, anyStateTransitions: [], states: clips.map((c, i) => ({
    name: `s${i}`, speed: 1, cycleOffset: 0, loop: false, writeDefaultValues: true, mirror: false, speedParam: "", timeParam: "",
    blendTrees: [[{ clip: i, children: [] }]], transitions: [] })) }] });

test("AnimRecords: a controller or clip reference resolves to the file's full record; ambiguous names raise", () => {
  const doc = { frames: {
    a: { nodes: [{ components: [{ type: "Animator", m_Controller: ctrl("c", [clip("in", 1), { clip: "in" }]) }] }] },
    b: { nodes: [{ components: [{ type: "Animator", m_Controller: { controller: "c" } }] }] },
    d: { nodes: [{ components: [{ type: "Animator", m_Controller: ctrl("d", [{ clip: "in" }]) }] }] },
  } };
  const r = new AnimRecords(doc);
  const full = doc.frames.a.nodes[0].components[0].m_Controller;
  assert.equal(r.controller({ controller: "c" }, "b"), full);
  assert.equal(r.controller(null, "x"), null);
  assert.throws(() => r.controller({ object: "AnimatorOverrideController" }, "x"), /not exported/);
  assert.throws(() => r.controller({ controller: "nope" }, "x"), /controller nope not in the data/);
  const c = r.controllerOf(full, "a");
  assert.equal(c.states[0].clip, c.states[1].clip);                       // the repeated clip is one clip
  const d = r.controllerOf(doc.frames.d.nodes[0].components[0].m_Controller, "d");
  assert.equal(d.states[0].clip.length, 1);                               // a clip of another prefab's controller
  const two = new AnimRecords({ x: [clip("in", 1), clip("in", 2)] });
  assert.throws(() => two.controllerOf(ctrl("e", [{ clip: "in" }]), "e"), /two different clips named in/);
});
