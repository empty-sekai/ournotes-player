// Region and language choice of the chart list page: pure functions over charts.json (its `regions`, `language`,
// `languages`, and the entries' `regions`, `titles`, `bandNames`, `manifest`). An index without these keys (a site of
// one region, texts in one language) lists every chart with its `title` and `bands`.

const regionList = (index) => (Array.isArray(index && index.regions) ? index.regions : [])
  .filter((r) => r && typeof r.id === "string");

// The region shown: `wanted` when the index has it, else the index's first region; null for an index without regions.
export const pickRegion = (index, wanted) => {
  const rs = regionList(index);
  if (!rs.length) return null;
  return (rs.find((r) => r.id === wanted) || rs[0]).id;
};

// The languages offered in a region: the region's `languages` that the index has texts in, else every language of
// the index (`languages`).
export const languagesFor = (index, region) => {
  const all = Array.isArray(index && index.languages) ? index.languages : [];
  const r = regionList(index).find((x) => x.id === region);
  const own = r && Array.isArray(r.languages) ? r.languages.filter((l) => all.includes(l)) : [];
  return own.length ? own : all;
};

// The language shown: `wanted` when offered, else the index's `language` when offered, else the first one offered;
// null when the index has no languages.
export const pickLanguage = (index, region, wanted) => {
  const offered = languagesFor(index, region);
  if (offered.includes(wanted)) return wanted;
  if (offered.includes(index && index.language)) return index.language;
  return offered.length ? offered[0] : null;
};

// The entries of a region, in index order (region null: every entry; an entry without `regions` serves every region).
export const chartsFor = (index, region) => ((index && index.charts) || [])
  .filter((c) => region === null || !Array.isArray(c.regions) || c.regions.includes(region));

// Title and band names of an entry in `lang` (its `titles` / `bandNames`), else its `title` / `bands`.
export const chartText = (c, lang) => {
  const t = lang && c.titles && c.titles[lang];
  const b = lang && c.bandNames && c.bandNames[lang];
  return { title: typeof t === "string" && t ? t : c.title || String(c.musicId),
           bands: Array.isArray(b) ? b : c.bands || [] };
};

// The manifest path of a chart in a region: the manifest of the region's entry, else charts/<id>.json.
export const manifestFor = (index, music, difficulty, region) => {
  const id = `${music}_${difficulty}`;
  const e = chartsFor(index, region === undefined ? null : region).find((c) => c.id === id);
  return e && typeof e.manifest === "string" ? e.manifest : `charts/${id}.json`;
};

// "?k=v&..." of the parameters that have a value (null, undefined and "" are left out); "" when none has.
export const queryString = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};
