import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { GIT, P } from "./config.js";
const exec = promisify(execFile);
/** Absolute path of the git executable, or the plain name when it is on PATH. */
let gitBinary = null;
export function resolveGitBinary(env = process.env) {
  if (gitBinary) return gitBinary;

  for (const candidate of GIT.INSTALL_CANDIDATES) {
    const path = candidate.replace(/%([A-Z_]+)%/g, (match, name) => env[name] ?? match);
    if (path.includes("%")) continue;
    if (existsSync(path)) {
      gitBinary = path;
      return gitBinary;
    }
  }
  // Fall back to the PATH lookup: git may live in a custom location.
  gitBinary = GIT.BIN;
  return gitBinary;
}
