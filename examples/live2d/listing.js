// Model picker texts of the Live2D page (no DOM). A models.json entry is shown by the character's name, when the site
// has one (`names[lang]` for the page's ?lang=, else `label`), followed by its id, which tells the costumes of one
// character apart; an entry without a name by its id. `bytes` adds the download size.
export const modelText = (m, lang = null) => {
  const name = (lang && m.names && m.names[lang]) || m.label || "";
  const size = Number.isFinite(m.bytes) ? ` (${(m.bytes / 1048576).toFixed(1)} MB)` : "";
  return `${name ? `${name} · ${m.id}` : m.id}${size}`;
};
