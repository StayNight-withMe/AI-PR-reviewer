import { readFile as readTextFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { git, readBlobs } from "./git.js";
import { languageFor } from "./diff.js";
import { DIFF, FILEVIEW, GIT, P } from "./config.js";

export function repoPathOf(repoRoot, filePath) {
  const value = String(filePath ?? P.EMPTY);
  if (!value || isAbsolute(value)) return null;

  const normalized = value.replace(/\\/g, P.SLASH);
  const root = resolvePath(repoRoot);
  const target = resolvePath(root, normalized);
  const within = relative(root, target);


  if (!within || within === ".." || within.startsWith("../") || within.startsWith("..\\")) return null;
  return within.replace(/\\/g, P.SLASH);
}

export function splitLines(text) {
  const value = String(text ?? P.EMPTY);
  if (value === P.EMPTY) return P.EMPTY_ARRAY;
  const body = value.endsWith(P.NEWLINE) ? value.slice(P.ZERO, -P.ONE) : value;
  return body.split(P.NEWLINE);
}

export async function readFileForViewer(repoRoot, requestedPath, options = {}) {
  const safePath = repoPathOf(repoRoot, requestedPath);
  if (!safePath) throw new Error(`${FILEVIEW.ERROR_OUTSIDE_REPO}${requestedPath}`);

  return readReviewedFile(repoRoot, safePath, options);
}
async function readReviewedFile(repoRoot, filePath, { refs = [GIT.DEFAULT_REF], range = null } = {}) {
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

export async function readFilesForHighlight(repoRoot, paths, { refs = [GIT.DEFAULT_REF], preferRef = null } = {}) {



  const result = {};
  const accepted = [];
  for (const requested of paths.filter(Boolean)) {
    const safePath = repoPathOf(repoRoot, requested);
    if (safePath === null) { result[requested] = null; continue; }
    accepted.push({ requested, safePath });
  }
  if (!accepted.length) return result;

  const wanted = accepted.map((entry) => entry.safePath);


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

  accepted.forEach(({ requested, safePath }, index) => {
    const disk = diskReads[index];
    const text = disk.ok ? disk.text : (texts.get(safePath) ?? null);

    if (text === null) { result[requested] = null; return; }
    if (text.length > GIT.MAX_REVIEW_FILE_BYTES) {
      result[requested] = { path: safePath, language: languageFor(safePath), lines: P.EMPTY_ARRAY, tooLarge: true };
      return;
    }

    result[requested] = {
      path: safePath,
      language: languageFor(safePath),
      lines: splitLines(text),
    };
  });

  return result;
}

async function readCurrentContent(repoRoot, filePath, fromHead, refs, preferRef) {

  if (preferRef) {
    const pinned = await git(repoRoot, [GIT.SHOW, `${preferRef}:${filePath}`]);
    if (pinned.ok) return { ok: true, text: pinned.stdout };

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

  for (const ref of refs ?? P.EMPTY_ARRAY) {
    const fromRef = await git(repoRoot, [GIT.SHOW, `${ref}:${filePath}`]);
    if (fromRef.ok) return { ok: true, text: fromRef.stdout, deleted: true };
  }

  return { ok: false, text: P.EMPTY };
}
async function readFromDisk(repoRoot, filePath) {
  try {
    return { ok: true, text: await readTextFile(join(repoRoot, filePath), FILEVIEW.ENCODING) };
  } catch {
    return { ok: false, text: P.EMPTY };
  }
}
function allLines(count) {
  const set = new Set();
  for (let line = P.ONE; line <= count; line += P.ONE) set.add(line);
  return set;
}
async function changedLines(repoRoot, filePath, range) {
  const changed = new Set();


  const args = range
    ? [...GIT.ARGS.DIFF, GIT.FLAG_UNIFIED_ZERO, range.base, range.head, GIT.FLAGS.HEAD, filePath]
    : [...GIT.ARGS.DIFF, GIT.FLAG_UNIFIED_ZERO, GIT.DEFAULT_REF, GIT.FLAGS.HEAD, filePath];
  const diff = await git(repoRoot, args);
  if (!diff.ok || !diff.stdout) return changed;

  let newLine = P.ZERO;
  for (const raw of diff.stdout.split(P.NEWLINE)) {
    if (raw.startsWith(DIFF.PREFIX.HUNK)) {
      const match = raw.match(FILEVIEW.HUNK_NEW_LINE);
      if (match) newLine = Number(match[1]);
      continue;
    }
    if (raw.startsWith(FILEVIEW.DIFF_HEADER_OLD) || raw.startsWith(FILEVIEW.DIFF_HEADER_NEW)) continue;
    if (raw.startsWith(DIFF.PREFIX.ADDED_LINE)) { changed.add(newLine); newLine += P.ONE; }
    else if (raw.startsWith(DIFF.PREFIX.CONTEXT_LINE)) newLine += P.ONE;
  }
  return changed;
}
