// <ournotes-live2d>: the read-only properties added next to the player's (name, motionPlaying, looping, time, seed),
// before and after a player is attached. Without a DOM the element class is used on a bare instance with stand-ins
// for the attribute methods and the player.
import assert from "node:assert/strict";
import { test } from "node:test";
import { OurnotesLive2DElement } from "../../src/live2d/element.js";

const bare = (attrs = {}) => Object.assign(Object.create(OurnotesLive2DElement.prototype), {
  player: null,
  hasAttribute: (k) => k in attrs,
  getAttribute: (k) => (k in attrs ? attrs[k] : null),
});

test("element: name, motionPlaying, looping, time and seed read the player's once it is attached", () => {
  const el = bare({ seed: "42" });
  assert.deepEqual([el.name, el.motionPlaying, el.looping, el.time, el.seed], ["", false, false, 0, 42]);
  assert.equal(bare().seed, null);
  el.player = { name: "model", motionPlaying: true, looping: true, time: 1.5, seed: 7 };
  assert.deepEqual([el.name, el.motionPlaying, el.looping, el.time, el.seed], ["model", true, true, 1.5, 7]);
  for (const k of ["name", "motionPlaying", "looping", "time", "seed"])
    assert.equal(Object.getOwnPropertyDescriptor(OurnotesLive2DElement.prototype, k).set, undefined, `${k} is read only`);
});
