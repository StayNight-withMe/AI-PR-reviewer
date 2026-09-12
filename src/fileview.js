import { readFile as readTextFile } from "node:fs/promises";
import { join } from "node:path";
import { git, readBlobs } from "./git.js";
import { languageFor } from "./diff.js";
import { DIFF, FILEVIEW, GIT, P } from "./config.js";
/** Splits file content into lines the way every viewer and the diff count them. */
export function splitLines(text) {
  const value = String(text ?? P.EMPTY);
  if (value === P.EMPTY) return P.EMPTY_ARRAY;
  const body = value.endsWith(P.NEWLINE) ? value.slice(P.ZERO, -P.ONE) : value;
  return body.split(P.NEWLINE);
}
/** Content of one file plus the set of lines changed vs its base. */
export async function readFileForViewer(repoRoot, filePath, { refs = [GIT.DEFAULT_REF], range = null } = {}) {
  const preferRef = range?.head ?? null;
  const fromHead = preferRef
    ? await git(repoRoot, [GIT.SHOW, `${preferRef}:${filePath}`])
    : await git(repoRoot, [GIT.SHOW, `${GIT.DEFAULT_REF}:${filePath}`]);
  const isNew = !fromHead.ok;

  const content = await readCurrentContent(repoRoot, filePath, fromHead, refs, preferRef);
  if (!content.ok) throw new Error(`${FILEVIEW.ERROR_CANNOT_READ}${filePath}`);

  const text = content.text;
  if (text.length > GIT.MAX_REVIEW_FILE_BYTES) {
    return {
      path: filePath,
      language: languageFor(filePath),
      tooLarge: true,
      lines: P.EMPTY_ARRAY,
      changed: P.EMPTY_ARRAY,
    };
  }

  const lines = splitLines(text);
  const changed = isNew ? allLines(lines.length) : await changedLines(repoRoot, filePath, range);

  return {
    path: filePath,
    language: languageFor(filePath),
    isNew,
    deleted: content.deleted === true,
    lines,
    changed: content.deleted ? allLines(lines.length) : Array.from(changed).sort((a, b) => a - b),
  };
}
/** Lightweight content reader for syntax highlighting. */
export async function readFilesForHighlight(repoRoot, paths, { refs = [GIT.DEFAULT_REF], preferRef = null } = {}) {
  const wanted = paths.filter(Boolean);
  if (!wanted.length) return {};
  // A PR (or any committed range) is reviewed at a commit that may not be
  // checked out, so the working tree is the wrong source. Read that commit.
  const diskReads = preferRef
    ? wanted.map(() => ({ ok: false, text: P.EMPTY }))
    : await Promise.all(wanted.map((filePath) => readFromDisk(repoRoot, filePath)));
  let missing = wanted.filter((_, index) => !diskReads[index].ok);

  const orderedRefs = preferRef ? [preferRef, ...refs.filter((ref) => ref && ref !== preferRef)] : refs;
  const texts = new Map();
  for (const ref of orderedRefs) {
    if (!missing.length) break;

    const blobs = await readBlobs(repoRoot, missing, { ref });
    for (const [filePath, text] of blobs) texts.set(filePath, text);
    missing = missing.filter((filePath) => !texts.has(filePath));
  }

  const result = {};
  wanted.forEach((filePath, index) => {
    const disk = diskReads[index];
    const text = disk.ok ? disk.text : (texts.get(filePath) ?? null);

    if (text === null) { result[filePath] = null; return; }
    if (text.length > GIT.MAX_REVIEW_FILE_BYTES) {
      result[filePath] = { path: filePath, language: languageFor(filePath), lines: P.EMPTY_ARRAY, tooLarge: true };
      return;
    }

    result[filePath] = {
      path: filePath,
      language: languageFor(filePath),
      lines: splitLines(text),
    };
  });

  return result;
}
/** New files come from the disk; modified files from disk or the index; a DELETED file exists… */
async function readCurrentContent(repoRoot, filePath, fromHead, refs, preferRef) {
  // A pinned ref (a PR head) wins over the disk: the checkout is irrelevant.
  if (preferRef) {
    const pinned = await git(repoRoot, [GIT.SHOW, `${preferRef}:${filePath}`]);
    if (pinned.ok) return { ok: true, text: pinned.stdout };
    // Absent at the pinned head: it was deleted, so read it from the base.
    for (const ref of refs ?? P.EMPTY_ARRAY) {
      if (!ref) continue;
      const fromRef = await git(repoRoot, [GIT.SHOW, `${ref}:${filePath}`]);
      if (fromRef.ok) return { ok: true, text: fromRef.stdout, deleted: true };
    }
    return { ok: false, text: P.EMPTY };
  }

  const disk = await readFromDisk(repoRoot, filePath);
  if (disk.ok) return disk;

  const staged = await git(repoRoot, [GIT.SHOW, `${P.COLON}${filePath}`]);
  if (staged.ok) return { ok: true, text: staged.stdout };

  if (fromHead && fromHead.ok) return { ok: true, text: fromHead.stdout, deleted: true };
  // A file deleted inside a range is gone from both disk and HEAD.
  for (const ref of refs ?? P.EMPTY_ARRAY) {
    const fromRef = await git(repoRoot, [GIT.SHOW, `${ref}:${filePath}`]);
    if (fromRef.ok) return { ok: true, text: fromRef.stdout, deleted: true };
  }

  return { ok: false, text: P.EMPTY };
}
