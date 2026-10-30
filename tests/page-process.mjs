/**
 * The review page has to outlive the process that started it.
 *
 * The MCP server can be restarted at any time; the page in the browser must
 * keep working, otherwise a submit dies with the chat connection. This test
 * starts the page in a helper process, lets that helper exit and then checks
 * that the page still answers.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { findPageRegistry, findFreePort, stopPageProcess } from "../src/page-process.js";
import { GIT, MODE } from "../src/config.js";
const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const HELPER = join(ROOT, "fixtures", "start-page-helper.mjs");
