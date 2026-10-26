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
