/**
 * Makes the GitHub CLI available for `mode=pr`.
 *
 * Reviewing a pull request uses `gh` (the GitHub CLI), which owns the token,
 * the host and the authentication. Rather than ask the user to install it by
 * hand, this script checks for `gh` and offers to install it with the platform's
 * own package manager. It is deliberately conservative:
 *
 *   - a tool the user already has is never touched;
 *   - `--check` only reports (exit 0 = ready, 1 = missing), for CI and the
 *     postinstall hook;
 *   - `--install` is the only mode that changes the machine, and only when the
 *     package manager reports success;
 *   - a sandboxed or offline environment is not an error: it prints the exact
 *     command the user can run later.
 *
 * Usage:
 *   node scripts/ensure-gh.mjs             # report, install when possible
 *   node scripts/ensure-gh.mjs --check     # report only (CI / postinstall)
 *   node scripts/ensure-gh.mjs --check --never-fail   # postinstall: never fails
 *   node scripts/ensure-gh.mjs --install   # install if missing
 *   node scripts/ensure-gh.mjs --json      # machine-readable result
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { GH } from "../src/config.js";
const exec = promisify(execFile);
const PACKAGE_MANAGERS = {
  win32: [
    { bin: "winget", args: ["install", "--id", "GitHub.cli", "-e", "--source", "winget", "--accept-source-agreements", "--accept-package-agreements"] },
    { bin: "choco", args: ["install", "gh", "-y"] },
    { bin: "scoop", args: ["install", "gh"] },
  ],
  darwin: [
    { bin: "brew", args: ["install", "gh"] },
  ],
  linux: [
    { bin: "apt-get", args: ["install", "-y", "gh"], sudo: true },
    { bin: "dnf", args: ["install", "-y", "gh"], sudo: true },
    { bin: "pacman", args: ["-S", "--noconfirm", "gh"], sudo: true },
    { bin: "apk", args: ["add", "gh"], sudo: true },
  ],
};
const DOCS_URL = "https://cli.github.com";
/** True when the `gh` binary answers. */
async function ghPresent(binary) {
  try {
    await exec(binary, ["--version"], { windowsHide: true, timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}
/** The first package manager that exists on this machine. */
async function findPackageManager() {
  const platform = process.platform === "win32"
    ? "win32"
    : process.platform === "darwin" ? "darwin" : "linux";
  const candidates = PACKAGE_MANAGERS[platform] ?? [];

  for (const candidate of candidates) {
    if (await commandExists(candidate.bin)) return candidate;
  }
  return null;
}
