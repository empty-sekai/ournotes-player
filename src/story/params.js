import { ADV_COMMAND, StoryCommandError } from "./interfaces.js";

// Parameter parsing and small helpers shared by the interpreter, the command handlers and the session.

// AdvEpisode.GetFloatParameterN: Single.TryParse(string, out float): a whitespace-tolerant decimal / exponent, else 0
export const floatParam = (s) => {
  const t = (s ?? "").trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? parseFloat(t) : 0;
};

// AdvEpisode.GetIntParameterN: Int32.TryParse(string, out int), else 0
export const intParam = (s) => {
  const t = (s ?? "").trim();
  if (!/^[+-]?\d+$/.test(t)) return 0;
  const n = Number(t);
  return n < -2147483648 || n > 2147483647 ? 0 : n;
};

// A serialized AdvEpisode row (AdvPlayerSettings initialize / finalize lists) as a command record
export const advRow = (row, i) => {
  const cmd = ADV_COMMAND[row.Command];
  if (!cmd) throw new StoryCommandError(`AdvCommand ${row.Command}`);
  return { ...row, i, cmd };
};

// ColorUtility.TryParseHtmlString(s, out c) ? c : opaque black (FadeOut / FadeIn Parameter1).
// ENGINE: TryParseHtmlString is native; implemented from its documented grammar: '#' + 3, 4, 6 or 8 hex digits, or a
// colour name. Anything else fails and gives opaque black. The names' values are not documented: a name raises.
export const htmlColor = (s) => {
  const t = s ?? "";
  const m = /^#([0-9a-fA-F]+)$/.exec(t);
  if (!m || ![3, 4, 6, 8].includes(m[1].length)) {
    if (/^(red|cyan|blue|darkblue|lightblue|purple|yellow|lime|fuchsia|white|silver|grey|black|orange|brown|maroon|green|olive|navy|teal|aqua|magenta)$/i.test(t))
      throw new StoryCommandError(`colour name '${t}' is not supported`);
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  let h = m[1];
  if (h.length <= 4) h = [...h].map((x) => x + x).join("");
  const v = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: v(0), g: v(2), b: v(4), a: h.length === 8 ? v(6) : 1 };
};

// AdvFocusDataSettings.GetClosestFocusDataByZoomRatio: argmin |ratio - target|, the first wins ties
export const closestFocusDataByZoomRatio = (fds, target) => {
  let best = null, bd = Infinity;
  for (const fd of fds._focusData) {
    const d = Math.abs(fd._fieldZoomRatio - target);
    if (d < bd) { bd = d; best = fd; }
  }
  return best;
};

// PositionType 1/3/5/7/9 -> field renderer layer (AdvInCommand: RegisterCharacterEntry "Camera1".."Camera5")
export const LAYER_OF_POSITION = { 1: "Camera1", 3: "Camera2", 5: "Camera3", 7: "Camera4", 9: "Camera5" };

// App.Options QualitySetting (0 Best, 1 High, 2 Middle; OptionValueAccessor.GetQualityBaseMode) -> BaseQualityMode
export const STORY_QUALITY = { best: 4, high: 3, middle: 2 };

// a quality given as an option name ("best", "high", "middle") or a BaseQualityMode (0..4); Best otherwise
export const parseStoryQuality = (q) => {
  if (q === undefined || q === null || q === "") return 4;
  const k = String(q).toLowerCase();
  if (STORY_QUALITY[k] !== undefined) return STORY_QUALITY[k];
  const n = Number(q);
  return Number.isInteger(n) && n >= 0 && n <= 4 ? n : 4;
};

// the languages of the story data: code -> text field of episode.json
export const STORY_LANGUAGES = { ja: "japanese", en: "english", "zh-Hant": "traditionalChinese",
                                 "zh-Hans": "simplifiedChinese", ko: "korean" };

// AdvCameraConfig.CreateAdvViewport: the ADV camera rect in a landscape screen, letterboxed to 13:6 (a narrower screen
// gets bands above and below; a wider one is not pillarboxed). Pixels, GL bottom-left origin.
export const advViewport = (sw, sh) => {
  const target = sw > sh ? Math.max(1.7777778, 2.1666667) : 1.7777778;
  const screen = sw / sh;
  if (target > 0 && screen + 0.0001 < target) {
    const r = screen / target;
    if ((1 - r) * sh * 0.5 > 1) {
      const h = Math.round(sh * r), y = Math.round((sh - h) / 2);
      return { x: 0, y, w: sw, h };
    }
  }
  return { x: 0, y: 0, w: sw, h: sh };
};

// the Talk rows that show a line (a valid AdvTextID, not IgnoreData), in order: the lines of seekToLine / `line`
export const storyLines = (episode) =>
  episode.commands.filter((c) => c.cmd === "Talk" && !c.IgnoreData && c.AdvTextID && c.AdvTextID !== "0");
