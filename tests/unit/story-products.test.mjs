import assert from "node:assert/strict";
import { test } from "node:test";
import { StoryData } from "../../src/story/data.js";
import { fetchStoryProduct, loadStoryProducts } from "../../src/story/store.js";
import { Audio } from "../../src/engine/audio.js";
import { SilentAudio } from "../../src/story/silent-audio.js";

import { STORY_ROOT as ROOT, storyFixture as fixture } from "./story-product-fixture.mjs";

test("a missing product cue completes silently while the next sound keeps its timing", async () => {
  const f = fixture();
  f.product(f.parts.sounds.sheet, "story.sound", "sheet", {
    "cues.json": { voice: { file: "voice.m4a", categories: ["Voice"], sampleRate: 48000, samples: 48000 } },
    "voice.m4a": new Uint8Array([0]),
  });
  const data = new StoryData(await loadStoryProducts(`${ROOT}stories/7.json`, { fetch: f.fetch, lang: "ja" }));
  const episode = {
    sounds: { 1: { _soundCueSheetID: 1, _cueName: "absent", _category: 2 },
              2: { _soundCueSheetID: 1, _cueName: "voice", _category: 2 } },
    cuesheets: { 1: { _cueSheetName: "sheet" } },
  };
  const loop = { time: 0 };
  const audio = new SilentAudio(Audio.episodeResolver(episode, data), loop, { assets: data.store });
  await audio.preload([1, 2]);
  let started;
  const missing = audio.play(1, { onPlayStart: (info) => { started = info; } });
  assert.equal(started.meta.missing, true);
  const finished = audio.whenFinished(started);
  audio.update();
  await finished;
  assert.equal(audio.isPlaying(missing), false);
  const voice = audio.play(2);
  audio.update();
  assert.equal(audio.isPlaying(voice), true);
  loop.time = 1;
  audio.update();
  assert.equal(audio.isPlaying(voice), false);
});

test("story products load one language and resolve model, asset, cue and video files", async () => {
  const f = fixture();
  const store = await loadStoryProducts(`${ROOT}stories/7.json`, { fetch: f.fetch, lang: "ja" });
  const data = new StoryData(store);
  assert.equal(data.episode.advId, 7);
  assert.deepEqual(store.info.story.titles, { ja: "Example", en: "Test" });
  assert.equal(data.ui.language.code, "ja");
  assert.equal(data.fontDir, "storyfonts/7_ja");
  assert.deepEqual(data.scene.scene, ["cab:1"]);
  assert.equal(data.model("Character/Live2D/g/m/model/m").dir, "models/m");
  assert.equal(data.asset("Adv/Stage/a").prefab, "cab:2");
  assert.equal(data.cues("sheet").voice.file, "cuesheets/sheet/voice.m4a");
  assert.deepEqual(data.cues("sheet").voice.categories, ["Voice", "VoiceConfig"]);
  assert.equal(data.video("Cri/Video/movie").file, "videos/movie/movie.webm");
  assert.equal(data.host, null);
  assert.ok(!f.requested.some((url) => url.endsWith("/en.json") || url.endsWith("7_en.json")));
  assert.equal(new Set(f.requested).size, f.requested.length);
});

test("Overlay products include their host and simple UI", async () => {
  const f = fixture({ overlay: true });
  const data = new StoryData(await loadStoryProducts(`${ROOT}stories/7.json`, { fetch: f.fetch, lang: "ja" }));
  assert.equal(data.host.kind, "afterlive");
  assert.equal(data.simpleui.format, "nnnotes.story-simple-ui/1");
});

test("unsupported commands fail before fetching scene or media products", async () => {
  const f = fixture({ command: "UnknownCommand" });
  await assert.rejects(fetchStoryProduct(`${ROOT}stories/7.json`, { fetch: f.fetch }), /UnknownCommand/);
  assert.ok(!f.requested.some((url) => url.includes("storyscenes") || url.includes("cuesheets")));
});

test("language and product identities are checked before combining data", async () => {
  const f = fixture();
  await assert.rejects(loadStoryProducts(`${ROOT}stories/7.json`, { fetch: f.fetch }), /language is required/);
  await assert.rejects(loadStoryProducts(`${ROOT}stories/7.json`, { fetch: f.fetch, lang: "ko" }), /no ui for language ko/);
  f.product(f.parts.ui.ja, "story.ui", "en", { "ui.json": { format: 1 } });
  await assert.rejects(loadStoryProducts(`${ROOT}stories/7.json`, { fetch: f.fetch, lang: "ja" }), /expected story.ui product of ja/);
});

test("an already fetched index is reused and cancellation is observed", async () => {
  const f = fixture();
  const head = await fetchStoryProduct(`${ROOT}stories/7.json`, { fetch: f.fetch });
  const store = await loadStoryProducts(head.url, { head, lang: "ja" });
  assert.equal(store.info.loadedLanguage, "ja");
  assert.equal(f.requested.filter((url) => url === head.url).length, 1);
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(loadStoryProducts(head.url, { head, lang: "ja", signal: controller.signal }), /cancelled/);
});


test("a story product can keep cue metadata with sound streams disabled", async () => {
  const f = fixture();
  const manifest = JSON.parse(new TextDecoder().decode(f.files.get("stories/7.json")));
  manifest.audio = false;
  f.files.set("stories/7.json", new TextEncoder().encode(JSON.stringify(manifest)));
  const store = await loadStoryProducts(ROOT + "stories/7.json", { fetch: f.fetch, lang: "ja" });
  const data = new StoryData(store);
  assert.equal(data.hasSounds, false);
  assert.ok(data.parts.sounds.sheet);
});
