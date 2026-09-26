import { advRow } from "../params.js";
import { CANVAS_LAYER_CHARACTER, canPlaceCharacter } from "./define.js";

// SimpleAdvCommandValidator.TryValidate: which rows of an episode the simple player runs, and the rows that make it
// refuse the whole episode. Each row of the three phases (the player settings' initialize rows, the episode's rows
// from the start index, the finalize rows) is classified as supported, ignored or of the abort class. The abort class
// only refuses the episode when AbortOnUnsupportedCommands is set, which no caller sets: those rows are logged and the
// runner skips them. A supported row that fails TryValidateSupportedEpisode refuses the episode: nothing is shown
// and the finished callback runs (SimpleAdvPlayer.FinishWithoutPresentation).

export const SIMPLE_PHASE = Object.freeze({ Initialize: 0, Episode: 1, Finalize: 2 });
export const SIMPLE_CLASS = Object.freeze({ Supported: 0, Ignored: 1, Abort: 2 });

// ClassifyEpisodeValidation, episode phase: AdvCommand values 0-3, 12-24 by table, the bit set of Wait, Se, Angle,
// TalkWindow and Look, Voice, Effect, RimLight, LookTarget, MotionLoop, EyeBlink
const SUPPORTED = new Set(["In", "Out", "Talk", "Delay", "Brightness", "Expression", "Pause", "Resume", "Motion",
  "Character", "Costume", "Wait", "Se", "Angle", "TalkWindow", "Look", "Voice", "Effect", "RimLight", "LookTarget",
  "MotionLoop", "EyeBlink"]);

// The rows of the simple runner's set this player does not reproduce: SimpleAdvCharacterHandler.PlayEffect draws a
// particle effect into a character's capture (no Overlay episode of the game data has one)
export const SIMPLE_UNIMPLEMENTED = Object.freeze(["Effect"]);

// of a list of command names, the ones an Overlay episode cannot play here
export const simpleUnsupportedCommands = (commands) => commands.filter((c) => SIMPLE_UNIMPLEMENTED.includes(c));

const lower = (s) => (s ?? "").toLowerCase();
const isNullOrEmpty = (s) => s === null || s === undefined || s === "";
const validText = (id) => !!id && id !== "0";                           // AdvEpisode.IsValidTextId

// ClassifyEpisodeValidation(episode, phase)
export const classifyRow = (c, phase) => {
  if (phase === SIMPLE_PHASE.Initialize) {
    if (c.cmd === "Se" && lower(c.Parameter1) === "stop") return SIMPLE_CLASS.Ignored;
    if (c.cmd === "Bgm") return (c.BgmID || 0) > 0 ? SIMPLE_CLASS.Abort : SIMPLE_CLASS.Ignored;
    if (c.cmd === "FadeIn") return SIMPLE_CLASS.Ignored;
    return SIMPLE_CLASS.Abort;
  }
  if (phase === SIMPLE_PHASE.Finalize) {
    if ((c.cmd === "Talk" && !validText(c.AdvTextID)) || c.cmd === "FadeOut") return SIMPLE_CLASS.Ignored;
    return SIMPLE_CLASS.Abort;
  }
  return SUPPORTED.has(c.cmd) ? SIMPLE_CLASS.Supported : SIMPLE_CLASS.Abort;
};

// IsLoopMotionName: StartsWith("misc", OrdinalIgnoreCase)
const isLoopMotionName = (s) => lower(s).startsWith("misc");
// IsSupportedEyeBlinkParameter: empty, "stop" or "resume" (ordinal, ignore case)
const isSupportedEyeBlinkParameter = (s) => isNullOrEmpty(s) || lower(s) === "stop" || lower(s) === "resume";

// TryValidateSupportedEpisode: null when the row is valid, else the reason
export const supportedRowProblem = (c) => {
  switch (c.cmd) {
    case "LookTarget":
      if (isNullOrEmpty(c.TargetName)) return "LookTarget without TargetName";
      if (!canPlaceCharacter(c.PositionType || 0) && lower(c.Parameter3) !== "stop")
        return `LookTarget to PositionType ${c.PositionType || 0}`;
      return null;
    case "MotionLoop":
      if (isNullOrEmpty(c.TargetName)) return "MotionLoop without TargetName";
      if (lower(c.Parameter1) !== "stop" && !isLoopMotionName(c.MotionName)) return `MotionLoop of ${c.MotionName ?? ""}`;
      return null;
    case "EyeBlink":
      if (isNullOrEmpty(c.TargetName)) return "EyeBlink without TargetName";
      if (!isSupportedEyeBlinkParameter(c.Parameter1)) return `EyeBlink Parameter1 ${c.Parameter1}`;
      return null;
    case "Brightness": {
      if (isNullOrEmpty(c.TargetName) && !(c.PositionType || 0)) return "Brightness without TargetName or PositionType";
      const layers = c.CanvasLayers || [];
      if (layers.some((l) => l !== CANVAS_LAYER_CHARACTER)) return `Brightness on canvas layers ${JSON.stringify(layers)}`;
      return null;
    }
    case "Effect": {
      const layers = c.CanvasLayers || [];
      if (layers.length && layers[0] !== CANVAS_LAYER_CHARACTER) return `Effect on canvas layer ${layers[0]}`;
      return null;
    }
    default: return null;
  }
};

// The episode rows the runner visits (SimpleAdvCommandRunner.Run): no IgnoreData, Index >= startIndex when
// startIndex > 0
export const runnerRows = (episode, startIndex = 0) =>
  episode.commands.filter((c) => c && !c.IgnoreData && !(startIndex > 0 && c.i < startIndex));

// TryValidate(player, startIndex) -> {ok, failure: {phase, row, reason} | null, rows: [{phase, row, cmd, class}]}
export const validateSimpleEpisode = (episode, settings, startIndex = 0) => {
  const out = { ok: true, failure: null, rows: [] };
  const phases = [
    [SIMPLE_PHASE.Initialize, (settings._initializeEpisodes || []).map((r, i) => advRow(r, `init${i}`))],
    [SIMPLE_PHASE.Episode, runnerRows(episode, startIndex)],
    [SIMPLE_PHASE.Finalize, (settings._finalizeEpisodes || []).map((r, i) => advRow(r, `fin${i}`))],
  ];
  for (const [phase, rows] of phases) {
    for (const c of rows) {
      const cls = classifyRow(c, phase);
      out.rows.push({ phase, row: c.i, cmd: c.cmd, class: cls });
      if (cls !== SIMPLE_CLASS.Supported || phase !== SIMPLE_PHASE.Episode) continue;
      const reason = supportedRowProblem(c);
      if (reason && out.ok) { out.ok = false; out.failure = { phase, row: c.i, reason }; }
    }
  }
  return out;
};
