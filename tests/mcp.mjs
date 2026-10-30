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
