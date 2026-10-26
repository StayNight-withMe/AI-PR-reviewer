; PR Review for Emacs.
;
; One command builds a review of the current branch and opens the page in the
; browser. The work lives in the shared engine `src/cli.js`; this file only
; starts it, reads the one PR_REVIEW_READY line and opens the URL.
;
; Install: add this file to your `load-path` and put
;
;     (require 'pr-review)
;     (global-set-key (kbd "C-c r") #'pr-review-open)
;
; in your init file. M-x pr-review-open opens the review,
; M-x pr-review-stop stops the server.
(require 'json)
(require 'subprocess)
(require 'url-util)
(defgroup pr-review nil
  "Open a GitHub-style review of the current branch."
  :group 'tools)
(defcustom pr-review-cli-path nil
  "Path to the review engine (src/cli.js).  When nil the copy bundled
next to this file (../server/src/cli.js) is used, then a checkout on
`load-path'."
  :type '(choice (const :tag "Bundled" nil) file)
  :group 'pr-review)
(defcustom pr-review-node-path "node"
  "Node.js executable that runs the review server."
  :type 'string
  :group 'pr-review)
(defcustom pr-review-mode "branch"
  "What a review covers: branch, uncommitted, range, commits or all."
  :type 'string
  :group 'pr-review)
(defcustom pr-review-base nil
  "Base ref for a branch review.  Nil lets the server pick origin/dev, ..."
  :type '(choice (const :tag "Server default" nil) string)
  :group 'pr-review)
