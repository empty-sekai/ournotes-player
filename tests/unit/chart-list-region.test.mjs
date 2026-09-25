// Region and language choice of the chart list page (examples/chart-list/listing.js). Synthetic indexes only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chartText, chartsFor, languagesFor, manifestFor, pickLanguage, pickRegion, queryString }
  from "../../examples/chart-list/listing.js";

const index = {
  format: 2,
  language: "zh-Hant",
  languages: ["ja", "en", "zh-Hant", "ko"],
  regions: [{ id: "tw", name: "A", languages: ["zh-Hant", "en", "xx"] }, { id: "en", name: "B" },
            { id: "kr", name: "C", languages: ["ko"] }],
  charts: [
    { id: "1_easy", musicId: 1, difficulty: "easy", manifest: "charts/1_easy.json", regions: ["tw", "en", "kr"],
      title: "曲", titles: { ja: "曲", en: "Song", ko: "노래" }, bands: ["甲"], bandNames: { en: ["A"], ko: [] } },
    { id: "1_expert", musicId: 1, difficulty: "expert", manifest: "charts/1_expert.json", regions: ["tw", "en"],
      title: "曲" },
    { id: "1_expert", musicId: 1, difficulty: "expert", manifest: "charts/kr/1_expert.json", regions: ["kr"],
      title: "曲" },
    { id: "2_hard", musicId: 2, difficulty: "hard", manifest: "charts/2_hard.json", title: "" },
  ],
};

test("region: the wanted one, else the first; none without regions", () => {
  assert.equal(pickRegion(index, "kr"), "kr");
  assert.equal(pickRegion(index, "jp"), "tw");
  assert.equal(pickRegion(index, null), "tw");
  assert.equal(pickRegion({ charts: [] }, "kr"), null);
  assert.equal(pickRegion({ regions: [{ name: "no id" }] }, "x"), null);
});

test("languages of a region and the language shown", () => {
  assert.deepEqual(languagesFor(index, "tw"), ["zh-Hant", "en"]);       // the region's, that the index has texts in
  assert.deepEqual(languagesFor(index, "en"), index.languages);          // no own list: every language
  assert.deepEqual(languagesFor({ charts: [] }, null), []);
  assert.equal(pickLanguage(index, "tw", "en"), "en");
  assert.equal(pickLanguage(index, "tw", "ko"), "zh-Hant");               // not offered there: the index language
  assert.equal(pickLanguage(index, "kr", null), "ko");                    // index language not offered: the first
  assert.equal(pickLanguage({ charts: [] }, null, "en"), null);
});

test("charts of a region", () => {
  const ids = (r) => chartsFor(index, r).map((c) => c.manifest);
  assert.deepEqual(ids("tw"), ["charts/1_easy.json", "charts/1_expert.json", "charts/2_hard.json"]);
  assert.deepEqual(ids("kr"), ["charts/1_easy.json", "charts/kr/1_expert.json", "charts/2_hard.json"]);
  assert.equal(chartsFor(index, null).length, 4);
  assert.deepEqual(chartsFor({}, "tw"), []);
});

test("texts of an entry in a language, with fallbacks", () => {
  const [easy, , , hard] = index.charts;
  assert.deepEqual(chartText(easy, "en"), { title: "Song", bands: ["A"] });
  assert.deepEqual(chartText(easy, "ko"), { title: "노래", bands: [] });
  assert.deepEqual(chartText(easy, "zh-Hans"), { title: "曲", bands: ["甲"] });
  assert.deepEqual(chartText(easy, null), { title: "曲", bands: ["甲"] });
  assert.deepEqual(chartText(hard, "en"), { title: "2", bands: [] });
});

test("manifest of a chart in a region", () => {
  assert.equal(manifestFor(index, 1, "expert", "kr"), "charts/kr/1_expert.json");
  assert.equal(manifestFor(index, "1", "expert", "tw"), "charts/1_expert.json");
  assert.equal(manifestFor(index, 3, "easy", "tw"), "charts/3_easy.json");
  assert.equal(manifestFor({ charts: [] }, 1, "easy"), "charts/1_easy.json");
});

test("query strings", () => {
  assert.equal(queryString({ music: 1, difficulty: "easy", site: null, region: "kr", lang: "" }),
               "?music=1&difficulty=easy&region=kr");
  assert.equal(queryString({ a: undefined }), "");
  assert.equal(queryString({ lang: "zh-Hant", site: "https://x/y/" }), "?lang=zh-Hant&site=https%3A%2F%2Fx%2Fy%2F");
});
