import { random as globalRandom } from "../../engine/random.js";

// Per-episode state of the story features, keyed by the StoryContext: the player core, the session's UnityRandom and
// whatever each feature keeps (views, tweens, controllers). installStoryFeatures fills it; a command that runs on a
// context without it (unit tests) gets a fresh one.
const states = new WeakMap();

export const featureState = (ctx) => {
  let s = states.get(ctx);
  if (!s) { s = { core: null, random: globalRandom, disposers: [] }; states.set(ctx, s); }
  return s;
};

export const dropFeatureState = (ctx) => { states.delete(ctx); };

// the per-feature slot of a context's state, created by make() on first use
export const featureSlot = (ctx, name, make) => {
  const s = featureState(ctx);
  if (!s[name]) s[name] = make(s);
  return s[name];
};
