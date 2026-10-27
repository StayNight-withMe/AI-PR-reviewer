# PR Review for JetBrains IDEs
A Tools-menu action opens a review of the current branch in the browser. The
page is the same one the MCP server and the AI use, so a comment written here
reaches the agent. The engine is bundled, so no separate checkout is required.
## What it does
- **Tools → Open Review of the Current Branch** (default key `Ctrl+Alt+R`)
  starts the bundled Node engine once and opens its URL in the browser.
- **Tools → Stop the Review Server** stops it; the page does not outlive it.
- Scope is **the current branch against its base**, the same default as every
  other host.
## Requirements
- A JetBrains IDE 2023.3 (build 233) or newer.
- Node.js on `PATH`, or `PR_REVIEW_NODE` pointing at `node.exe`.
## Build
The plugin builds with the Gradle IntelliJ Platform plugin:
```sh
cd editors/jetbrains
./gradlew buildPlugin
```
The installable zip lands in `build/distributions/`. Install it with
*Settings → Plugins → ⚙ → Install Plugin from Disk…*.
During development, open this folder in IntelliJ IDEA and run the
`runIde` Gradle task.
## Bundle the server into the plugin
The plugin looks for the engine at `<plugin>/server/src/cli.js`. Copy it there
from the repository root before building:
```sh
node scripts/bundle-server.mjs            # every host
node scripts/bundle-server.mjs --list     # which hosts are known
```
During development, skip the copy and point `PR_REVIEW_CLI` at the checkout:
```
PR_REVIEW_CLI=Z:\Alpha Dev\pr-review-mcp\src\cli.js
```
## How it talks to the server
The engine prints one machine-readable line when the page is ready:
```
PR_REVIEW_READY {"url":"http://127.0.0.1:54321/","reviewId":"...","port":54321,
                 "branch":"...","additions":120,"deletions":34,...}
```
`ReviewServer` reads that line and opens the `url` in the system browser. A
launch error arrives on the same channel as `PR_REVIEW_ERROR <message>`.
