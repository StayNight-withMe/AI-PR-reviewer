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
