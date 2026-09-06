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
/** Comparator over full paths that reproduces a folder-first tree walk. */
function comparePaths(left, right, directories) {
  const leftParts = left.split(P.SLASH);
  const rightParts = right.split(P.SLASH);
  const size = Math.min(leftParts.length, rightParts.length);

  for (let index = P.ZERO; index < size; index += P.ONE) {
    if (leftParts[index] === rightParts[index]) continue;

    const leftPrefix = leftParts.slice(P.ZERO, index + P.ONE).join(P.SLASH);
    const rightPrefix = rightParts.slice(P.ZERO, index + P.ONE).join(P.SLASH);
    const leftIsDir = directories.has(leftPrefix);
    const rightIsDir = directories.has(rightPrefix);
    // At the same level a folder comes before a file, matching the tree.
    if (leftIsDir !== rightIsDir) return leftIsDir ? -P.ONE : P.ONE;
    return leftParts[index].localeCompare(rightParts[index]);
  }
  // An ancestor folder sorts before anything nested inside it.
  return leftParts.length - rightParts.length;
}
