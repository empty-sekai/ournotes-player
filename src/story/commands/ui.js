// UI commands: TalkWindow. The views they drive are the StoryUI (interfaces.js).

// AdvTalkWindowCommand.Execute (synchronous; IsNoWait and DelaySeconds are not read):
// AdvTalkWindowCommandHelper.ApplyLoadedTalkWindow looks the window up in the loader's talk window map and calls
// UIAdvWidget.SetTalkWindow. The episode rows name the window in TargetAssetName, the initial row of
// AdvPlayer.PlayInitialCommands in TargetName. The StoryUI raises for a window it does not provide.
export const TalkWindow = (c, p) => {
  p.ctx.ui.setTalkWindow(c.i === -1 ? c.TargetName : c.TargetAssetName);
  return Promise.resolve();
};
