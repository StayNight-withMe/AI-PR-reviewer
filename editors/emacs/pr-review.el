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
(defvar pr-review--process nil "The running review server process.")
(defvar pr-review--url nil "The URL of the open review.")
(defconst pr-review--ready-prefix "PR_REVIEW_READY ")
(defconst pr-review--error-prefix "PR_REVIEW_ERROR ")
(defun pr-review--resolve-cli ()
  "Return the engine path, or nil when it cannot be found."
  (or pr-review-cli-path
      (let* ((here (file-name-directory (or load-file-name buffer-file-name)))
             (bundled (expand-file-name "../server/src/cli.js" here)))
        (when (file-exists-p bundled) bundled))
      (locate-library "server/src/cli.js")))
(defun pr-review--repo-root ()
  "The nearest ancestor holding a .git entry, or `default-directory'."
  (locate-dominating-file default-directory ".git"))
(defun pr-review--on-line (line)
  "Handle one line of engine output."
  (cond
   ((string-prefix-p pr-review--ready-prefix line)
    (let* ((json-object-type 'alist)
           (payload (json-read-from-string
                     (substring line (length pr-review--ready-prefix)))))
      (setq pr-review--url (alist-get 'url payload))
      (message "PR Review: %s (+%s / -%s)"
               (or (alist-get 'branch payload) "review")
               (or (alist-get 'additions payload) 0)
               (or (alist-get 'deletions payload) 0))
      (when pr-review--url (browse-url pr-review--url))))
   ((string-prefix-p pr-review--error-prefix line)
    (message "PR Review: %s" (substring line (length pr-review--error-prefix))))))
(defun pr-review--sentinel (process _event)
  "Clear state when the engine process ends."
  (when (eq process pr-review--process)
    (setq pr-review--process nil pr-review--url nil)))
;;;###autoload
(defun pr-review-open ()
  "Build and open the review of the current branch."
  (interactive)
  (if pr-review--process
      (when pr-review--url (browse-url pr-review--url))
    (let ((cli (pr-review--resolve-cli)))
      (if (null cli)
          (message "PR Review: src/cli.js not found; set `pr-review-cli-path'")
        (let* ((repo (pr-review--repo-root))
               (args (append (list pr-review-node-path cli
                                   "--repo" repo
                                   "--mode" pr-review-mode
                                   "--json")
                             (when pr-review-base
                               (list "--base" pr-review-base)))))
          (setq pr-review--process
                (make-process
                 :name "pr-review"
                 :command args
                 :noquery t
                 :connection-type 'pipe
                 :filter (lambda (_proc output)
                           (dolist (line (split-string output "\n" t))
                             (pr-review--on-line line)))
                 :sentinel #'pr-review--sentinel))
          (message "PR Review: building the review of %s..." repo))))))
;;;###autoload
(defun pr-review-stop ()
  "Stop the running review server."
  (interactive)
  (when pr-review--process
    (delete-process pr-review--process)
    (setq pr-review--process nil pr-review--url nil)
    (message "PR Review: stopped")))
(provide 'pr-review)
