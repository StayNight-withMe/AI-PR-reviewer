# PR Review for VS Code
A button opens a review of the current branch in a tab. The page is the same
one the MCP server and the AI use, so a comment written here reaches the agent.
## Commands
- **PR Review: Open review of the current branch** — builds the review and opens
  it in a tab. Also on the editor title bar (the pull-request icon).
- **PR Review: Close the review tab** — stops the server and closes the tab.
## Settings
| Setting | Default | Meaning |
| --- | --- | --- |
| `prReview.mode` | `branch` | What a click reviews. `branch` is the current branch against its base. |
| `prReview.base` | *(empty)* | Base ref for the branch review; empty lets the server pick. |
| `prReview.showIn` | `webview` | `webview` (editor tab), `simpleBrowser`, or `external` (system browser). |
| `prReview.nodePath` | `node` | Node.js executable that runs the server. |
| `prReview.cliPath` | *(empty)* | Path to `src/cli.js`; empty uses the copy bundled in the extension. |
## Build and run
```sh
npm install
npm run compile
```
Then press **F5** in VS Code with this folder open to launch an Extension
Development Host, or package it:
```sh
npx vsce package
```
## Bundle the server into the VSIX
The extension looks for the server at `<extension>/server/src/cli.js`. From the
repository root, one script copies the engine into every host that ships one:
```sh
node scripts/bundle-server.mjs vscode
```
It copies `src/` (including `assets/`), `package.json` and a `BUNDLE.json`
version stamp — but not `node_modules`, which the launcher does not need.
During development, skip the copy and point `prReview.cliPath` at the checkout.
## How it talks to the server
It runs the engine and reads one line from stdout:
```
PR_REVIEW_READY {"url":"http://127.0.0.1:54321/","reviewId":"...","port":54321,...}
```
`session.ts` parses that line; the webview shows the URL in an iframe. The
process is kept alive for the tab and killed when the tab closes.
