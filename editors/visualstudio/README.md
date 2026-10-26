# PR Review for Visual Studio 2022
A menu button opens a dockable tab that hosts the review page in **WebView2**.
The page is the same localhost app the MCP server and the AI use, so nothing is
duplicated: this project only starts the bundled Node server and shows its URL.
## What it does
- **PR Review → Open review of the current branch** (Tools menu) opens the window
  if it is not open yet, starts the server once, and points WebView2 at the page.
- The window title shows the branch and the change size, e.g.
  `PR Review: feature/login (+120 / -34)`.
- Closing Visual Studio stops the server; the page disappears with it.
