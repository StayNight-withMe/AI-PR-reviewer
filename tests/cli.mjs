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
