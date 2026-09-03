import { DIFF, P } from "./config.js";
/** The `diff --git` header line pins the two paths with their `a/` and `b/` prefixes; an optional… */
const HEADER_PATTERN = DIFF.PATTERN.HEADER;
const HUNK_PATTERN = DIFF.PATTERN.HUNK;
const LANG_DEFAULT = DIFF.LANGUAGE.PLAINTEXT;
const LANGS = DIFF.LANGUAGE;
const STATUS = DIFF.STATUS;
const KIND = DIFF.LINE_KIND;
const PREFIX = DIFF.PREFIX;
/** C-style single-character escapes git may write inside a quoted path. */
const PATH_ESCAPE_CHARS = { n: P.NEWLINE, t: P.TAB, r: "\r", [P.QUOTE]: P.QUOTE, [P.BACKSLASH]: P.BACKSLASH };
function stripPrefix(value) {
  if (value.startsWith(PREFIX.A) || value.startsWith(PREFIX.B)) {
    return value.slice(P.TWO);
  }
  return value;
}
/** Decodes the escapes of a git-quoted path. */
function unquote(value) {
  if (!value.includes(P.BACKSLASH)) return value;

  const bytes = [];
  for (let index = P.ZERO; index < value.length; index += 1) {
    const char = value[index];
    if (char !== P.BACKSLASH) {
      bytes.push(...utf8Bytes(char));
      continue;
    }

    const next = value.slice(index + P.ONE, index + P.TWO);
    if (DIFF.PATTERN.OCTAL.test(value.slice(index + P.ONE, index + P.TWO + P.TWO))) {
      bytes.push(parseInt(value.slice(index + P.ONE, index + P.TWO + P.TWO), 8));
      index += P.THREE;
    } else {
      const mapped = PATH_ESCAPE_CHARS[next] ?? next;
      bytes.push(...utf8Bytes(mapped));
      index += P.ONE;
    }
  }

  return new TextDecoder().decode(Uint8Array.from(bytes));
}
/** The UTF-8 bytes of a single code point. */
function utf8Bytes(char) {
  return Array.from(new TextEncoder().encode(char));
}
/** Splits a unified diff into the file/hunk/row model the UI renders. */
export function parseDiff(text) {
  // git always terminates its output with a newline. A plain split leaves one
  // trailing empty line, which became a phantom `meta` row at the bottom of
  // every file's last hunk. Dropping a single trailing empty line is exact:
  // every real hunk line carries a prefix (`+`, `-`, ` `) or is a marker.
  const normalized = String(text ?? P.EMPTY).replace(/\r\n/g, P.NEWLINE);
  const body = normalized.endsWith(P.NEWLINE) ? normalized.slice(P.ZERO, -P.ONE) : normalized;
  const lines = body.split(P.NEWLINE);
  const files = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith(PREFIX.DIFF_GIT)) {
      flush();
      current = createFile(line);
      continue;
    }

    if (!current) continue;

    if (!current.headerConsumed) consumeHeader(current, line);

    if (line.startsWith(PREFIX.HUNK)) {
      current.headerConsumed = true;
      current.hunks.push(createHunk(line));
      continue;
    }

    if (current.hunks.length === P.ZERO) {
      current.raw.push(line);
      continue;
    }

    current.hunks[current.hunks.length - P.ONE].lines.push(line);
  }

  flush();
  files.forEach(attachRows);
  return files;
}
function createFile(headerLine) {
  const match = headerLine.match(HEADER_PATTERN);
  const rawOld = match ? unquote(match[1]) : P.EMPTY;
  const rawNew = match ? unquote(match[2]) : P.EMPTY;

  return {
    oldPath: stripPrefix(rawOld),
    newPath: stripPrefix(rawNew),
    path: stripPrefix(rawNew || rawOld),
    status: STATUS.MODIFIED,
    binary: false,
    oldMode: null,
    newMode: null,
    hunks: [],
    additions: P.ZERO,
    deletions: P.ZERO,
    raw: [headerLine],
    headerConsumed: false,
  };
}
function consumeHeader(file, line) {
  if (line.startsWith(PREFIX.NEW_FILE_MODE)) file.status = STATUS.ADDED;
  else if (line.startsWith(PREFIX.DELETED_FILE_MODE)) file.status = STATUS.DELETED;
  else if (line.startsWith(PREFIX.RENAME_FROM)) {
    file.status = STATUS.RENAMED;
    file.oldPath = line.slice(PREFIX.RENAME_FROM.length).trim();
  } else if (line.startsWith(PREFIX.RENAME_TO)) {
    file.status = STATUS.RENAMED;
    file.newPath = line.slice(PREFIX.RENAME_TO.length).trim();
    file.path = file.newPath;
  } else if (line.startsWith(PREFIX.OLD_MODE)) file.oldMode = line.slice(PREFIX.OLD_MODE.length).trim();
  else if (line.startsWith(PREFIX.NEW_MODE)) file.newMode = line.slice(PREFIX.NEW_MODE.length).trim();
  else if (line.startsWith(PREFIX.BINARY_FILES)) file.binary = true;
}
function createHunk(line) {
  const match = line.match(HUNK_PATTERN);
  if (!match) return { header: line, section: P.EMPTY, oldStart: P.ZERO, oldLines: P.ZERO, newStart: P.ZERO, newLines: P.ZERO, lines: [] };

  return {
    header: line,
    section: match[5] ?? P.EMPTY,
    oldStart: Number(match[1]),
    oldLines: Number(match[2] ?? P.ONE),
    newStart: Number(match[3]),
    newLines: Number(match[4] ?? P.ONE),
    lines: [],
  };
}
