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
