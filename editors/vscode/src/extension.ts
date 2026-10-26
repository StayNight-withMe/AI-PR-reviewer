/**
 * PR Review for VS Code.
 *
 * One command opens a review of the current branch in a tab; the page is the
 * same one the MCP server and the AI use, so a comment written here reaches the
 * agent. The page runs in a Webview (default), the Simple Browser, or the
 * system browser.
 */
import * as vscode from "vscode";
import { existsSync } from "fs";
