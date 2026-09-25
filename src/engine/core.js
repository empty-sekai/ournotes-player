// Small helpers shared by every module.

// float32 rounding: the game's managed math is float32 without FMA; applied in source order
export const F = Math.fround;

// asset path join: "a", "b/c" -> "a/b/c" (empty parts skipped, repeated slashes collapsed)
export const join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
