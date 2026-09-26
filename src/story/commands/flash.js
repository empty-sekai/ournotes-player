// Flash (AdvFlashCommand.Execute): UIAdvWidget.Flash(CalcDuration(Duration, 0.3)): the front canvas' white FlashView
// fading out; awaited unless IsNoWait. No other row field is read.
export const Flash = (c, p) => p.noWait(c, p.ctx.ui.flash(p.calcDuration(c.Duration || 0, 0.3)));
