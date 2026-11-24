
import { P } from "../config.js";

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

    if (leftIsDir !== rightIsDir) return leftIsDir ? -P.ONE : P.ONE;
    return leftParts[index].localeCompare(rightParts[index]);
  }

  return leftParts.length - rightParts.length;
}

export function sortLikeTree(entries) {
  const paths = entries.map((entry) => (typeof entry === P.TYPE_STRING ? entry : entry.path));
  const directories = collectDirectories(paths);

  return entries.slice().sort((a, b) => {
    const left = typeof a === P.TYPE_STRING ? a : a.path;
    const right = typeof b === P.TYPE_STRING ? b : b.path;
    return comparePaths(left, right, directories);
  });
}
