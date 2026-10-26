# PR Review for Sublime Text
One command builds a review of the current branch and opens the page in the
browser. The work lives in the shared engine `src/cli.js`; the Python plugin
only starts it, reads the one `PR_REVIEW_READY` line and opens the URL.
## Install
Put this folder in your Sublime `Packages/` directory
(*Preferences → Browse Packages…*), then reload. Two commands appear in the
command palette:
- **PR Review: Open Review of the Current Branch** (`Ctrl+Alt+R`)
- **PR Review: Stop the Review Server** (`Ctrl+Alt+Shift+R`)
## Settings
`Preferences → Package Settings → PR Review` (or
`pr-review.sublime-settings`):
| Setting | Default | Meaning |
| --- | --- | --- |
| `node_path` | `node` | Node.js executable that runs the server. |
| `cli_path` | *(bundled copy)* | Path to `src/cli.js`. |
| `mode` | `branch` | `branch`, `uncommitted`, `range`, `commits` or `all`. |
| `base` | *(engine default)* | Base ref for a branch review. |
| `open` | `browser` | `browser`, or `none` to only show the URL in the status bar. |
## Bundle the server (optional)
Sublime can ship the engine too. From the repository root:
```sh
node scripts/bundle-server.mjs --list   # which hosts support bundling
```
or simply leave `cli_path` empty and set it to your checkout once.
