
(function () {
  "use strict";

  var PR = window.PR;
  var API = PR.API;
  var STATE = PR.REVIEW_STATE;
  var JSON_HEADERS = { "content-type": PR.HTTP.JSON };


  document.addEventListener("click", function (event) {
    var target = event.target;
    if (target.closest(".js-close-inline")) { PR.closeInlineFile(); return; }

    var symbolLink = target.closest(".sym-link");
    if (symbolLink) {
      if (PR.state.settings.symbolLinks === PR.SYMBOL_LINKS.OFF) return;

      if (wantsNewTab(event)) {
        event.preventDefault();
        openInNewTab(symbolLink.getAttribute("href"));
        return;
      }

      event.preventDefault();
      var section = symbolLink.closest(PR.SELECTORS.DIFF_FILE);
      PR.state.currentPath = section ? section.dataset.path : PR.P_EMPTY;
      PR.showSymbolPopover(symbolLink, symbolLink.dataset.name);
      return;
    }

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

    }
    if (target.closest(".sym-pop") || target.closest("#" + PR.IDS.BTN_SETTINGS)) return;
    PR.hideSymbolPopover();

    if (handleTabClick(target)) return;
    if (handleTreeClick(event, target)) return;
    if (handleFileHeaderClick(event, target)) return;
    if (handleCommentActions(target)) return;
    handleChromeClick(target);
  });


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


  function wantsNewTab(event) {
    return event.ctrlKey || event.metaKey || event.shiftKey;
  }


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

    }

    setTimeout(function () {
      try { tab.focus(); } catch (error) {   }
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

    event.preventDefault();
    PR.openInlineFile(path, row);
    return true;
  }


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


  function flashLine(path, line) {
    var section = document.getElementById(PR.anchorId(path));
    if (!section) return;

    var row = section.querySelector('tr[data-line="' + line + '"]');
    if (!row) return;

    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add(PR.SELECTORS.SELECTED_ROW);
    setTimeout(function () { row.classList.remove(PR.SELECTORS.SELECTED_ROW); }, PR.UI.FLASH_MS);
  }


  PR.openInlineFile = function (path, treeRow, line) {
    var host = document.getElementById(PR.IDS.INLINE_HOST);
    if (!host) return;

    PR.closeInlineFile();
    host.classList.remove(PR.SELECTORS.HIDDEN);
    PR.setHtml(host, '<div class="loading-row">Loading ' + PR.escapeHtml(path) + "…</div>");

    fetch(PR.API.FILE + "?path=" + encodeURIComponent(path))
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (file) {

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
    section.classList.remove("is-deferred", PR.SELECTORS.COLLAPSED);


    delete section.dataset.hydrated;

    var body = section.querySelector(".diff-body");
    if (body) PR.setHtml(body, PR.bodyHtml(file));

    var header = section.querySelector(".diff-file-header");
    var loadButton = header.querySelector(".js-load-file");
    if (loadButton) {

      loadButton.remove();
      PR.refreshFileMenu(section);
    }

    PR.hydrate(path, section);
  };

  PR.closeInlineFile = function () {
    var host = document.getElementById(PR.IDS.INLINE_HOST);
    if (!host) return;
    host.classList.add(PR.SELECTORS.HIDDEN);
    PR.setHtml(host, PR.P_EMPTY);
  };


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

    PR.applyContextPolicy(section).then(function () {
      scrollToSection(section);
    });

    PR.state.lastViewedFile = path;
    PR.store();
    PR.pinActiveTreeFile(path);
    return true;
  }


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


  function lastViewedTarget() {
    var state = PR.state;
    if (state.lastViewedFile && state.viewed.has(state.lastViewedFile)) return state.lastViewedFile;

    var viewed = Array.from(state.viewed);
    return viewed.length ? viewed[viewed.length - 1] : null;
  }


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
      var path = section ? section.dataset.path : openFile.dataset.path || PR.P_EMPTY;
      var href = openFile.getAttribute("href");

      if (wantsNewTab(event)) {
        event.preventDefault();
        openInNewTab(href);
        return true;
      }

      var mode = PR.state.settings.viewFileMode;

      if (mode === PR.VIEW_FILE_MODE.TAB) {
        event.preventDefault();
        openInNewTab(href);
        return true;
      }

      if (mode === PR.VIEW_FILE_MODE.PANEL) {
        event.preventDefault();
        PR.openInlineFile(path, null);
        return true;
      }

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
        bindNoteAttachments();
        PR.els.dispatchModal.classList.add("show");
        return true;
      case "btn-publish-github":
        publishToGitHub(target);
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
      case "toggle-scope":
        PR.setFilterScope(PR.state.filterScope === "all" ? "changed" : "all");
        return true;
      case "back-to-last": {
        var last = lastViewedTarget();
        if (last && PR.revealFile(last)) { PR.toast("Jumped to " + last); return true; }

        scrollToStartOfReview();
        return true;
      }
    }


    var modeButton = target.closest(".js-mode-opt");
    if (modeButton) {


      PR.setDiffMode(modeButton.dataset.mode);
      return true;
    }

    if (target.classList.contains("lightbox") || target.classList.contains("lightbox-close")) {
      PR.els.lightbox.classList.remove("show");
      return true;
    }
    return false;
  }


  document.addEventListener("input", function (event) {
    var input = event.target;

    if (input.id === PR.IDS.FILTER_INPUT) {
      PR.state.filter = input.value;
      PR.renderFileList();
      // An inline file opened earlier would otherwise sit under the new results
      // and look like a broken match.
      if (PR.closeInlineFile) PR.closeInlineFile();
      if (PR.searchInFiles) PR.searchInFiles(input.value);
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


  document.addEventListener(PR.EVENT.MOUSEDOWN, function (event) {
    if (event.button !== 0) return;

    if (event.target.closest(".hunk-expander")) return;

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

  document.addEventListener(PR.EVENT.MOUSEUP, function () {
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

  document.addEventListener(PR.EVENT.KEYDOWN, function (event) {
    if (event.key !== PR.KEY.ESCAPE) return;

    if (PR.els.dispatchModal.classList.contains("show")) {
      PR.els.dispatchModal.classList.remove("show");
      return;
    }

    PR.closeCommentForms();
    PR.clearSelection();
    PR.hideSymbolPopover();
  });


  function copyPath() {
    fetch(API.PATHS)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        PR.copyText(
          res.jsonPath,
          function () { PR.toast("Path copied"); },
          function () { PR.toast(res.jsonPath); },
        );
      });
  }


  function copyFilePath(path, anchor) {
    PR.pressFeedback(anchor);
    PR.copyText(
      path,
      function () { PR.toast("Copied " + path); },
      function () { PR.toast(path); },
    );
  }

  function postJson(url, body) {
    return fetch(url, { method: PR.HTTP.POST, headers: JSON_HEADERS, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }

  function buildReviewPayload(reviewState, body, images) {
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

      noteImages: Array.isArray(images) ? images : [],
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


  var noteImages = [];
  var noteBound = false;


  function bindNoteAttachments() {
    if (noteBound) return;
    var wrap = document.getElementById(PR.IDS.REVIEW_NOTE_WRAP);
    var textarea = document.getElementById(PR.IDS.REVIEW_BODY);
    if (!wrap || !textarea) return;
    noteBound = true;

    PR.bindImageInput(textarea, wrap, function (image) {
      noteImages.push(image);
      renderNoteChips();
    });

    renderNoteChips();
  }

  function renderNoteChips() {
    var chips = document.getElementById(PR.IDS.REVIEW_NOTE_CHIPS);
    if (!chips) return;
    chips.innerHTML = noteImages.map(function (image, index) {
      return '<span class="attach-chip">' +
        '<img src="' + PR.escapeHtml(image.dataUrl || image.file || "") + '" alt="">' +
        '<button class="attach-remove" data-i="' + index + '" title="Remove">×</button>' +
      "</span>";
    }).join("");

    chips.onclick = function (event) {
      var button = event.target.closest(".attach-remove");
      if (!button) return;
      noteImages.splice(parseInt(button.dataset.i, 10), 1);
      renderNoteChips();
    };
  }


  function submitReview() {
    var modal = PR.els.dispatchModal;
    var checked = modal.querySelector('input[name="' + PR.VERDICT_FIELD + '"]:checked');
    var verdict = checked ? checked.value : STATE.REQUEST_CHANGES;
    var body = document.getElementById(PR.IDS.REVIEW_BODY).value;
    var send = document.getElementById(PR.IDS.DISPATCH_SEND);
    var sendToAgent = !send || send.checked;
    submit(verdict, body, sendToAgent, noteImages.slice());
  }

  function submit(reviewState, body, sendToAgent, images) {
    var payload = buildReviewPayload(reviewState, body, images);
    postJson(API.REVIEW, payload)
      .then(function (res) {
        var shouldDispatch = sendToAgent && PR.DATA.dispatchEnabled;
        if (!shouldDispatch) return res;
        return postJson(API.DISPATCH, {
          reviewId: PR.DATA.id,
          jsonPath: res.jsonPath,
          markdownPath: res.markdownPath,
          review: payload,
        }).then(function (dispatchResult) {
          res.agent = dispatchResult ? dispatchResult.agent : null;
          res.targetSessionId = dispatchResult ? dispatchResult.targetSessionId : null;
          return res;
        });
      })
      .then(function (res) {
        PR.els.dispatchModal.classList.remove("show");

        noteImages = [];
        renderNoteChips();
        document.getElementById(PR.IDS.REVIEW_BODY).value = PR.P_EMPTY;

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

          PR.toast("Review saved — " + (res.reason || "nothing to fix"), true);
        } else {
          PR.toast(approved ? "Approved — review saved" : "Review saved");
        }
      })
      .catch(function (err) { PR.toast("Submit failed: " + err.message, true); });
  }


  function publishToGitHub(button) {
    if (!PR.DATA.pr || button.disabled) return;
    var result = document.getElementById("publish-result");
    var body = document.getElementById(PR.IDS.REVIEW_BODY).value;
    var checked = PR.els.dispatchModal.querySelector('input[name="' + PR.VERDICT_FIELD + '"]:checked');
    var verdict = checked ? checked.value : STATE.COMMENT;
    if (PR.state.view.kind !== PR.VIEW_KIND.REVIEW) {
      result.textContent = "Return to the full pull request before publishing.";
      return;
    }

    var payload = buildReviewPayload(verdict, body, noteImages.slice());

    var fresh = payload.comments.filter(function (comment) { return !PR.state.published.has(comment.id); });
    var alreadyPublished = payload.comments.length - fresh.length;
    payload.comments = fresh;
    payload.summary.comments = fresh.length;
    if (!fresh.length && !String(body).trim()) {
      result.textContent = alreadyPublished
        ? "Already published. Edit those comments on GitHub; this page only posts new ones."
        : "Nothing new to publish. Add a comment or a note first.";
      return;
    }
    var withImages = fresh.filter(function (comment) {
      return Array.isArray(comment.images) && comment.images.length;
    }).length + (noteImages.length ? 1 : 0);

    button.disabled = true;
    result.textContent = "Publishing to GitHub…";
    postJson(API.PUBLISH, payload)
      .then(function (response) {
        if (!response.ok || !response.published) throw new Error(response.error || "No publication confirmation received");
        fresh.forEach(function (comment) {
          PR.state.published.add(comment.id);


          var stored = PR.state.comments.filter(function (c) { return c.id === comment.id; })[0];
          if (stored) stored.published = true;
        });
        PR.store();
        result.textContent = "Published to GitHub: " + response.inlineComments + " inline comment(s). ";
        var target = response.url || PR.DATA.pr.url;
        if (/^https:\/\/github\.com\//i.test(target)) {
          var link = document.createElement("a");
          link.href = target;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "View on GitHub";
          result.appendChild(link);
        }
        if (withImages) {
          result.appendChild(document.createTextNode(" Screenshots stay in the local review: GitHub comments carry text only."));
        }
        if (alreadyPublished) {
          result.appendChild(document.createTextNode(` ${alreadyPublished} earlier comment(s) were not posted again.`));
        }
        button.textContent = "Published to GitHub";
      })
      .catch(function (err) {

        result.textContent = "Could not publish: " + err.message;
        button.disabled = false;
      });
  }


  function boot() {
    PR.restore();

    PR.loadSettings().then(function () {
      PR.applySettings();
      startUi();
      // GitHub's own "viewed" state wins over localStorage: it is the copy the
      // person sees on github.com and the one that follows new commits.
      if (PR.syncViewedFromGitHub) PR.syncViewedFromGitHub();
    });
  }


  function startUi() {
    PR.bindSettings();
    PR.bindSearch();
    PR.bindTreeResize();
    PR.applyTreeWidth();

    PR.renderTree();
    PR.renderCommits();
    PR.loadBranches();
    PR.syncFilterScope();
    PR.renderFileList();
    PR.renderSummary();
    PR.renderProgress();
    PR.syncTabs();

    PR.setText(PR.els.actionStatus, "Click the + gutter and drag to select a range");

    PR.setActiveTreeFile(PR.state.files[0] ? PR.state.files[0].path : null);
    bindScrollSpy();
    bindStorageSync();
    bindStickyHeaderOffset();
    bindActionBarHeight();

    document.body.dataset.booted = "1";
  }


  function bindStickyHeaderOffset() {
    var header = document.querySelector(".gh-header");
    var tabs = document.querySelector(".gh-tabs");
    var toolbar = document.querySelector(".gh-sticky-toolbar");
    if (!toolbar) return;
    var root = document.documentElement;
    var height = function (el) { return el ? el.getBoundingClientRect().height : 0; };

    function update() {




      var headerHeight = Math.round(height(header));
      var tabsHeight = Math.round(height(tabs));
      root.style.setProperty("--header-h", headerHeight + "px");

      var barTop = headerHeight + tabsHeight;
      root.style.setProperty("--chrome-body", barTop + "px");
      root.style.setProperty("--diff-header-top", Math.round(barTop + height(toolbar)) + "px");
    }

    update();

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(update).catch(function () {});
    window.addEventListener("resize", update);
  }


  function bindActionBarHeight() {
    var bar = document.querySelector(".action-bar");
    if (!bar) return;
    var root = document.documentElement;

    function update() {
      root.style.setProperty("--action-h", Math.round(bar.getBoundingClientRect().height) + "px");
    }

    update();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(update).catch(function () {});
    window.addEventListener("resize", update);
  }


  function bindStorageSync() {
    window.addEventListener("storage", function (event) {
      if (event.key !== PR.STORAGE_KEY) return;
      if (!PR.syncViewerComments()) return;

      PR.renderComments();
      PR.renderSummary();
      PR.toast("Comments from another tab were merged in");
    });
  }


  function bindScrollSpy() {
    var ticking = false;

    function update() {
      ticking = false;

      if (PR.state.spySuppressed) return;

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

    window.addEventListener("wheel", PR.releaseTreePin, { passive: true });
    window.addEventListener("touchmove", PR.releaseTreePin, { passive: true });
    window.addEventListener(PR.EVENT.KEYDOWN, function (event) {
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].indexOf(event.key) >= 0) {
        PR.releaseTreePin();
      }
    });
  }

  try {
    boot();
  } catch (error) {

    PR.setHtml(PR.els.diffFiles,
      '<div class="empty-state" style="padding:24px;color:var(--danger)">' +
        "Failed to start the review UI: " + PR.escapeHtml(error.message) +
        "<pre style=\"white-space:pre-wrap\">" + PR.escapeHtml((error.stack || "").split("\n").slice(0, 6).join("\n")) + "</pre>" +
      "</div>");
  }
})();
