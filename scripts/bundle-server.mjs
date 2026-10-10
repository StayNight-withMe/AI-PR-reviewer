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
