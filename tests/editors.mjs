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
