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
