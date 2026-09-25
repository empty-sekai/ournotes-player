// Side-effect entry: the package's API (as the main entry) and, on import, the <ournotes-player> element defined
// (player/element.js). To choose another tag name, import defineOurnotesPlayer from the main entry instead.
import { defineOurnotesPlayer } from "./player/element.js";

defineOurnotesPlayer();

export * from "./index.js";
