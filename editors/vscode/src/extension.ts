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
export async function deactivate(): Promise<void> {
  await closeReview();
}
/** Opens the review of the current branch in the configured place. */
async function openReview(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("PR Review: open a folder or repository first.");
    return;
  }

  const config = vscode.workspace.getConfiguration("prReview");
  const mode = config.get<string>("mode", "branch");
  const base = config.get<string>("base", "").trim() || undefined;
  const showIn = config.get<string>("showIn", "webview");
  const nodePath = config.get<string>("nodePath", "node");
  const cliPath = resolveCliPath(context, config.get<string>("cliPath", ""));

  if (!existsSync(cliPath)) {
    vscode.window.showErrorMessage(`PR Review: the server was not found at ${cliPath}.`);
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "PR Review: building the review…" },
    async () => {
      try {
        const info = await session!.start({ nodePath, cliPath, cwd: folder.uri.fsPath, mode, base });
        await showReview(context, info, showIn);
        statusItem?.show();
        await vscode.commands.executeCommand("setContext", CONTEXT_ACTIVE, true);
        if (showIn === "external") {
          vscode.window.showInformationMessage(`PR Review: opened ${info.url} in the browser.`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`PR Review: ${(error as Error).message}`);
      }
    },
  );
}
