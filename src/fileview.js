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
