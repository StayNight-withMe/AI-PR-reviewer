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
/** Clears the cached git path (used by tests that change the environment). */
export function resetGitBinary() {
  gitBinary = null;
}
/** Runs git with safe arguments. */
export async function git(repoPath, args, { allowFailure = true, input } = {}) {
  const binary = resolveGitBinary();
  // Without this, git writes a path with non-ASCII letters as an octal
  // escape ("docs/\320\275.md"), and the review would show the escape
  // instead of the real name of the file.
  const safeArgs = [...GIT.ARGS.QUOTE_PATH_OFF, ...args];
  try {
    const { stdout } = await exec(binary, safeArgs, {
      cwd: repoPath,
      maxBuffer: GIT.MAX_BUFFER,
      windowsHide: true,
      encoding: "utf8",
      input,
    });
    return { ok: true, code: P.ZERO, stdout };
  } catch (error) {
    const stdout = error.stdout ?? P.EMPTY;
    const stderr = error.stderr ?? P.EMPTY;

    if (error.code === GIT.ENOENT) {
      throw new Error(GIT.ERROR_NOT_INSTALLED);
    }
    if (!allowFailure) {
      throw new Error(`${binary} ${safeArgs.join(P.SPACE)} failed: ${stderr || error.message}`);
    }
    return { ok: false, code: error.code ?? P.ONE, stdout, stderr };
  }
}
