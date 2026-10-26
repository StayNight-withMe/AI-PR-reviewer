# PR Review for Emacs
One command builds a review of the current branch and opens the page in the
browser. The work lives in the shared engine `src/cli.js`; this Lisp file only
starts it, reads the one `PR_REVIEW_READY` line and opens the URL.
## Install
Add `pr-review.el` to your `load-path` and put in your init file:
```elisp
(require 'pr-review)
(global-set-key (kbd "C-c r") #'pr-review-open)
```
## Commands
- `M-x pr-review-open` — build and open the review of the current branch.
- `M-x pr-review-stop` — stop the running server.
## Options
| Variable | Default | Meaning |
| --- | --- | --- |
| `pr-review-cli-path` | bundled copy, then a checkout | Path to `src/cli.js`. |
| `pr-review-node-path` | `node` | Node.js executable. |
| `pr-review-mode` | `branch` | `branch`, `uncommitted`, `range`, `commits` or `all`. |
| `pr-review-base` | *(engine default)* | Base ref for a branch review. |
