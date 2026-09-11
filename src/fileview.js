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
