/** File viewer: syntax-highlighted source with its own inline review comments. */
(function () {
  "use strict";

  var DATA = JSON.parse(document.getElementById("file-data").textContent);
  var STORAGE_PREFIX = "pr-review:v3:";
  var STORAGE_KEY = STORAGE_PREFIX + DATA.reviewId;
  /** The device-wide settings key, shared with the review page. */
  var SETTINGS_KEY = "pr-review:settings:v1";
  /** The same route the review page uses (mirror of PR.API.SETTINGS). */
  var SETTINGS_ROUTE = "/api/settings";
  var TOAST_MS = 2600;
  var COMMENT_EVENT = "pr-review:comments-changed";
  var COMMENT_SIDE_RIGHT = "right";
  var DEFAULT_AUTHOR = "You";
  var FILE_COMMENT_LINE = 1;
  var LINE_HASH_PREFIX = "#L";
  var SUPPRESS_CLICK_MS = 300;
  var TARGET_CLASS = "v-target";
  var THEME_DARK = "dark";
  var THEME_LIGHT = "light";

  var changed = new Set(DATA.changed || []);
  var state = { selection: null, comments: [] };

  /** ------------------------------- primitives ----------------------------- */
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast show";
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = "toast"; }, TOAST_MS);
  }

  /** ------------------------------- persistence ---------------------------- */
  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function loadComments() {
    var data = readStore();
    state.comments = (data.comments || []).filter(function (comment) { return comment.path === DATA.path; });
  }

  function saveComments() {
    try {
      var data = readStore();
      var others = (data.comments || []).filter(function (comment) { return comment.path !== DATA.path; });
      data.comments = others.concat(state.comments);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      /** storage may be disabled; comments still live in memory */
    }
  }

  function notifyParent() {
    if (!window.opener) return;
    try {
      window.opener.postMessage({ type: COMMENT_EVENT, path: DATA.path, reviewId: DATA.reviewId }, "*");
    } catch (e) {
      /** opener may be closed */
    }
  }

  /** ------------------------------ highlighting ---------------------------- */
  /** Highlighted HTML for one line of the file. */
  function highlightLine(text) {
    if (window.hljs && DATA.language && DATA.language !== "plaintext") {
      try {
        var language = window.hljs.getLanguage(DATA.language) ? DATA.language : null;
        return window.hljs.highlight(text || " ", language ? { language: language, ignoreIllegals: true } : {}).value || " ";
      } catch (e) {
        /** fall through to escaped text */
      }
    }
    return escapeHtml(text) || " ";
  }

  /** -------------------------------- rendering ----------------------------- */
  function render() {
    if (DATA.tooLarge) {
      document.getElementById("file-viewer").innerHTML =
        '<div class="empty-state" style="padding:24px">File is too large to display.</div>';
      return;
    }

    var lines = DATA.lines.map(function (text, index) { return { number: index + 1, text: text }; });

    document.getElementById("file-viewer").innerHTML =
      '<table class="viewer-table"><colgroup><col style="width:26px"><col style="width:60px"><col></colgroup><tbody>' +
        lines.map(renderRow).join("") +
      "</tbody></table>";

    document.getElementById("line-count").textContent = DATA.lines.length + " lines";
    document.getElementById("changed-count").textContent = changed.size ? changed.size + " changes" : "";

    renderComments();
    focusHashLine();
  }

  function renderRow(line) {
    // Syntax colours, but no changed-line tint: this is a file reader, not a diff.
    return '<tr class="v-row" id="L' + line.number + '" data-line="' + line.number + '">' +
      '<td class="v-gutter"><button class="line-plus js-v-comment" data-line="' + line.number +
        '" title="Add a comment on this line">+</button></td>' +
      '<td class="v-num">' + line.number + "</td>" +
      '<td class="v-code">' + highlightLine(line.text) + "</td></tr>";
  }

  /** Scrolls to and flashes the line named by a `#L123` URL hash. */
  function focusHashLine() {
    var match = new RegExp("^" + LINE_HASH_PREFIX + "(\\d+)$").exec(window.location.hash);
    if (!match) return;

    var line = parseInt(match[1], 10);
    var row = document.querySelector('tr[data-line="' + line + '"]');
    if (!row) return;

    document.querySelectorAll("." + TARGET_CLASS).forEach(function (node) { node.classList.remove(TARGET_CLASS); });
    row.classList.add(TARGET_CLASS);
    row.scrollIntoView({ block: "center" });
  }

  function renderComments() {
    document.querySelectorAll(".file-comment-banner").forEach(function (node) { node.remove(); });

    state.comments.forEach(function (comment) {
      var row = document.querySelector('tr[data-line="' + comment.lineStart + '"]');
      if (!row) return;

      var holder = document.createElement("tr");
      holder.innerHTML = '<td colspan="3" class="file-comment-banner"></td>';
      holder.querySelector("td").appendChild(commentBox(comment));
      row.parentNode.insertBefore(holder, row.nextSibling);
    });
  }

  function commentBox(comment) {
    var range = comment.lineEnd && comment.lineEnd !== comment.lineStart
      ? comment.lineStart + "–" + comment.lineEnd
      : String(comment.lineStart);
    var images = (comment.images || []).map(function (image) {
      return '<span class="attach-chip"><img src="' + escapeHtml(image.dataUrl || image.file) + '" alt=""></span>';
    }).join("");

    var box = document.createElement("div");
    box.className = "comment-box pending";
    box.dataset.id = comment.id;
    box.innerHTML =
      '<div class="comment-head">' +
        '<span class="avatar">' + escapeHtml((comment.author || DEFAULT_AUTHOR).charAt(0).toUpperCase()) + "</span>" +
        "<strong>" + escapeHtml(comment.author || DEFAULT_AUTHOR) + "</strong>" +
        '<span class="muted small">lines ' + range + "</span>" +
        '<span class="spacer"></span>' +
        '<button class="gh-btn gh-btn-sm ghost js-edit">Edit</button>' +
        '<button class="gh-btn gh-btn-sm ghost danger js-delete">Delete</button>' +
      "</div>" +
      '<div class="comment-body">' + escapeHtml(comment.body) + "</div>" +
      (images ? '<div class="comment-attachments">' + images + "</div>" : "");
    return box;
  }

  /** --------------------------------- editor -------------------------------- */
  function openEditor(lineStart, lineEnd, existing) {
    closeEditor();

    var row = document.querySelector('tr[data-line="' + lineStart + '"]');
    if (!row) return;

    var banner = document.createElement("tr");
    banner.className = "file-comment-banner js-editor";
    var label = lineEnd !== lineStart ? "lines " + lineStart + "–" + lineEnd : "line " + lineStart;
    banner.innerHTML =
      '<td colspan="3"><div class="comment-box pending">' +
        '<div class="comment-head">' +
          '<span class="avatar">Y</span><strong>' + DEFAULT_AUTHOR + "</strong>" +
          '<span class="muted small">' + label + "</span>" +
          '<span class="spacer"></span><button class="gh-btn gh-btn-sm ghost js-cancel">Cancel</button>' +
        "</div>" +
        '<div class="comment-form">' +
          '<div class="editor-attach js-chips"></div>' +
          '<textarea class="gh-textarea js-text" rows="4" placeholder="Leave a comment… (paste a screenshot with Ctrl+V)">' +
            (existing ? escapeHtml(existing.body) : "") +
          "</textarea>" +
          '<div class="comment-form-actions">' +
            '<button class="gh-btn gh-btn-primary gh-btn-sm js-save">' + (existing ? "Update comment" : "Add comment") + "</button>" +
          "</div>" +
        "</div>" +
      "</div></td>";

    row.parentNode.insertBefore(banner, row.nextSibling);

    var images = existing && existing.images ? existing.images.slice() : [];
    var chips = banner.querySelector(".js-chips");
    var textarea = banner.querySelector(".js-text");

    function renderChips() {
      chips.innerHTML = images.map(function (image, index) {
        return '<span class="attach-chip"><img src="' + escapeHtml(image.dataUrl || image.file) + '" alt="">' +
          '<button class="attach-remove" data-i="' + index + '">×</button></span>';
      }).join("");
    }
    renderChips();

    chips.addEventListener("click", function (event) {
      var button = event.target.closest(".attach-remove");
      if (!button) return;
      images.splice(parseInt(button.dataset.i, 10), 1);
      renderChips();
    });

    bindImageInput(textarea, function (image) { images.push(image); renderChips(); });

    banner.querySelector(".js-cancel").addEventListener("click", closeEditor);
    banner.querySelector(".js-save").addEventListener("click", function () {
      var body = textarea.value.trim();
      if (!body && images.length === 0) { toast("Empty comment"); return; }

      if (existing) {
        existing.body = body;
        existing.images = images;
      } else {
        state.comments.push({
          id: "c" + Date.now(),
          path: DATA.path,
          side: COMMENT_SIDE_RIGHT,
          lineStart: lineStart,
          lineEnd: lineEnd || lineStart,
          body: body,
          images: images,
          author: DEFAULT_AUTHOR,
          createdAt: new Date().toISOString(),
        });
      }

      closeEditor();
      saveComments();
      notifyParent();
      render();
      toast("Comment saved");
    });

    setTimeout(function () { textarea.focus(); }, 0);
  }

  function closeEditor() {
    document.querySelectorAll(".js-editor").forEach(function (node) { node.remove(); });
  }

  function bindImageInput(textarea, onImage) {
    function addFiles(files) {
      Array.from(files || []).forEach(function (file) {
        if (!file || file.type.indexOf("image/") !== 0) return;
        var reader = new FileReader();
        reader.onload = function () { onImage({ dataUrl: reader.result, name: file.name }); };
        reader.readAsDataURL(file);
      });
    }

    textarea.addEventListener("paste", function (event) {
      var files = Array.from(event.clipboardData.items)
        .filter(function (item) { return item.type.indexOf("image/") === 0; })
        .map(function (item) { return item.getAsFile(); })
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      addFiles(files);
    });

    textarea.addEventListener("dragover", function (event) { event.preventDefault(); });
    textarea.addEventListener("drop", function (event) {
      event.preventDefault();
      addFiles(event.dataTransfer ? event.dataTransfer.files : []);
    });
  }

  /** -------------------------------- selection ------------------------------ */
  var dragStart = null;
  var suppressClickUntil = 0;

  function select(from, to) {
    document.querySelectorAll(".v-selected").forEach(function (row) { row.classList.remove("v-selected"); });
    var start = Math.min(from, to);
    var end = Math.max(from, to);
    state.selection = { start: start, end: end };

    document.querySelectorAll("tr[data-line]").forEach(function (row) {
      var line = parseInt(row.dataset.line, 10);
      if (line >= start && line <= end) row.classList.add("v-selected");
    });
  }

  function lineOf(cell) {
    var row = cell.closest("tr");
    if (row) return parseInt(row.dataset.line, 10);
    return parseInt(cell.textContent, 10);
  }

  /** ---------------------------------- events ------------------------------- */
  var viewer = document.getElementById("file-viewer");

  viewer.addEventListener("mousedown", function (event) {
    if (event.button !== 0) return;
    // Drag selection starts on the "+" gutter (or the number as a fallback).
    var cell = event.target.closest("td.v-gutter, td.v-num");
    if (!cell) return;
    dragStart = lineOf(cell);
    if (isNaN(dragStart)) return;
    select(dragStart, dragStart);
    event.preventDefault();
  });

  viewer.addEventListener("mouseover", function (event) {
    if (dragStart === null) return;
    var cell = event.target.closest("td.v-gutter, td.v-num");
    if (!cell) return;
    var line = lineOf(cell);
    if (isNaN(line)) return;
    select(dragStart, line);
  });

  document.addEventListener("mouseup", function () {
    if (dragStart === null) return;
    var selection = state.selection;
    dragStart = null;
    if (!selection) return;
    suppressClickUntil = Date.now() + SUPPRESS_CLICK_MS;
    openEditor(selection.start, selection.end, null);
  });

  document.getElementById("btn-add-file-comment").addEventListener("click", function () {
    openEditor(FILE_COMMENT_LINE, FILE_COMMENT_LINE, null);
  });

  document.getElementById("btn-theme").addEventListener("click", function () {
    var html = document.documentElement;
    var next = html.getAttribute("data-theme") === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    html.setAttribute("data-theme", next);
    saveTheme(next);
  });

  document.addEventListener("click", function (event) {
    var plus = event.target.closest(".js-v-comment");
    if (plus) {
      if (Date.now() < suppressClickUntil) return;
      var plusLine = parseInt(plus.dataset.line, 10);
      if (isNaN(plusLine)) return;
      state.selection = { start: plusLine, end: plusLine };
      select(plusLine, plusLine);
      openEditor(plusLine, plusLine, null);
      return;
    }

    var remove = event.target.closest(".js-delete");
    if (remove) {
      var box = remove.closest(".comment-box");
      state.comments = state.comments.filter(function (comment) { return comment.id !== box.dataset.id; });
      saveComments();
      notifyParent();
      render();
      toast("Comment deleted");
      return;
    }

    var edit = event.target.closest(".js-edit");
    if (edit) {
      var target = edit.closest(".comment-box");
      var comment = state.comments.find(function (item) { return item.id === target.dataset.id; });
      if (comment) openEditor(comment.lineStart, comment.lineEnd || comment.lineStart, comment);
      return;
    }

    var chip = event.target.closest(".attach-chip");
    if (chip && !event.target.classList.contains("attach-remove")) {
      window.open(chip.querySelector("img").src, "_blank", "noopener");
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeEditor();
  });

  window.addEventListener("hashchange", focusHashLine);

  /** The viewer keeps the same sticky chain as the review page: the toolbar must
      sit below the page header, whose height changes when its contents wrap on a
      narrow window. */
  (function bindStickyOffset() {
    var header = document.querySelector(".gh-header");
    if (!header) return;
    var root = document.documentElement;

    function update() {
      root.style.setProperty("--header-h", Math.round(header.getBoundingClientRect().height) + "px");
    }

    update();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(update).catch(function () {});
    window.addEventListener("resize", update);
  })();

  /** ---------------------------- device settings ---------------------------- */
  /** Reads the device settings from the server. */
  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  /** Saves the theme into the shared settings, keeping the other options. */
  function saveTheme(theme) {
    var settings = readSettings();
    settings.theme = theme;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /** storage may be disabled */ }

    try {
      fetch(SETTINGS_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      }).catch(function () {});
    } catch (e) { /** offline: the theme still applies to this page */ }
  }

  /** ----------------------------------- boot -------------------------------- */
  var cachedTheme = readSettings().theme;
  if (cachedTheme) document.documentElement.setAttribute("data-theme", cachedTheme);

  fetch(SETTINGS_ROUTE)
    .then(function (response) { return response.json(); })
    .then(function (result) {
      var theme = result && result.ok && result.settings ? result.settings.theme : null;
      if (theme) document.documentElement.setAttribute("data-theme", theme);
    })
    .catch(function () {});

  loadComments();
  render();
})();
