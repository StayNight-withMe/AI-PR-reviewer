/** The review page as an own process. */
import { spawn } from "node:child_process";
import { readdir, readFile, unlink, writeFile, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GIT, P, ROUTES, SERVER } from "./config.js";
import { artifactsRoot, repoSlug } from "./artifacts.js";
/** The script that starts the page server. */
const PAGE_SCRIPT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "scripts", "serve-5454.js");
/** The registry file inside the artifacts directory of a review. */
export const PAGE_REGISTRY = "page.json";
/** Finds a free port. */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, SERVER.HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
