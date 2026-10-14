/** GitHub pull-request scope, read through the GitHub CLI. */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { git } from "./git.js";
import { GH, GIT, P } from "./config.js";
const exec = promisify(execFile);
/** The GitHub CLI executable, or the plain name when it is on PATH. */
export function ghBinary(env = process.env) {
  const configured = env[GH.ENV_BIN];
  if (configured && configured.trim()) return configured.trim();
  return GH.BIN;
}
/** File extensions of a script that must be run with the Node binary. */
const NODE_SCRIPT = /\.(?:mjs|cjs|js)$/i;
/** The command and leading arguments that run `gh`. */
export function ghCommand(env = process.env) {
  const binary = ghBinary(env);
  return NODE_SCRIPT.test(binary)
    ? { file: process.execPath, prefix: [binary] }
    : { file: binary, prefix: [] };
}
/** True when the configured `gh` exists or is resolvable on PATH. */
export function hasGh(env = process.env) {
  const binary = ghBinary(env);
  if (binary !== GH.BIN) return existsSync(binary);
  return true;
// resolved by the shell; a missing binary fails at spawn with a clear error
}
/** Runs `gh` and returns its stdout. */
async function gh(repoPath, args, { allowFailure = true } = {}) {
  const { file, prefix } = ghCommand();
  try {
    const { stdout } = await exec(file, [...prefix, ...args], {
      cwd: repoPath,
      maxBuffer: GIT.MAX_BUFFER,
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, GH_PAGER: P.EMPTY, GH_PROMPT_DISABLED: "1" },
    });
    return { ok: true, stdout };
  } catch (error) {
    if (error.code === GIT.ENOENT) {
      const failure = new Error(GH.ERROR_NO_BIN);
      if (allowFailure) return { ok: false, error: failure, missingBinary: true };
      throw failure;
    }

    const stderr = String(error.stderr ?? error.message ?? P.EMPTY).trim();
    // A configured wrapper script that does not exist: node starts, cannot load

    // logged-out user.
    if (/cannot find module|no such file|ENOENT/i.test(stderr)) {
      const failure = new Error(GH.ERROR_NO_BIN);
      if (allowFailure) return { ok: false, error: failure, missingBinary: true, stderr };
      throw failure;
    }

    const failure = /auth|login|authentication/i.test(stderr)
      ? new Error(`${GH.ERROR_NOT_AUTHED} (${stderr})`)
      : new Error(stderr || GH.ERROR_NO_PR);
    if (allowFailure) return { ok: false, error: failure, stderr };
    throw failure;
  }
}
