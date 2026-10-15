import { AssetStore } from "../data/assets.js";
import { LIVE_PRODUCT } from "./store.js";
import { LIVE_JSON_FORMAT, MUSIC_FORMAT, SOUNDS_FORMAT } from "./data.js";

// Charts of the site layout with a live directory (docs/data-format.md "Chart manifest"): a chart manifest without
// `schema` whose files are a live.json index, the score, audio/live-audio.json with its waveforms, livescene/ and
// livenotes/. legacyLive() reads such a store as the store of a live: a live.json of the live product, sounds.json and
// music.json of the live.sounds and live.music products, so ChartSession reads both through LiveData.

// whether `store` holds a chart of the site layout with a live directory (no product `schema`, a live.json)
export const isLegacyLive = (store) => !!store && (!store.info || store.info.schema === undefined) && store.has("live.json");

// A store over another one: files added in memory (`text`) and files that are another path of the inner store
// (`alias`); every other path reads the inner store as it is.
class OverlayStore extends AssetStore {
  constructor(inner, { text = {}, alias = {}, info = null } = {}) {
    super({ text, info });
    this.inner = inner;
    this.alias = new Map(Object.entries(alias));
  }

  _path(p) { return this.alias.get(p) ?? p; }
  has(p) { return this._text.has(p) || this.inner.has(this._path(p)); }
  text(p) { return this._text.has(p) ? this._text.get(p) : this.inner.text(this._path(p)); }
  bytes(p) { return this._text.has(p) ? super.bytes(p) : this.inner.bytes(this._path(p)); }
  json(p) { return this._text.has(p) ? super.json(p) : this.inner.json(this._path(p)); }
  image(p) { return this.inner.image(this._path(p)); }
  list(prefix = "") {
    return [...new Set([...this._text.keys(), ...this.alias.keys(), ...this.inner.list()])].filter((k) => k.startsWith(prefix)).sort();
  }
}

// The store of a chart of the site layout read as the store of a live (an OverlayStore over `store`):
//   lives/<musicId>_<difficulty>/live.json, notes.json, notes.mirror.json   the live: the score files (and the mirrored
//                one when the chart has it), `parts` naming the products below
//   sounds/default/sounds.json   live-audio.json without the music; its waveforms under sounds/default/
//   music/<musicId>/music.json   the music's sound; its waveforms under music/<musicId>/
// The scene and the note assets stay where they are (livescene/, livenotes/). `info` is the chart manifest's (chart,
// quality, options, audio) with the live's `product`, `subject`, `dir` and `products`.
export const legacyLive = (store) => {
  const old = store.json("live.json");
  for (const k of ["musicId", "difficulty", "notes", "liveAudio"])
    if (old[k] === undefined) throw new Error(`live.json: no ${k}`);
  const id = `${old.musicId}_${old.difficulty}`, dir = `lives/${id}`;
  const sounds = "sounds/default", musicDir = `music/${old.musicId}`;
  const text = {}, alias = {};
  alias[`${dir}/notes.json`] = old.notes;
  if (old.notesMirror) alias[`${dir}/notes.mirror.json`] = old.notesMirror;
  const parts = { scene: "scenes/default.json", notes: "notes/default.json", noteskin: "noteskins/default.json",
                  noteeffect: "noteeffects/default.json", sounds: `${sounds}.json`, music: `${musicDir}.json` };
  text[`${dir}/live.json`] = JSON.stringify({
    format: LIVE_JSON_FORMAT, musicId: old.musicId, difficulty: old.difficulty, notes: "notes.json",
    ...(old.notesMirror ? { notesMirror: "notes.mirror.json" } : {}), parts,
  });
  const audio = store.json(old.liveAudio);
  const musicId = String(audio.music && audio.music.soundId);
  if (!audio.sounds || !audio.sounds[musicId]) throw new Error(`${old.liveAudio}: no sound of the music (${musicId})`);
  // a sound's waveforms under the product's directory
  const moved = (into, cue) => ({ ...cue, layers: cue.layers.map((L) => { alias[`${into}/${L.file}`] = L.file; return L; }) });
  const { music, sounds: all, ...rest } = audio;
  const se = Object.fromEntries(Object.entries(all).filter(([k]) => k !== musicId).map(([k, c]) => [k, moved(sounds, c)]));
  text[`${sounds}/sounds.json`] = JSON.stringify({ format: SOUNDS_FORMAT, ...rest, sounds: se });
  text[`${musicDir}/music.json`] = JSON.stringify({
    format: MUSIC_FORMAT, musicId: old.musicId, music, sounds: { [musicId]: moved(musicDir, all[musicId]) },
  });
  const info = {
    ...(store.info || {}), product: LIVE_PRODUCT, subject: `${old.musicId}/${old.difficulty}`, dir,
    products: { [LIVE_PRODUCT]: { [`${old.musicId}/${old.difficulty}`]: dir }, "live.sounds": { default: sounds },
                "live.music": { [String(old.musicId)]: musicDir } },
  };
  return new OverlayStore(store, { text, alias, info });
};
