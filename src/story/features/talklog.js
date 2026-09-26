// AdvTalkHelper.AddLogEntry(ctx, token, text, name, voiceIds) (Talk, Location, Subtitles, the chat rows): a backlog
// entry through the player's onLog hook ({row, speaker, text, voiceIds}; speaker null for a caption without one).
export const addLogEntry = (p, c, text, name, voiceIds) => {
  if (p.onLog) p.onLog({ row: c.i, speaker: name, text, voiceIds: [...(voiceIds || [])] });
};
