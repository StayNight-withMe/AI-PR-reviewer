/**
 * The editor integrations are thin hosts over ONE contract: they run
 * `src/cli.js`, read the one `PR_REVIEW_READY` line and show its URL.
 *
 * This test guards that contract without needing any GUI editor installed:
 *
 *   1. Every shipped bundle actually exists and contains the engine.
 *   2. A bundled engine launches, serves a real page and stops on signal —
 *      i.e. the copy the editor runs is not stale or incomplete.
 *   3. The compiled VS Code `ReviewSession` starts and stops that same engine
 *      (it is plain CommonJS and imports no `vscode`, so Node can drive it).
 *   4. The Visual Studio and Zed receipts point at the same launcher contract.
 *
 * Run: node tests/editors.mjs
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP, CLI, GIT, ROUTES } from "../src/config.js";
const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(ROOT, "..");
/** True when `artifact` is missing or older than `source`. */
function isStale(artifact, source) {
  if (!existsSync(artifact)) return true;
  if (!existsSync(source)) return false;
  return statSync(artifact).mtimeMs < statSync(source).mtimeMs;
}
/** host key -> the bundle directory its code looks in. */
const BUNDLES = {
  vscode: join(PROJECT, "editors", "vscode", "server"),
  visualstudio: join(PROJECT, "editors", "visualstudio", "server"),
  jetbrains: join(PROJECT, "editors", "jetbrains", "server"),
};
const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`PASS ${name}`),
      (error) => {
        failures.push(`${name}: ${error.message}`);
        console.log(`FAIL ${name} — ${error.message}`);
      },
    );
}
/** Runs a launcher and resolves with its ready payload; rejects on failure. */
function runLauncher(cliPath, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      windowsHide: true,
      env: { ...process.env, PR_REVIEW_OPEN: "0" },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the launcher did not answer in time"));
    }, 60_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((l) => l.startsWith(CLI.READY_PREFIX));
      if (!line) return;
      clearTimeout(timer);
      resolve({ child, info: JSON.parse(line.slice(CLI.READY_PREFIX.length)) });
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(stderr.trim() || `the launcher exited with code ${code}`));
    });
  });
}
