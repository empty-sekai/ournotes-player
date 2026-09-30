// A two-objective frontier for the currently plotted candidates. Equal coordinates remain equal candidates;
// a point dominates another only when it is no worse on both chosen axes and strictly better on at least one.
// This is separate from ranking.js's dominance for every skill mean and overhead.
export const axisGoal = (axis) => axis === "displayLevel" || axis === "bgmMs" ? "min" : "max";

export function paretoPoints(points, xGoal = "min", yGoal = "max") {
  const finite = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const dx = xGoal === "min" ? 1 : -1, dy = yGoal === "min" ? 1 : -1;
  return finite.filter(([x, y]) => !finite.some(([a, b]) =>
    dx * a <= dx * x && dy * b <= dy * y && (dx * a < dx * x || dy * b < dy * y)))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
