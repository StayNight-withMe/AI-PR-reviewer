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
