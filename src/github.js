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
