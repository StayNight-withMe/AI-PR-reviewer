/**
 * The MCP server over its own transport.
 *
 * The test starts the server as a program, asks it for a review and checks
 * that the page it opens is a real page of a real repository.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { findIndexedPage, findPageRegistry, stopPageProcess } from "../src/page-process.js";
import { GIT } from "../src/config.js";
const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const SERVER = join(ROOT, "..", "src", "index.js");
