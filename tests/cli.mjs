/**
 * The launcher contract every editor integration relies on.
 *
 * VS Code, Visual Studio and Zed all run `src/cli.js`, read the one
 * `PR_REVIEW_READY` line from stdout and take the URL from it. If that line,
 * its fields or the exit behaviour change, all three break at once — so this
 * test runs the real program and checks the contract end to end.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { CLI, GIT, ROUTES } from "../src/config.js";
const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const CLI_SCRIPT = join(ROOT, "..", "src", "cli.js");
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
/** Runs the launcher and resolves with the parsed ready line, or rejects. */
function runCli(args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_SCRIPT, ...args], {
      cwd,
      windowsHide: true,
      env: { ...process.env, PR_REVIEW_OPEN: "0" },
    });

    const reader = createInterface({ input: child.stdout });
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("the launcher did not answer in time")), 60_000);

    reader.on("line", (line) => {
      if (!line.startsWith(CLI.READY_PREFIX)) return;
      clearTimeout(timer);
      const info = JSON.parse(line.slice(CLI.READY_PREFIX.length));
      resolve({ child, info });
    });

    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(stderr.trim() || `the launcher exited with code ${code}`));
    });
  });
}
