// The In command of src/story/commands/character.js with a stand-in context: the character shown on the slot's stage,
// registered with the field renderer on the five slots only. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { In } from "../../src/story/commands/character.js";

const LAYERS = ["Camera1", "Camera2", "Camera3", "Camera4", "Camera5"];

const makePlayer = () => {
  const log = [];
  const stages = { 1: "stage1", 3: "stage3", 5: "stage5", 7: "stage7", 9: "stage9" };
  const ch = new Proxy({}, { get: (_, k) => (...a) => log.push([k, ...a]) });
  const p = {
    ctx: {
      ui: { setSpeakerName: (n) => log.push(["speaker", n]) },
      field: {
        existsCharacter: () => false,
        // GetStageTransform: null, with a warning, outside the five slots
        stageTransform: (pos) => stages[pos] ?? null,
      },
      characters: { get: (n) => (n === "anon" ? ch : undefined) },
      fieldRenderer: {
        registerCharacter: (c, layer) => {
          if (!LAYERS.includes(layer)) throw new Error(`layer ${layer}`);
          log.push(["register", layer]);
        },
        fadeCharacter: async (pos, dur, from, to) => { log.push(["fade", pos, dur, from, to]); },
      },
      quality: { unityLighting: true, characterPhysics: true, characterBreathMotion: true },
    },
    session: { eyeBlinkStoppedTargetNames: new Set(), placedPositions: [], targetNameToPosition: new Map(),
               positionToCharacter: new Map() },
    shortcut: false, isOverlay: false,
    calcDuration: (d) => d,
    noWait: (c, task) => task,
  };
  return { p, log, ch };
};

test("In on a slot: shown on the slot's stage and registered with its layer", async () => {
  const { p, log, ch } = makePlayer();
  await In({ cmd: "In", TargetName: "anon", PositionType: 5, Duration: 0.2 }, p);
  assert.deepEqual(log.find((e) => e[0] === "setParent"), ["setParent", "stage5"]);
  assert.deepEqual(log.filter((e) => e[0] === "register"), [["register", "Camera3"]]);
  assert.deepEqual(log.at(-1), ["fade", 5, 0.2, 0, 1]);
  assert.equal(p.session.positionToCharacter.get(5), ch);
});

test("In without a PositionType: shown without a stage, not registered, its position recorded as 0", async () => {
  const { p, log, ch } = makePlayer();
  await In({ cmd: "In", TargetName: "anon", Duration: 0.2, IsNoWait: 1 }, p);
  assert.ok(log.some((e) => e[0] === "show"));
  assert.deepEqual(log.find((e) => e[0] === "setParent"), ["setParent", null]);
  assert.equal(log.filter((e) => e[0] === "register").length, 0);
  assert.ok(log.some((e) => e[0] === "resetAngleLook"));
  assert.deepEqual(log.at(-1), ["fade", 0, 0.2, 0, 1]);
  assert.equal(p.session.targetNameToPosition.get("anon"), 0);
  assert.equal(p.session.positionToCharacter.get(0), ch);
});
