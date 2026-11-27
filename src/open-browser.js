/**
 * Opens a URL in the user's browser.
 *
 * The page is already printed by the caller, so a browser that cannot start is
 * never fatal. A detached child with no `error` listener would otherwise turn a
 * missing opener into an unhandled event that kills the whole process — exactly
 * what happened on Linux servers and containers without `xdg-open`.
 */
import { spawn } from "node:child_process";

export function openerCommand(platform = process.platform) {
  if (platform === "win32") return { command: "cmd", args: (url) => ["/c", "start", "", url] };
  if (platform === "darwin") return { command: "open", args: (url) => [url] };
  return { command: "xdg-open", args: (url) => [url] };
}

export function openInBrowser(url, { platform = process.platform } = {}) {
  const { command, args } = openerCommand(platform);
  try {
    const child = spawn(command, args(url), { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
