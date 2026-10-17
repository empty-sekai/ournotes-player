// The host's visible prefab subtrees and the hierarchy/animation targets that support them.
export const hostUIRoots = (host, objects) => {
  const ui = host.kind === "home" ? host.prefabs.spotWidget : host.prefabs.resultWidget;
  const p = objects.prefab(ui), overlay = host.overlayRoot.path;
  const sequences = host.openedSequences.filter((r) => r.prefab === ui).map((r) => r.path);
  if (host.kind === "home") {
    const w = p.find("UISpotWidget").c.fields;
    for (const key of ["_transitionIn", "_transitionOut", "_fadeIn", "_fadeOut"])
      if (w[key]) sequences.push(p.pathOf(w[key]));
  }
  const subtrees = [overlay, ...sequences];
  if (host.kind === "home") subtrees.push(`${overlay.slice(0, overlay.lastIndexOf("/"))}/Fade`);
  const targets = [];
  for (const path of sequences) {
    const s = p.fields(path, "DOTweenSequence");
    for (const e of s._list) for (const call of e._tweenEvent?.m_PersistentCalls?.m_Calls || [])
      if (call.m_Target) targets.push(p.pathOf(call.m_Target));
  }
  const include = (path) => subtrees.some((s) => path === s || path.startsWith(`${s}/`) || s.startsWith(`${path}/`))
    || targets.some((s) => path === s || s.startsWith(`${path}/`));
  return [{ id: ui, include, texts: false },
    { id: host.kind === "home" ? host.prefabs.spotLetterbox : host.prefabs.resultBackground, texts: false }];
};
