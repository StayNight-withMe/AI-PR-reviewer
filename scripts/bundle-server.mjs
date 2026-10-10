/**
 * Copies the review engine into an editor integration's bundle folder.
 *
 * Every integration runs `src/cli.js` as a child process and reads one ready
 * line from it. The engine needs its whole `src/` tree (including `assets/`,
 * which the page inlines at startup) and its `package.json`, but NOT
 * `node_modules`: only the MCP layer (`src/index.js`) imports the MCP SDK and
 * zod, and the syntax highlighter is vendored in `assets/hljs-bundle.js`.
 * Shipping without node_modules keeps each VSIX/plugin small.
 *
 * Usage:
 *   node scripts/bundle-server.mjs                 # every host in the table
 *   node scripts/bundle-server.mjs vscode visualstudio
 *   node scripts/bundle-server.mjs --list
 *
 * The destination of each host is the path its host code looks in
 * (`<extension>/server/src/cli.js`), so nothing else has to be configured.
 */
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
