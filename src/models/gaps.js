
import { readBlobs } from "../git.js";
import { readFilesForHighlight, splitLines } from "../fileview.js";
import { DIFF, GAP, P } from "../config.js";

export function computeGaps(file, lines) {
  const hunks = file.hunks ?? [];
  if (!hunks.length) return { totalLines: lines.length, gaps: [] };

  const gaps = [];


  for (let index = 0; index < hunks.length; index += 1) {
    const hunk = hunks[index];
    const start = index === 0 ? P.ONE : newEnd(hunks[index - 1]) + P.ONE;
    const end = hunk.newStart - P.ONE;
    if (end < start) continue;

    const shift = hunk.newStart - hunk.oldStart;
    gaps.push(makeGap(index, GAP.UP, start, end, shift, lines));
  }


  const last = hunks.length - P.ONE;
  const tail = hunks[last];
  const tailStart = newEnd(tail) + P.ONE;
  if (lines.length >= tailStart) {
    const shift = newEnd(tail) - oldEnd(tail);
    gaps.push(makeGap(last, GAP.DOWN, tailStart, lines.length, shift, lines));
  }

  return { totalLines: lines.length, gaps };
}

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

function countNonEmpty(lines, start, end) {
  let nonEmpty = P.ZERO;
  for (let line = start; line <= end; line += P.ONE) {
    const text = lines[line - P.ONE];
    if (text !== undefined && text.trim() !== P.EMPTY) nonEmpty += P.ONE;
  }
  return nonEmpty;
}

function oldEnd(hunk) {
  return hunk.oldLines > P.ZERO ? hunk.oldStart + hunk.oldLines - P.ONE : hunk.oldStart - P.ONE;
}

function newEnd(hunk) {
  return hunk.newLines > P.ZERO ? hunk.newStart + hunk.newLines - P.ONE : hunk.newStart - P.ONE;
}

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

async function readBlobLines(root, paths, ref) {
  const blobs = await readBlobs(root, paths, { ref });
  const result = {};
  for (const [path, text] of blobs) {
    result[path] = { path, lines: splitLines(text) };
  }
  return result;
}

function geometryGaps(file) {
  const hunks = file.hunks ?? [];
  const gaps = [];

  for (let index = 0; index < hunks.length; index += 1) {
    const hunk = hunks[index];
    const start = index === 0 ? P.ONE : newEnd(hunks[index - 1]) + P.ONE;
    const end = hunk.newStart - P.ONE;
    if (end < start) continue;

    const shift = hunk.newStart - hunk.oldStart;
    gaps.push({
      hunk: index,
      dir: GAP.UP,
      newStart: start,
      newEnd: end,
      oldStart: start - shift,
      oldEnd: end - shift,
      count: end - start + P.ONE,
      nonEmpty: end - start + P.ONE,
    });
  }

  return gaps;
}
