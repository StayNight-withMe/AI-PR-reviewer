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
