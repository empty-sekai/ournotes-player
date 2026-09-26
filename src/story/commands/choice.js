import { StoryCommandError } from "../interfaces.js";
import { intParam } from "../params.js";
import { featureSlot, featureState } from "../features/state.js";

// ChoiceSet / ChoiceShow / GoTo: episode branches (no episode of the story data uses them).

// AdvEpisodeResourceLoader: the choice lists built at preload from the ChoiceSet rows (choice group = Parameter1 as an
// int -> [AdvChoiceData {advId, choiceIndex, choiceValue: position in the list, textId: AdvTextID, nextKey:
// Parameter2}]) and the key map (every non-empty Key, IgnoreData rows included; the first row of a key is kept).
export const episodeBranches = (ctx) => featureSlot(ctx, "branches", () => {
  const choices = new Map(), keys = new Map();
  ctx.episode.commands.forEach((c, i) => {
    if (c.Key && !keys.has(c.Key)) keys.set(c.Key, i);
    if (c.cmd !== "ChoiceSet" || c.IgnoreData) return;
    const group = intParam(c.Parameter1);
    if (!choices.has(group)) choices.set(group, []);
    const list = choices.get(group);
    list.push({ choiceIndex: group, choiceValue: list.length, textId: c.AdvTextID ?? "", nextKey: c.Parameter2 ?? "" });
  });
  return { choices, keys };
});

// AdvGoToCommand.GoTo(key): the row of the key becomes the current list index; PlayCommands runs it next. An unknown
// key changes nothing (playback falls through to the next row).
export const goTo = (p, key) => {
  const i = episodeBranches(p.ctx).keys.get(key ?? "");
  if (i === undefined) return;
  if (typeof p.setCurrentEpisodeListIndex !== "function") throw new StoryCommandError("GoTo: the player cannot jump");
  p.setCurrentEpisodeListIndex(i);
};

// ChoiceSet: nothing at run time (the list was built at preload)
export const ChoiceSet = () => Promise.resolve();

// GoTo: synchronous; skipped while shortcutting
export const GoTo = (c, p) => { if (!p.shortcut) goTo(p, c.Parameter1); return Promise.resolve(); };

// Random.Range(int min, int max) for max > min: min + Rand() % (max - min)
// ENGINE: UnityEngine.Random.Range(int, int) is native; this is its known integer mapping.
const randomRangeInt = (random, min, max) => (max > min ? min + (random.nextU32() % (max - min)) : min);

// ChoiceShow (AdvChoiceShowCommand): returns at once while shortcutting. Otherwise the Next button is locked and the
// choices of group Parameter1 are shown; a selection reports the choice (AdvChoiceHandler), hides the choices, jumps to
// the choice's NextKey, sets GoNext and unlocks the Next button. With random choice in auto mode a choice is taken after
// 1 s (Random.Range(0, count)). The row waits for GoNext.
export const ChoiceShow = (c, p) => (async () => {
  if (p.shortcut) return;
  const ctx = p.ctx, list = episodeBranches(ctx).choices.get(intParam(c.Parameter1)) || [];
  const ui = ctx.ui;
  if (typeof ui.showChoices !== "function") throw new StoryCommandError("ChoiceShow: the story UI has no choices");
  let selected = false;
  const onSelected = async (choice) => {
    if (selected) return;
    selected = true;
    if (p.onChoiceSelected) p.onChoiceSelected({ advId: ctx.episode.advId, choiceIndex: choice.choiceIndex, choiceValue: choice.choiceValue });
    await ui.hideChoices();
    goTo(p, choice.nextKey);
    p.nextStep = 2;                                                     // ChangeGoNextState
    ui.setNextButtonLocked(false);
  };
  ui.setNextButtonLocked(true);
  ui.showChoices(list.map((x) => ({ ...x, text: x.textId && x.textId !== "0" ? ctx.localize(x.textId) : "" })),
                 (i) => onSelected(list[i]));
  if (p.isRandomChoice && p.isAutoPlay && list.length) {
    (async () => {
      if (!await ctx.loop.delay(1)) return;
      if (!selected) onSelected(list[randomRangeInt(featureState(ctx).random, 0, list.length)]);
    })().catch((e) => p.fail(e));
  }
  await p.waitUntilGoNext();
})();
