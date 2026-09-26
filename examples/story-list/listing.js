// Region, language and label choice of the story list page: pure functions over stories.json (its `regions`,
// `language`, `languages`, and the entries' `regions`, `titles`, `groups`, `languages`, `size`, `manifest`).

const regionList = (index) => (Array.isArray(index && index.regions) ? index.regions : [])
  .filter((r) => r && typeof r.id === "string");

// The region shown: `wanted` when the index has it, else the index's first region; null for an index without regions.
export const pickRegion = (index, wanted) => {
  const rs = regionList(index);
  if (!rs.length) return null;
  return (rs.find((r) => r.id === wanted) || rs[0]).id;
};

// The languages offered in a region: the region's `languages` that the index has, else every language of the index.
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
export const storiesFor = (index, region) => ((index && index.stories) || [])
  .filter((s) => region === null || !Array.isArray(s.regions) || s.regions.includes(region));

// A name in `lang` from a `names` / `titles` object, else in `fallback`, else the first one; "" when there is none.
export const nameIn = (names, lang, fallback) => {
  if (!names || typeof names !== "object") return "";
  for (const l of [lang, fallback]) if (l && typeof names[l] === "string" && names[l]) return names[l];
  const first = Object.values(names).find((v) => typeof v === "string" && v);
  return first || "";
};

// The title of an entry in `lang` (else its manifest's default language, else any), or "#<advId>".
export const storyTitle = (s, lang) => nameIn(s.titles, lang, s.language) || `#${s.advId}`;

// The kind of the entry's first group ("chapter", "friendship", "spotTalk", "liveResult", "spot"), or "other".
export const storyKind = (s) => (Array.isArray(s.groups) && s.groups.length ? s.groups[0].kind : "other");

// Where the game lists the entry, from its first group: the chapter and episode number, the characters of a
// friendship story or a live result, the spot (and character) of a spot talk or a spot's own episode.
export const groupLabel = (s, lang) => {
  const g = Array.isArray(s.groups) && s.groups[0];
  if (!g) return "";
  const chars = (g.characters || []).map((c) => nameIn(c.names, lang, s.language)).filter(Boolean);
  const num = Number.isInteger(g.episodeNumber) ? ` #${g.episodeNumber}` : "";
  switch (g.kind) {
    case "chapter": return `${nameIn(g.chapter && g.chapter.names, lang, s.language)}${num}`;
    case "friendship": return `${chars.join(" & ")}${num}`;
    case "spotTalk": return [nameIn(g.spot && g.spot.names, lang, s.language), chars.join(" & ")].filter(Boolean).join(" · ");
    case "liveResult": return chars.join(" & ");
    case "spot": return nameIn(g.spot && g.spot.names, lang, s.language);
    default: return "";
  }
};

// Bytes a player fetches to start the entry in `lang`: the common files and that language's group (the manifest's
// default language when the entry has no group for `lang`).
export const firstLoad = (s, lang) => {
  const size = s.size || {}, groups = size.languages || {};
  const l = lang in groups ? lang : s.language;
  return (size.common || 0) + (groups[l] || 0);
};

// The manifest path of a story in a region: the manifest of the region's entry, else stories/<advId>.json.
export const manifestFor = (index, advId, region) => {
  const e = storiesFor(index, region === undefined ? null : region).find((s) => String(s.advId) === String(advId));
  return e && typeof e.manifest === "string" ? e.manifest : `stories/${advId}.json`;
};

// "?k=v&..." of the parameters that have a value (null, undefined and "" are left out); "" when none has.
export const queryString = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};
