// The story list page's listing functions (examples/story-list/listing.js) over a synthetic stories.json that the
// stories schema accepts: regions, languages, titles, group labels, first download sizes, region manifests.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "../../scripts/lib/json-schema.mjs";
import { firstLoad, groupLabel, languagesFor, manifestFor, nameIn, pickLanguage, pickRegion, queryString, storiesFor,
  storyKind, storyTitle } from "../../examples/story-list/listing.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const stories = compile(JSON.parse(fs.readFileSync(path.join(here, "..", "..", "schema", "stories.schema.json"), "utf8")));

const entry = (advId, extra = {}) => ({
  id: String(advId), advId, manifest: `stories/${advId}.json`, asset: `adv_${advId}`, sheetName: "s", playbackMode: 0,
  titles: { ja: `ja${advId}`, en: `en${advId}` }, groups: [], commands: ["Talk"], commandCount: 10, language: "en",
  languages: ["ja", "en"], audio: true, audioFormat: "aac", fonts: "open", size: { common: 1048576, languages: { ja: 524288, en: 262144 } },
  ...extra,
});
const names = (ja, en) => ({ ja, en });
const index = {
  format: "ournotes.stories/1", language: "en", languages: ["ja", "en", "zh-Hant"],
  regions: [{ id: "jp", name: "Japan", languages: ["ja"] }, { id: "tw", name: "Taiwan", languages: ["zh-Hant", "en"] }],
  stories: [
    entry(1, { groups: [{ kind: "chapter", id: 11, episodeNumber: 3, chapter: { id: 5, names: names("第一章", "Chapter 1"), bandId: 1 }, characters: [] }] }),
    entry(2, { regions: ["jp"], groups: [{ kind: "friendship", id: 12, episodeNumber: 1, characters: [{ id: 1, names: names("あ", "A") }, { id: 2, names: names("い", "B") }] }] }),
    entry(2, { regions: ["tw"], manifest: "stories/tw/2.json", titles: { "zh-Hant": "二" }, language: "zh-Hant", languages: ["zh-Hant"],
               size: { common: 100, languages: { "zh-Hant": 50 } } }),
    entry(3, { groups: [{ kind: "spotTalk", id: 13, spot: { id: 7, names: names("カフェ", "Cafe") }, characters: [{ id: 1, names: names("あ", "A") }] }] }),
    entry(4, { groups: [{ kind: "spot", id: 7, spot: { id: 7, names: names("カフェ", "Cafe") }, characters: [] }], titles: {} }),
  ],
};

test("the synthetic index is a valid stories.json", () => {
  assert.deepEqual(stories(index), []);
});

test("regions and languages", () => {
  assert.equal(pickRegion(index, "tw"), "tw");
  assert.equal(pickRegion(index, "kr"), "jp");
  assert.equal(pickRegion({ stories: [] }, "tw"), null);
  assert.deepEqual(languagesFor(index, "tw"), ["zh-Hant", "en"]);
  assert.deepEqual(languagesFor(index, null), ["ja", "en", "zh-Hant"]);
  assert.equal(pickLanguage(index, "tw", "ja"), "en");            // not offered in tw: the index's language
  assert.equal(pickLanguage(index, "jp", "en"), "ja");            // only ja offered in jp
  assert.equal(pickLanguage(index, "tw", "zh-Hant"), "zh-Hant");
  assert.deepEqual(storiesFor(index, "jp").map((s) => s.manifest), ["stories/1.json", "stories/2.json", "stories/3.json", "stories/4.json"]);
  assert.deepEqual(storiesFor(index, "tw").map((s) => s.manifest), ["stories/1.json", "stories/tw/2.json", "stories/3.json", "stories/4.json"]);
  assert.equal(storiesFor(index, null).length, 5);
});

test("titles, kinds and group labels", () => {
  const [s1, s2, s2tw, s3, s4] = index.stories;
  assert.equal(storyTitle(s1, "ja"), "ja1");
  assert.equal(storyTitle(s2tw, "en"), "二");                    // no en title: the entry's language
  assert.equal(storyTitle(s4, "en"), "#4");
  assert.equal(nameIn({ ko: "k" }, "en", "ja"), "k");
  assert.deepEqual(index.stories.map(storyKind), ["chapter", "friendship", "other", "spotTalk", "spot"]);
  assert.equal(groupLabel(s1, "en"), "Chapter 1 #3");
  assert.equal(groupLabel(s2, "ja"), "あ & い #1");
  assert.equal(groupLabel(s3, "en"), "Cafe · A");
  assert.equal(groupLabel(s4, "ja"), "カフェ");
  assert.equal(groupLabel(s2tw, "en"), "");
});

test("first download, region manifests, query strings", () => {
  const [s1, , s2tw] = index.stories;
  assert.equal(firstLoad(s1, "ja"), 1048576 + 524288);
  assert.equal(firstLoad(s1, "ko"), 1048576 + 262144);           // no ko group: the default language's
  assert.equal(firstLoad(s2tw, "zh-Hant"), 150);
  assert.equal(manifestFor(index, 2, "tw"), "stories/tw/2.json");
  assert.equal(manifestFor(index, "2", "jp"), "stories/2.json");
  assert.equal(manifestFor(index, 9, "jp"), "stories/9.json");
  assert.equal(queryString({ story: 2, region: "tw", lang: null, kind: "" }), "?story=2&region=tw");
  assert.equal(queryString({ a: undefined }), "");
});
