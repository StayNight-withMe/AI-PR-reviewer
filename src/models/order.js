/** A single ordering rule shared by the sidebar tree and the diff list, so the review reads… */
import { P } from "../config.js";
/** Every ancestor directory implied by a set of paths. */
function collectDirectories(paths) {
  const directories = new Set();

  for (const path of paths) {
    const parts = path.split(P.SLASH);
    for (let index = P.ONE; index < parts.length; index += P.ONE) {
      directories.add(parts.slice(P.ZERO, index).join(P.SLASH));
    }
  }

  return directories;
}
