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
import { join } from "path";
import { ReviewSession, ReviewInfo } from "./session";
const COMMAND_OPEN = "prReview.open";
const COMMAND_CLOSE = "prReview.close";
const VIEW_TYPE = "prReview.review";
const CONTEXT_ACTIVE = "prReview.active";
let session: ReviewSession | undefined;
let panel: vscode.WebviewPanel | undefined;
let statusItem: vscode.StatusBarItem | undefined;
export function activate(context: vscode.ExtensionContext): void {
  session = new ReviewSession();
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = COMMAND_CLOSE;
  statusItem.text = "$(git-pull-request) Review open";
  statusItem.tooltip = "Close the PR Review tab";

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_OPEN, () => openReview(context)),
    vscode.commands.registerCommand(COMMAND_CLOSE, () => closeReview()),
    { dispose: () => void closeReview() },
  );
}
