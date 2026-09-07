/** Hidden regions of unchanged lines ("gaps") around the hunks of a diff. */
import { readBlobs } from "../git.js";
import { readFilesForHighlight, splitLines } from "../fileview.js";
import { DIFF, GAP, P } from "../config.js";
/** Regions of unchanged lines for one file. */
export function computeGaps(file, lines) {
  const hunks = file.hunks ?? [];
  if (!hunks.length) return { totalLines: lines.length, gaps: [] };

  const gaps = [];
  // Region above every hunk: the head of the file and the space between two
  // hunks. It is anchored to the hunk below it, so its line shift is exact.
  for (let index = 0; index < hunks.length; index += 1) {
    const hunk = hunks[index];
    const start = index === 0 ? P.ONE : newEnd(hunks[index - 1]) + P.ONE;
    const end = hunk.newStart - P.ONE;
    if (end < start) continue;

    const shift = hunk.newStart - hunk.oldStart;
    gaps.push(makeGap(index, GAP.UP, start, end, shift, lines));
  }
  // Region below the last hunk: the tail of the file. Only the new side is
  // known (the file content); the old side follows from the line shift.
  const last = hunks.length - P.ONE;
  const tail = hunks[last];
  const tailStart = newEnd(tail) + P.ONE;
  if (lines.length >= tailStart) {
    const shift = newEnd(tail) - oldEnd(tail);
    gaps.push(makeGap(last, GAP.DOWN, tailStart, lines.length, shift, lines));
  }

  return { totalLines: lines.length, gaps };
}
/** Builds one region descriptor. */
function makeGap(hunkIndex, dir, newStart, newEnd, shift, lines) {
  const count = newEnd - newStart + P.ONE;
  return {
    hunk: hunkIndex,
    dir,
    newStart,
    newEnd,
    oldStart: newStart - shift,
    oldEnd: newEnd - shift,
    count,
    nonEmpty: countNonEmpty(lines, newStart, newEnd),
  };
}
/** Counts the lines that carry something other than whitespace. */
function countNonEmpty(lines, start, end) {
  let nonEmpty = P.ZERO;
  for (let line = start; line <= end; line += P.ONE) {
    const text = lines[line - P.ONE];
    if (text !== undefined && text.trim() !== P.EMPTY) nonEmpty += P.ONE;
  }
  return nonEmpty;
}
/** Last old line of a hunk; a pure addition covers no old line at all. */
function oldEnd(hunk) {
  return hunk.oldLines > P.ZERO ? hunk.oldStart + hunk.oldLines - P.ONE : hunk.oldStart - P.ONE;
}
/** Last new line of a hunk; a pure deletion covers no new line at all. */
function newEnd(hunk) {
  return hunk.newLines > P.ZERO ? hunk.newStart + hunk.newLines - P.ONE : hunk.newStart - P.ONE;
}
/** Attaches the gap metadata to the file model. */
export async function attachGapMetadata(root, files, { ref, useWorkingTree = false, refs } = {}) {
  const targets = files.filter((file) => !file.binary && file.status !== DIFF.STATUS.DELETED);
  if (!targets.length) return files;

  const paths = targets.map((file) => file.path);
  const contents = useWorkingTree
    ? await readFilesForHighlight(root, paths, { refs })
    : await readBlobLines(root, paths, ref);

  for (const file of targets) {
    const entry = contents[file.path];
    const lines = entry?.lines ?? null;

    if (!lines) {
      // Without content the file length is unknown, so only the regions
      // between hunks can be described. They are still expandable.
      file.gaps = geometryGaps(file);
      file.totalLines = P.ZERO;
      continue;
    }

    const { totalLines, gaps } = computeGaps(file, lines);
    file.gaps = gaps;
    file.totalLines = totalLines;
  }

  return files;
}
