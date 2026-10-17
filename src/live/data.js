import { LIVE_PRODUCT, productDir } from "./store.js";

// LiveData: the documents of one live in its store (loadLiveStore, or a chart store read through legacy.js):
//   live          live.json of the live product: the chart, the score files, the band, the parts
//   score(m)      the converted score (notes.json; notes.mirror.json with the MirrorChart option)
//   audio()       the sound data of the live: the sounds of a live.sounds product and the music of the live.music part
//   scene, notes  scene.json of the live.scene part, notes.json of the live.notes part
//   noteskin(n), noteeffect(n)   noteskin.json / noteeffect.json of the note skin / effect set named n (default: the
//                 part's); noteskins, noteeffects: the names of those loaded (the parts and the variants)
// A product's files are under its directory in the store (store.js productDir).

export const LIVE_JSON_FORMAT = 1, SOUNDS_FORMAT = 1, MUSIC_FORMAT = 1;
export const SCENE_FORMAT = 1, NOTES_FORMAT = 1, NOTESKIN_FORMAT = 1, NOTEEFFECT_FORMAT = 1;
const SOUNDS = "live.sounds", NOTESKIN = "live.noteskin", NOTEEFFECT = "live.noteeffect";

const checkFormat = (doc, format, where) => {
  if (!doc || doc.format !== format) throw new Error(`${where}: format ${doc && doc.format} (${format} expected)`);
  return doc;
};

export class LiveData {
  constructor(assets) {
    const info = assets.info;
    if (!info || info.product !== LIVE_PRODUCT || typeof info.dir !== "string" || !info.products)
      throw new Error("not the store of a live (loadLiveStore)");
    this.assets = assets;
    this.dir = info.dir;
    this.products = info.products;
    this.live = checkFormat(assets.json(`${this.dir}/live.json`), LIVE_JSON_FORMAT, `${this.dir}/live.json`);
    this.parts = Object.fromEntries(Object.entries(this.live.parts).filter(([, p]) => typeof p === "string")
      .map(([part, p]) => [part, productDir(p)]));
    this._docs = new Map();
  }

  // the JSON file `file` of the product in directory `dir`
  json(dir, file) { return this.assets.json(`${dir}/${file}`); }

  // a document of a product, read once (shared: callers do not modify it)
  _doc(dir, file, format) {
    const k = `${dir}/${file}`;
    if (!this._docs.has(k)) this._docs.set(k, checkFormat(this.json(dir, file), format, k));
    return this._docs.get(k);
  }

  get scene() { return this._doc(this.parts.scene, "scene.json", SCENE_FORMAT); }
  get notes() { return this._doc(this.parts.notes, "notes.json", NOTES_FORMAT); }

  // the subject of the loaded product of `product` in directory `dir`
  _subject(product, dir) {
    const hit = Object.entries(this.products[product] || {}).find(([, d]) => d === dir);
    if (!hit) throw new Error(`${dir}: not a loaded ${product} product`);
    return hit[0];
  }

  get noteskins() { return Object.keys(this.products[NOTESKIN] || {}); }
  get noteeffects() { return Object.keys(this.products[NOTEEFFECT] || {}); }

  // the note skin `name` (MasterLiveNoteSkin._assetName, notes.json settings.skins); default: the live's part
  noteskin(name = this._subject(NOTESKIN, this.parts.noteskin)) {
    const dir = (this.products[NOTESKIN] || {})[name];
    if (!dir) throw new Error(`note skin ${name}: not loaded`);
    return this._doc(dir, "noteskin.json", NOTESKIN_FORMAT);
  }

  // the note effect set `name` (MasterLiveNoteEffectSkin._assetName, notes.json settings.effects); default: the part
  noteeffect(name = this._subject(NOTEEFFECT, this.parts.noteeffect)) {
    const dir = (this.products[NOTEEFFECT] || {})[name];
    if (!dir) throw new Error(`note effect set ${name}: not loaded`);
    return this._doc(dir, "noteeffect.json", NOTEEFFECT_FORMAT);
  }

  // the converted score; `mirror`: the one converted with MirrorChart (live.json notesMirror)
  score(mirror = false) {
    const f = mirror ? this.live.notesMirror : this.live.notes;
    if (!f) throw new Error(`${this.dir}: no ${mirror ? "mirrored " : ""}score`);
    return this.json(this.dir, f);
  }

  // The live's sounds: the live.sounds product with the most note sound sets (it holds the default set and the sets a
  // page offers), with the music of the live.music part. Every layer's `file` is its path in the store.
  audio() {
    const loaded = Object.values(this.products[SOUNDS] || {}).map((dir) => {
      const doc = checkFormat(this.json(dir, "sounds.json"), SOUNDS_FORMAT, `${dir}/sounds.json`);
      return { dir, doc, sets: doc.noteSe && doc.noteSe.groups ? Object.keys(doc.noteSe.groups).length : 1 };
    });
    if (!loaded.length) throw new Error(`${this.dir}: no ${SOUNDS} product`);
    const most = Math.max(...loaded.map((s) => s.sets)), pick = loaded.filter((s) => s.sets === most);
    if (pick.length > 1) throw new Error(`${pick.map((s) => s.dir).join(", ")}: two ${SOUNDS} products offer as many note sound sets`);
    const { dir, doc } = pick[0];
    const musicDir = this.parts.music, music = checkFormat(this.json(musicDir, "music.json"), MUSIC_FORMAT, `${musicDir}/music.json`);
    const inDir = (d, sounds) => Object.fromEntries(Object.entries(sounds).map(([id, cue]) =>
      [id, { ...cue, layers: cue.layers.map((L) => ({ ...L, file: `${d}/${L.file}` })) }]));
    const sounds = { ...inDir(dir, doc.sounds) };
    for (const [id, cue] of Object.entries(inDir(musicDir, music.sounds))) {
      if (id in sounds) throw new Error(`sound ${id}: in ${dir}/sounds.json and ${musicDir}/music.json`);
      sounds[id] = cue;
    }
    return { ...doc, sounds, music: music.music };
  }
}
