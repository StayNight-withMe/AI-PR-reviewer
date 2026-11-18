/** Entry point: wires DOM events to the modules and boots the page. */
(function () {
  "use strict";

  var PR = window.PR;
  var API = PR.API;
  var STATE = PR.REVIEW_STATE;
  var JSON_HEADERS = { "content-type": "application/json" };

  /** -------------------------------- clicking ------------------------------- */
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (target.closest(".js-close-inline")) { PR.closeInlineFile(); return; }

    var symbolLink = target.closest(".sym-link");
    if (symbolLink) {
      if (PR.state.settings.symbolLinks === PR.SYMBOL_LINKS.OFF) return;
      // Ctrl/Cmd/Shift always means "new tab", matching the browser.
      if (wantsNewTab(event)) {
        event.preventDefault();
        openInNewTab(symbolLink.getAttribute("href"));
        return;
      }
      // Always show the usage menu first: it lists every place the symbol is used, so the user picks…
      event.preventDefault();
      var section = symbolLink.closest(PR.SELECTORS.DIFF_FILE);
      PR.state.currentPath = section ? section.dataset.path : PR.P_EMPTY;
      PR.showSymbolPopover(symbolLink, symbolLink.dataset.name);
      return;
    }
    // Clicking a definition/usage entry inside the popover navigates the same way a tree click does:…
    var popoverLink = target.closest(".sym-def, .sym-use");
    if (popoverLink && popoverLink.closest(".sym-pop")) {
      if (wantsNewTab(event)) {
        event.preventDefault();
        PR.hideSymbolPopover();
        openInNewTab(popoverLink.getAttribute("href"));
        return;
      }
      if (PR.state.settings.openLinksInline) {
        event.preventDefault();
        PR.hideSymbolPopover();
        PR.openTarget(null, popoverLink.getAttribute("href"));
        return;
      }
      return;
    // default navigation
    }
    if (target.closest(".sym-pop") || target.closest("#" + PR.IDS.BTN_SETTINGS)) return;
    PR.hideSymbolPopover();

    if (handleTabClick(target)) return;
    if (handleTreeClick(event, target)) return;
    if (handleFileHeaderClick(event, target)) return;
    if (handleCommentActions(target)) return;
    handleChromeClick(target);
  });

  /** Middle-click on a tree row opens the file viewer in a new tab. */
  document.addEventListener("auxclick", function (event) {
    if (event.button !== 1) return;

    var row = event.target.closest(PR.SELECTORS.TREE_ROW);
    if (!row || row.dataset.dir === "true") return;

    var href = row.getAttribute("href");
    if (!href) return;

    event.preventDefault();
    openInNewTab(href);
  });

  function handleTabClick(target) {
    var tab = target.closest(".gh-tab");
    if (!tab) return false;
    PR.state.tab = tab.dataset.tab;
    PR.syncTabs();
    if (PR.state.tab === PR.TAB.COMMITS) PR.renderCommits();
    PR.store();
    return true;
  }

  /** Ctrl/Cmd/Shift/middle-click: the browser convention for "new tab". */
  function wantsNewTab(event) {
    return event.ctrlKey || event.metaKey || event.shiftKey;
  }

  /** Opens a file in a new tab and switches to it. */
  function openInNewTab(href) {
    var tab = window.open(href, PR.UI.TARGET_BLANK);
    if (!tab) {
      PR.toast(PR.MESSAGES.POPUP_BLOCKED, true);
      return;
    }

    try {
      tab.opener = null;
      tab.focus();
    } catch (error) {
    // A browser that refuses the assignment still opened the tab.
    }

    setTimeout(function () {
      try { tab.focus(); } catch (error) { /** tab closed already */ }
    }, PR.UI.FOCUS_RETRY_MS);
  }

  function handleTreeClick(event, target) {
    var row = target.closest(PR.SELECTORS.TREE_ROW);
    if (!row) return false;

    if (row.dataset.dir === "true") {
      event.preventDefault();
      var wrap = row.closest(".tree-node").querySelector(PR.SELECTORS.TREE_CHILDREN);
      var hidden = wrap.classList.toggle(PR.SELECTORS.HIDDEN);
      row.querySelector(PR.SELECTORS.TREE_CHEVRON).classList.toggle(PR.SELECTORS.COLLAPSED, hidden);
      return true;
    }

    var path = row.dataset.path;
    // Ctrl/Cmd/Shift on any file row opens the standalone viewer in a new tab, exactly like…
    if (wantsNewTab(event)) {
      event.preventDefault();
      openInNewTab(row.getAttribute("href"));
      return true;
    }

    if (PR.state.changedPaths.has(path)) {
      event.preventDefault();
      PR.pressFeedback(row);
      PR.revealFile(path);
      PR.pinActiveTreeFile(path);
      return true;
    }
    if (PR.state.settings.treeOpen === PR.TREE_OPEN.NEW) {
      event.preventDefault();
      openInNewTab(row.getAttribute("href"));
      return true;
    }
    // Opening an unchanged file must behave like a changed one: stay in the review and scroll there…
    event.preventDefault();
    PR.openInlineFile(path, row);
    return true;
  }

  /** Opens a `/file?path=…#L<n>` link the same way a tree click does: a changed file scrolls to its… */
  PR.openTarget = function (name, href) {
    var target = parseFileHref(href);
    if (!target) return;

    if (PR.state.changedPaths.has(target.path) && PR.revealFile(target.path)) {
      if (target.line) flashLine(target.path, target.line);
      return;
    }
    PR.openInlineFile(target.path, null, target.line);
  };

  function parseFileHref(href) {
    if (!href) return null;

    try {
      var url = new URL(href, window.location.origin);
      var path = url.searchParams.get("path");
      if (!path) return null;
      var match = /^#L(\d+)$/.exec(url.hash || "");
      return { path: path, line: match ? parseInt(match[1], 10) : null };
    } catch {
      return null;
    }
  }

  /** Marks and scrolls to a single line inside an already-rendered diff. */
  function flashLine(path, line) {
    var section = document.getElementById(PR.anchorId(path));
    if (!section) return;

    var row = section.querySelector('tr[data-line="' + line + '"]');
    if (!row) return;

    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add(PR.SELECTORS.SELECTED_ROW);
    setTimeout(function () { row.classList.remove(PR.SELECTORS.SELECTED_ROW); }, PR.UI.FLASH_MS);
  }

  /** Renders an unchanged file as a section inside the review, right where the user is, so the same… */
  PR.openInlineFile = function (path, treeRow, line) {
    var host = document.getElementById(PR.IDS.INLINE_HOST);
    if (!host) return;

    PR.closeInlineFile();
    host.classList.remove("hidden");
    PR.setHtml(host, '<div class="loading-row">Loading ' + PR.escapeHtml(path) + "…</div>");

    fetch(PR.API.FILE + "?path=" + encodeURIComponent(path))
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (file) {
        // highlightIn() reads lines from this cache, so seed it first or the section renders without any…
        if (file && file.lines) {
          PR.state.cache[path] = file;
          PR.state.highlightCache[path] = PR.highlightLines(file.lines.join("\n"), file.language);
        }

        host.innerHTML = PR.renderInlineSection(file);
        host.scrollIntoView({ behavior: "smooth", block: "start" });
        host.classList.add(PR.SELECTORS.FLASH);
        setTimeout(function () { host.classList.remove(PR.SELECTORS.FLASH); }, PR.UI.FLASH_MS);
        if (treeRow) PR.pinActiveTreeFile(path);
        PR.highlightIn(host, path, file.language);
        if (line) flashLine(path, line);
        if (PR.renderComments) PR.renderComments();
      })
      .catch(function (error) {
        PR.setHtml(host, '<div class="empty-state" style="padding:16px">Could not open ' +
          PR.escapeHtml(path) + ": " + PR.escapeHtml(error.message) + "</div>");
      });
  };

  PR.loadDeferredFile = function (section) {
    if (!section) return;
    var path = section.dataset.path;
    var file = PR.findFile(path);
    if (!file) return;

    PR.state.loaded.add(path);
    section.classList.remove("is-deferred", "collapsed");
    // Hydration is keyed by this flag; the section was never rendered before,

    delete section.dataset.hydrated;

    var body = section.querySelector(".diff-body");
    if (body) PR.setHtml(body, PR.bodyHtml(file));

    var header = section.querySelector(".diff-file-header");
    var loadButton = header.querySelector(".js-load-file");
    if (loadButton) {
      // "Expand all" is decided once the content is known (a small file has nothing to expand, so it…
      loadButton.remove();
      PR.refreshFileMenu(section);
    }

    PR.hydrate(path, section);
  };

  PR.closeInlineFile = function () {
    var host = document.getElementById(PR.IDS.INLINE_HOST);
    if (!host) return;
    host.classList.add("hidden");
    PR.setHtml(host, PR.P_EMPTY);
  };

  /** Builds the section used for an unchanged file inside the review. */
  PR.renderInlineSection = function (file) {
    var lines = file.lines || [];
    var rows = lines.map(function (text, index) {
      var n = index + 1;
      return '<tr class="row-ctx" data-side="right" data-line="' + n + '" data-kind="ctx">' +
        '<td class="diff-gutter"><button class="line-plus js-comment" data-side="right" data-line="' + n +
          '" title="Add a comment on this line">+</button></td>' +
        '<td class="diff-num" data-side="right" data-line="' + n + '">' + n + "</td>" +
        '<td class="diff-code" data-new="' + n + '" data-kind="ctx">' + PR.escapeHtml(text) + "</td>" +
      "</tr>";
    }).join("");

    return '<section class="diff-file inline-open" data-path="' + PR.escapeHtml(file.path) + '">' +
      '<header class="diff-file-header">' +
        '<button class="chevron js-close-inline" aria-label="Close" title="Close this file">×</button>' +
        '<span class="status-pill">unchanged</span>' +
        '<span class="path" data-full-path="' + PR.escapeHtml(file.path) + '">' + PR.escapeHtml(file.path) + "</span>" +
        '<span class="file-stats"><span class="muted small">' + lines.length + " lines</span></span>" +
      "</header>" +
      '<div class="diff-body"><table class="diff-table no-old-side"><colgroup>' +
        '<col class="c-gutter"><col class="c-num"><col></colgroup><tbody>' + rows + "</tbody></table></div>" +
    "</section>";
  };

  PR.revealFile = function (path) {
    var section = document.getElementById(PR.anchorId(path));

    if (!section && PR.findFile(path)) {
      var cleared = false;

      if (PR.state.filter) {
        PR.state.filter = "";
        var filter = document.getElementById(PR.IDS.FILTER_INPUT);
        if (filter) filter.value = "";
        cleared = true;
      }
      if (PR.state.settings.hideViewed && PR.state.viewed.has(path)) {
        PR.state.settings.hideViewed = false;
        PR.syncViewedToggle();
        cleared = true;
      }

      if (cleared) {
        PR.store();
        PR.renderFileList();
        section = document.getElementById(PR.anchorId(path));
      }
    }
    if (!section) return false;

    if (section.classList.contains(PR.SELECTORS.COLLAPSED)) PR.toggleCollapse(section);
    // they are inserted, and a scroll done before that lands on the wrong place.
    PR.applyContextPolicy(section).then(function () {
      scrollToSection(section);
    });

    PR.state.lastViewedFile = path;
    PR.store();
    PR.pinActiveTreeFile(path);
    return true;
  }

  /** Scrolls a file into view. */
  function scrollToSection(section) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    section.classList.add(PR.SELECTORS.FLASH);
    setTimeout(function () { section.classList.remove(PR.SELECTORS.FLASH); }, PR.UI.FLASH_MS);

    setTimeout(function () {
      var rect = section.getBoundingClientRect();
      if (Math.abs(rect.top) > PR.UI.SCROLL_SETTLE_TOLERANCE) {
        section.scrollIntoView({ behavior: "auto", block: "start" });
      }
    }, PR.UI.SCROLL_SETTLE_MS);
  }

  /** The file "Last file" should jump to: the one the user looked at most recently, as long as it… */
  function lastViewedTarget() {
    var state = PR.state;
    if (state.lastViewedFile && state.viewed.has(state.lastViewedFile)) return state.lastViewedFile;

    var viewed = Array.from(state.viewed);
    return viewed.length ? viewed[viewed.length - 1] : null;
  }

  /** Falls back to the top of the review when no file is marked Viewed. */
  function scrollToStartOfReview() {
    var first = PR.els.diffFiles.querySelector(PR.SELECTORS.DIFF_FILE);
    if (first) first.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
    PR.toast(PR.MESSAGES.START_OF_REVIEW);
  }

  function handleFileHeaderClick(event, target) {
    var collapse = target.closest(".js-collapse");
    if (collapse) { PR.toggleCollapse(collapse.closest(PR.SELECTORS.DIFF_FILE)); return true; }

    var viewed = target.closest(PR.SELECTORS.VIEWED_WRAP);
    if (viewed) {
      event.preventDefault();
      PR.toggleViewed(viewed.closest(PR.SELECTORS.DIFF_FILE).dataset.path);
      return true;
    }

    var expandAll = target.closest(".js-expand-all");
    if (expandAll) {
      event.preventDefault();
      PR.closeFileMenus();
      PR.expandAll(expandAll.closest(PR.SELECTORS.DIFF_FILE));
      return true;
    }

    var menuButton = target.closest(".js-file-menu");
    if (menuButton) {
      event.preventDefault();
      PR.toggleFileMenu(menuButton);
      return true;
    }

    var copyPath = target.closest(".js-copy-path");
    if (copyPath) {
      event.preventDefault();
      PR.closeFileMenus();
      copyFilePath(copyPath.dataset.path, copyPath);
      return true;
    }

    var loadFile = target.closest(".js-load-file");
    if (loadFile) {
      event.preventDefault();
      PR.loadDeferredFile(loadFile.closest(PR.SELECTORS.DIFF_FILE));
      return true;
    }

    var openFile = target.closest(".js-open-file");
    if (openFile) {
      var section = openFile.closest(PR.SELECTORS.DIFF_FILE);
      var path = section ? section.dataset.path : PR.P_EMPTY;
      var href = openFile.getAttribute("href");
      // Ctrl/Cmd/Shift always means "new tab", matching the browser.
      if (wantsNewTab(event)) {
        event.preventDefault();
        openInNewTab(href);
        return true;
      }

      var mode = PR.state.settings.viewFileMode;
      // is read side by side.
      if (mode === PR.VIEW_FILE_MODE.TAB) {
        event.preventDefault();
        openInNewTab(href);
        return true;
      }
      // An embedded panel: the file opens inside the review, like a tab of its own, without leaving…
      if (mode === PR.VIEW_FILE_MODE.PANEL) {
        event.preventDefault();
        PR.openInlineFile(path, null);
        return true;
      }
      // opens in the standalone viewer.
      if (PR.state.changedPaths.has(path)) {
        event.preventDefault();
        PR.revealFile(path);
        return true;
      }
    }

    var expander = target.closest(".js-expand");
    if (expander) {      event.preventDefault();

      var bar = expander.closest(".hunk-expander");
      var index = parseInt(bar ? bar.dataset.hunk : "0", 10);
      PR.expandHunk(expander.closest(PR.SELECTORS.DIFF_FILE), index, expander.dataset.dir);
      return true;
    }

    var plus = target.closest(".js-comment");
    if (plus) {
      event.preventDefault();
      // click; opening it again would move it and steal focus.
      if (Date.now() < PR.state.suppressPlusUntil) return true;
      var line = parseInt(plus.dataset.line, 10);
      if (!line) return true;
      PR.clearSelection();
      PR.openCommentForm(plus.closest(PR.SELECTORS.DIFF_FILE).dataset.path, plus.dataset.side, line, line, null);
      return true;
    }

    var fileComment = target.closest(".js-file-comment");
    if (fileComment) {
      event.preventDefault();
      PR.openCommentForm(fileComment.closest(PR.SELECTORS.DIFF_FILE).dataset.path, PR.SIDE.RIGHT, 0, 0, null);
      return true;
    }
    return false;
  }

  function handleCommentActions(target) {
    var edit = target.closest(".js-edit");
    if (edit) {
      var comment = PR.state.comments.find(function (item) { return item.id === edit.dataset.id; });
      if (!comment) return true;
      PR.clearSelection();
      PR.openCommentForm(
        comment.path, comment.side,
        comment.lineStart || null,
        comment.lineEnd || comment.lineStart || null,
        comment,
      );
      return true;
    }

    var remove = target.closest(".js-delete");
    if (remove) { PR.deleteComment(remove.dataset.id); return true; }

    var resolve = target.closest(".js-resolve");
    if (resolve) { PR.toggleResolved(resolve.dataset.id); return true; }

    var goto = target.closest(".js-goto-comment");
    if (goto) { PR.revealFile(goto.dataset.path); return true; }

    var chip = target.closest(".attach-chip");
    if (chip && !target.classList.contains("attach-remove")) {
      PR.els.lightbox.querySelector("img").src = chip.querySelector("img").src;
      PR.els.lightbox.classList.add("show");
      return true;
    }
    return false;
  }

  function handleChromeClick(target) {
    var renameButton = target.closest(".js-rename-commit");
    if (renameButton) { PR.startRenameCommit(renameButton.dataset.sha); return true; }

    var commitButton = target.closest(".js-open-commit");
    if (commitButton) { PR.openCommit(commitButton.closest(".commit-item").dataset.sha); return true; }
    if (target.closest(".js-back-to-review")) { PR.backToReview(); return true; }
    if (target.closest(".js-tree-toggle")) { PR.toggleTreeAll(); return true; }
    if (target.id === PR.IDS.BTN_OPEN_SCOPE) { PR.openScope(); return true; }
    if (target.id === PR.IDS.COMMIT_PICKER_SAVE) { PR.saveCommitPicker(); return true; }
    if (target.id === PR.IDS.COMMIT_PICKER_CANCEL || target.id === PR.IDS.COMMIT_PICKER_CLOSE) {
      PR.closeCommitPicker();
      return true;
    }
    if (target.classList.contains("commit-picker-modal")) return true;
    if (target.id === PR.IDS.COMMIT_PICKER) { PR.closeCommitPicker(); return true; }

    if (target.classList.contains("js-close-modal")) {
      PR.els.dispatchModal.classList.remove("show");
      return true;
    }

    switch (target.id) {
      case "btn-submit":
        PR.els.dispatchModal.classList.add("show");
        return true;
      case "btn-dispatch-submit":
        submitReview();
        return true;
      case "btn-copy-path":
        copyPath();
        return true;
      case "toggle-viewed":
        PR.state.settings.hideViewed = !PR.state.settings.hideViewed;
        PR.store();
        PR.applySettings();
        PR.renderFileList();
        PR.syncViewedToggle();
        return true;
      case "back-to-last": {
        var target = lastViewedTarget();
        if (target && PR.revealFile(target)) { PR.toast("Jumped to " + target); return true; }
        // Nothing has been reviewed yet: treat "last file" as the first file.
        scrollToStartOfReview();
        return true;
      }
    }

    if (target.classList.contains("lightbox") || target.classList.contains("lightbox-close")) {
      PR.els.lightbox.classList.remove("show");
      return true;
    }
    return false;
  }

  /** -------------------------------- filtering ------------------------------ */
  document.addEventListener("input", function (event) {
    var input = event.target;

    if (input.id === PR.IDS.FILTER_INPUT) {
      PR.state.filter = input.value;
      PR.renderFileList();
      restoreCaret(PR.IDS.FILTER_INPUT);
      return;
    }

    if (input.id === PR.IDS.TREE_FILTER_INPUT) {
      PR.state.treeFilter = input.value;
      PR.renderTree();
      restoreCaret(PR.IDS.TREE_FILTER_INPUT);
    }
  });

  function restoreCaret(id) {
    var input = document.getElementById(id);
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  /** --------------------------- multiline selection ------------------------- */
  document.addEventListener("mousedown", function (event) {
    if (event.button !== 0) return;
    // must not start there, or preventDefault would swallow its click.
    if (event.target.closest(".hunk-expander")) return;
    // Selection starts on the "+" gutter, like GitHub, not on line numbers.
    var cell = event.target.closest(PR.SELECTORS.GUTTER_CELL);
    if (!cell) return;

    var row = cell.closest("tr");
    var section = cell.closest(PR.SELECTORS.DIFF_FILE);
    if (!row || !section || !row.querySelector(PR.SELECTORS.DIFF_NUM_CELL)) return;

    var plus = cell.querySelector(PR.SELECTORS.LINE_PLUS);
    var side = (plus && plus.dataset.side) || cell.dataset.side || PR.SIDE.RIGHT;

    PR.state.drag = { path: section.dataset.path, startRow: row, side: side };
    PR.selectRowRange(section, row, row, side);
    document.body.classList.add("selecting");
    event.preventDefault();
  });

  document.addEventListener("mouseover", function (event) {
    var drag = PR.state.drag;
    if (!drag) return;

    var row = event.target.closest("tr");
    if (!row || !row.querySelector(PR.SELECTORS.DIFF_NUM_CELL)) return;

    var section = row.closest(PR.SELECTORS.DIFF_FILE);
    if (!section || section.dataset.path !== drag.path) return;

    PR.selectRowRange(section, drag.startRow, row, drag.side);
  });

  document.addEventListener("mouseup", function () {
    var drag = PR.state.drag;
    if (!drag) return;

    var selection = PR.state.selection;
    PR.state.drag = null;
    document.body.classList.remove("selecting");
    if (!selection) return;

    PR.state.suppressPlusUntil = Date.now() + PR.UI.SUPPRESS_CLICK_MS;
    PR.openCommentForm(selection.path, selection.side, selection.start, selection.end, null);
  });

  document.addEventListener("change", function (event) {
    if (event.target.id === PR.IDS.BRANCH_SELECT) {
      PR.changeBranch(event.target.value);
      return;
    }

    // The verdict cards show which option is chosen; the radio itself decides.
    if (event.target.name === PR.VERDICT_FIELD) {
      var cards = PR.els.dispatchModal.querySelectorAll(".radio-card");
      for (var i = 0; i < cards.length; i += 1) {
        var input = cards[i].querySelector("input");
        cards[i].classList.toggle("selected", !!input && input.checked);
      }
      return;
    }

    if (event.target.id === PR.IDS.SCOPE_MODE) {
      PR.syncScopeVisibility();
      // A range needs concrete commits, so offer the picker right away.
      if (event.target.value === PR.MODE.RANGE) PR.openCommitPicker();
      return;
    }

    if (event.target.classList.contains("commit-pick-box")) {
      PR.togglePickedCommit(event.target.dataset.sha, event.target.checked);
      return;
    }

    if (event.target.classList.contains("js-unlock-commit")) {
      PR.toggleCommitUnlock(event.target.dataset.sha, event.target.checked);
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    // Esc closes the topmost overlay first: the submit dialogs sit above the page, so they must go…
    if (PR.els.dispatchModal.classList.contains("show")) {
      PR.els.dispatchModal.classList.remove("show");
      return;
    }

    PR.closeCommentForms();
    PR.clearSelection();
    PR.hideSymbolPopover();
  });

  /** --------------------------------- submit -------------------------------- */
  function copyPath() {
    fetch(API.PATHS)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        navigator.clipboard.writeText(res.jsonPath).then(
          function () { PR.toast("Path copied"); },
          function () { PR.toast(res.jsonPath); },
        );
      });
  }

  /** Copies one file's repository path from its header button. */
  function copyFilePath(path, anchor) {
    PR.pressFeedback(anchor);
    navigator.clipboard.writeText(path).then(
      function () { PR.toast("Copied " + path); },
      function () { PR.toast(path); },
    );
  }

  function postJson(url, body) {
    return fetch(url, { method: PR.HTTP.POST, headers: JSON_HEADERS, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }

  function buildReviewPayload(reviewState, body) {
    var state = PR.state;
    return {
      id: PR.DATA.id,
      repo: PR.DATA.repo,
      branch: PR.DATA.branch,
      base: PR.DATA.base,
      head: PR.DATA.head,
      mode: PR.DATA.mode,
      files: state.files.map(function (file) {
        return { path: file.path, status: file.status, additions: file.additions, deletions: file.deletions };
      }),
      comments: state.comments,
      viewedFiles: Array.from(state.viewed),
      reviewState: reviewState,
      reviewBody: body,
      summary: {
        files: state.files.length,
        additions: PR.DATA.stats.additions,
        deletions: PR.DATA.stats.deletions,
        comments: state.comments.length,
      },
      exportedAt: new Date().toISOString(),
    };
  }

  /** Submits the review with the verdict chosen in the dialog. */
  function submitReview() {
    var modal = PR.els.dispatchModal;
    var checked = modal.querySelector('input[name="' + PR.VERDICT_FIELD + '"]:checked');
    var verdict = checked ? checked.value : STATE.REQUEST_CHANGES;
    var body = document.getElementById(PR.IDS.REVIEW_BODY).value;
    var send = document.getElementById(PR.IDS.DISPATCH_SEND);
    var sendToAgent = !send || send.checked;
    submit(verdict, body, sendToAgent);
  }

  function submit(reviewState, body, sendToAgent) {
    postJson(API.REVIEW, buildReviewPayload(reviewState, body))
      .then(function (res) {
        var shouldDispatch = sendToAgent && PR.DATA.dispatchEnabled;
        if (!shouldDispatch) return res;
        return postJson(API.DISPATCH, {
          reviewId: PR.DATA.id,
          jsonPath: res.jsonPath,
          markdownPath: res.markdownPath,
          review: buildReviewPayload(reviewState, body),
        }).then(function (dispatchResult) {
          res.agent = dispatchResult ? dispatchResult.agent : null;
          res.targetSessionId = dispatchResult ? dispatchResult.targetSessionId : null;
          return res;
        });
      })
      .then(function (res) {
        PR.els.dispatchModal.classList.remove("show");
        // Say plainly whether the fix turn actually started, and where it went: silently showing "saved"…
        var approved = reviewState === STATE.APPROVE;
        var agent = res ? res.agent : null;
        var target = res && res.targetSessionId ? res.targetSessionId.slice(0, 12) : null;
        if (agent && agent.started) {
          PR.toast(approved
            ? "Approved and sent to session " + (target || "?") + " — the AI has the note"
            : "Review sent to session " + (target || "?") + " — the AI is fixing it now");
        } else if (agent) {
          PR.toast("Review saved. Auto-send not started: " + (agent.reason || "unknown reason"), true);
        } else if (res && res.dispatched === false) {
          // An empty review is a valid submit; it just has nothing to fix.
          PR.toast("Review saved — " + (res.reason || "nothing to fix"), true);
        } else {
          PR.toast(approved ? "Approved — review saved" : "Review saved");
        }
      })
      .catch(function (err) { PR.toast("Submit failed: " + err.message, true); });
  }

  /** ---------------------------------- boot --------------------------------- */
  function boot() {
    PR.restore();
    // Settings live on the server (a review page's port changes between reviews, so localStorage…
    PR.loadSettings().then(function () {
      PR.applySettings();
      startUi();
    });
  }

  /** Renders the page once the settings are known. */
  function startUi() {
    PR.bindSettings();
    PR.bindSearch();
    PR.bindTreeResize();
    PR.applyTreeWidth();

    PR.renderTree();
    PR.renderCommits();
    PR.loadBranches();
    PR.renderFileList();
    PR.renderSummary();
    PR.renderProgress();
    PR.syncTabs();

    PR.setText(PR.els.actionStatus, "Click the + gutter and drag to select a range");

    PR.setActiveTreeFile(PR.state.files[0] ? PR.state.files[0].path : null);
    bindScrollSpy();
    bindStorageSync();
    bindStickyHeaderOffset();
    // A marker tests and embedders can wait for: the page is fully wired, so a change made now is…
    document.body.dataset.booted = "1";
  }

  /** Keeps the sticky file header below the sticky toolbar. */
  function bindStickyHeaderOffset() {
    var toolbar = document.querySelector(".gh-sticky-toolbar");
    if (!toolbar) return;

    function update() {
      // header must stick at that offset PLUS the toolbar's own height, or it would slide under the…
      var rect = toolbar.getBoundingClientRect();
      var stickyTop = parseFloat(getComputedStyle(toolbar).top) || 0;
      var top = Math.max(0, Math.round(stickyTop + rect.height));
      document.documentElement.style.setProperty("--diff-header-top", top + "px");
    }

    update();

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(update).catch(function () {});
    window.addEventListener("resize", update);
  }

  /** Picks up comments written in another tab (the standalone file viewer). */
  function bindStorageSync() {
    window.addEventListener("storage", function (event) {
      if (event.key !== PR.STORAGE_KEY) return;
      if (!PR.syncViewerComments()) return;

      PR.renderComments();
      PR.renderSummary();
      PR.toast("Comments from another tab were merged in");
    });
  }

  /** Keeps the tree highlight on whichever file is currently at the top of the viewport, so… */
  function bindScrollSpy() {
    var ticking = false;

    function update() {
      ticking = false;
      // A navigation pin stays until the user scrolls on their own.
      if (PR.state.spySuppressed) return;
      // content-visibility makes off-screen sections report estimated sizes, so their rects cannot be…
      var probe = document.elementFromPoint(
        Math.round(window.innerWidth / 2),
        PR.UI_SCROLL_SPY_OFFSET,
      );
      var section = probe && probe.closest ? probe.closest(PR.SELECTORS.DIFF_FILE) : null;

      if (!section) section = nearestSectionAbove();
      if (section) PR.setActiveTreeFile(section.dataset.path);
    }

    function nearestSectionAbove() {
      var sections = PR.els.diffFiles.querySelectorAll(PR.SELECTORS.DIFF_FILE);
      var best = null;
      for (var i = 0; i < sections.length; i += 1) {
        var rect = sections[i].getBoundingClientRect();
        // Skip sections the engine is not rendering (estimate-only boxes).
        if (rect.height === 0) continue;
        if (rect.top <= PR.UI_SCROLL_SPY_OFFSET) best = sections[i];
        else break;
      }
      return best;
    }

    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    // Jumping to a file scrolls the window; keep the pinned file highlighted until the user takes…
    window.addEventListener("wheel", PR.releaseTreePin, { passive: true });
    window.addEventListener("touchmove", PR.releaseTreePin, { passive: true });
    window.addEventListener("keydown", function (event) {
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].indexOf(event.key) >= 0) {
        PR.releaseTreePin();
      }
    });
  }

  try {
    boot();
  } catch (error) {
    // Never leave a blank page: show what broke instead of failing silently.
    PR.setHtml(PR.els.diffFiles,
      '<div class="empty-state" style="padding:24px;color:var(--danger)">' +
        "Failed to start the review UI: " + PR.escapeHtml(error.message) +
        "<pre style=\"white-space:pre-wrap\">" + PR.escapeHtml((error.stack || "").split("\n").slice(0, 6).join("\n")) + "</pre>" +
      "</div>");
  }
})();
