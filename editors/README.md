# PR Review — editor integrations
One repository, one review engine, many hosts. Every integration is a thin
client over the same server: they start `src/cli.js`, read the one ready line it
prints, and show the URL it returns. No integration re-implements the diff, the
scope or the page.
```
        ┌─────────────────────────────┐
        │  src/cli.js  (the engine)   │   scope -> diff -> page -> localhost
        └──────────────┬──────────────┘
              prints:  │  PR_REVIEW_READY {"url":..., "reviewId":...}
        ┌──────────────┼──────────────┬──────────────┬───────────────┐
        │              │              │              │               │
   VS Code        Visual Studio   JetBrains       Zed         Neovim
   (Webview)      (WebView2)      (browser)  (MCP + task)   (Lua + MCP)
        │              │              │              │               │
   Sublime        Emacs          Helix       MCP clients (agent)
   (Python)       (Lisp)         (task+MCP)
```
## Scope: the current branch, not the whole project
A click reviews **the current branch against its base** (`--mode branch`). The
