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
