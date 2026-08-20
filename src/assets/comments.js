/** Inline comments: rendering, editing, image attachments and drag selection. */
(function () {
  "use strict";

  var PR = window.PR;

  /** ------------------------------- rendering ------------------------------ */
  function attachmentChip(image, index, removable) {
    var src = image.dataUrl || image.file || "";
    return '<span class="attach-chip">' +
      '<img src="' + PR.escapeHtml(src) + '" alt="">' +
      (removable ? '<button class="attach-remove" data-i="' + index + '" title="Remove">×</button>' : "") +
    "</span>";
  }

  function commentBoxHtml(comment) {
    var range = comment.lineStart
      ? (comment.lineEnd && comment.lineEnd !== comment.lineStart
        ? comment.lineStart + "–" + comment.lineEnd
        : String(comment.lineStart))
      : "file";
    var images = (comment.images || []).map(function (image, index) {
      return attachmentChip(image, index, false);
    }).join("");
    var resolved = comment.resolved === true;

    return '<div class="comment-box' + (resolved ? " is-resolved" : "") + '" data-id="' + comment.id + '">' +
      '<div class="comment-head">' +
        '<span class="avatar">' + PR.escapeHtml((comment.author || "You").charAt(0).toUpperCase()) + "</span>" +
        "<strong>" + PR.escapeHtml(comment.author || "You") + "</strong>" +
        '<span class="muted small">' + (comment.lineStart ? "line " + range : "file comment") + "</span>" +
        (resolved ? '<span class="resolved-pill" title="This comment is resolved">✓ Resolved</span>' : "") +
        '<span class="spacer"></span>' +
        '<button class="gh-btn gh-btn-sm ghost js-resolve" data-id="' + comment.id + '">' +
          (resolved ? "Unresolve" : "Resolve") + "</button>" +
        '<button class="gh-btn gh-btn-sm ghost js-edit" data-id="' + comment.id + '">Edit</button>' +
        '<button class="gh-btn gh-btn-sm ghost danger js-delete" data-id="' + comment.id + '">Delete</button>' +
      "</div>" +
      '<div class="comment-body">' + PR.escapeHtml(comment.body) + "</div>" +
      (images ? '<div class="comment-attachments">' + images + "</div>" : "") +
    "</div>";
  }

  /** Flips a comment between resolved and open. */
  PR.toggleResolved = function (id) {
    var comment = PR.state.comments.find(function (item) { return item.id === id; });
    if (!comment) return;

    comment.resolved = comment.resolved !== true;
    PR.store();
    PR.renderComments();
    PR.renderSummary();
    PR.toast(comment.resolved ? "Comment resolved" : "Comment reopened");
  };

  /** True when every comment on a file is resolved (used by the tree badge). */
  PR.fileFullyResolved = function (path) {
    var own = PR.state.comments.filter(function (comment) { return comment.path === path; });
    return own.length > 0 && own.every(function (comment) { return comment.resolved === true; });
  };

  PR.renderComments = function () {
    var state = PR.state;
    document.querySelectorAll(".comment-row, .file-comment-banner").forEach(function (node) {
      // would wipe a form the user is typing in.
      if (node.classList.contains("js-editor") || node.querySelector(".js-editor")) return;
      node.remove();
    });

    state.comments.forEach(function (comment) {
      var section = PR.findSection(comment.path);
      if (!section) return;

      if (!comment.lineStart) {
        var header = section.querySelector(".diff-file-header");
        var banner = document.createElement("div");
        banner.className = "file-comment-banner";
        banner.innerHTML = commentBoxHtml(comment);
        header.parentNode.insertBefore(banner, header.nextSibling);
        return;
      }

      var end = comment.lineEnd || comment.lineStart;
      var rows = rowsInRange(section, comment.side, comment.lineStart, end);
      if (!rows.length) return;

      var row = document.createElement("tr");
      row.className = "comment-row";
      row.innerHTML = '<td colspan="' + columnCount(rows[rows.length - 1]) + '">' + commentBoxHtml(comment) + "</td>";
      rows[rows.length - 1].parentNode.insertBefore(row, rows[rows.length - 1].nextSibling);
    });

    renderSidebar();
  };

  /** Number of columns in the diff table that holds `row`. */
  function columnCount(row) {
    var table = row.closest("table");
    if (!table) return 1;

    var cols = table.querySelectorAll("colgroup > col").length;
    if (cols) return cols;

    var widest = 0;
    table.querySelectorAll("tr").forEach(function (candidate) {
      var count = 0;
      for (var i = 0; i < candidate.children.length; i += 1) {
        count += candidate.children[i].colSpan || 1;
      }
      if (count > widest) widest = count;
    });
    return widest || 1;
  }

  /** Rows whose number cell on `side` falls inside the line range. */
  function rowsInRange(section, side, from, to) {
    var rows = [];
    var cells = section.querySelectorAll('td.diff-num[data-side="' + side + '"][data-line]');

    for (var i = 0; i < cells.length; i += 1) {
      var line = parseInt(cells[i].dataset.line, 10);
      if (isNaN(line) || line < from || line > to) continue;
      var row = cells[i].closest("tr");
      if (row && rows.indexOf(row) === -1) rows.push(row);
    }
    return rows;
  }

  function renderSidebar() {
    var state = PR.state;
    var open = state.comments.filter(function (comment) { return comment.resolved !== true; });
    PR.setText(PR.els.commentCount, open.length);

    var labels = { APPROVE: "Approved", REQUEST_CHANGES: "Changes requested" };
    PR.setText(PR.els.reviewStateText, labels[PR.DATA.reviewState] || "Commented");
    PR.els.reviewStateDot.className = "dot " + (
      PR.DATA.reviewState === "APPROVE" ? "dot-approve" :
      PR.DATA.reviewState === "REQUEST_CHANGES" ? "dot-request" : "dot-comment"
    );

    if (!state.comments.length) {
      PR.setHtml(PR.els.commentList, '<div class="empty-state">No comments yet.</div>');
      return;
    }

    PR.setHtml(PR.els.commentList, state.comments.map(function (comment) {
      var range = comment.lineStart
        ? (comment.lineEnd && comment.lineEnd !== comment.lineStart
          ? comment.lineStart + "–" + comment.lineEnd
          : comment.lineStart)
        : "file";
      var resolved = comment.resolved === true;
      return '<button class="comment-summary-item js-goto-comment' + (resolved ? " is-resolved" : "") +
          '" data-path="' + PR.escapeHtml(comment.path) + '">' +
        '<span class="comment-summary-path">' + PR.escapeHtml(comment.path) + ":" + range +
          (resolved ? ' <span class="resolved-pill">✓</span>' : "") + "</span>" +
        '<span class="comment-summary-text">' + PR.escapeHtml(comment.body || "(image)") + "</span></button>";
    }).join(""));
  }

  /** --------------------------------- form --------------------------------- */
  PR.openCommentForm = function (path, side, lineStart, lineEnd, existing) {
    PR.closeCommentForms();

    var section = PR.findSection(path);
    if (!section) { PR.toast("Expand the file first", true); return; }

    var anchor = resolveAnchor(section, side, lineStart, lineEnd);
    if (!anchor) return;

    var rangeLabel = lineStart
      ? (lineEnd && lineEnd !== lineStart ? "lines " + lineStart + "–" + lineEnd : "line " + lineStart)
      : "file comment";

    var editor = buildEditor(rangeLabel, existing);
    mountEditor(anchor, editor.box, Boolean(lineStart));

    var images = existing && existing.images ? existing.images.slice() : [];
    var chips = editor.box.querySelector(".js-chips");

    function renderChips() {
      chips.innerHTML = images.map(function (image, index) {
        return attachmentChip(image, index, true);
      }).join("");
    }
    renderChips();

    chips.addEventListener("click", function (event) {
      var button = event.target.closest(".attach-remove");
      if (!button) return;
      images.splice(parseInt(button.dataset.i, 10), 1);
      renderChips();
    });

    bindImageInput(editor.textarea, editor.box, function (image) {
      images.push(image);
      renderChips();
    });

    editor.box.querySelector(".js-cancel").addEventListener("click", function () {
      PR.closeCommentForms();
      PR.clearSelection();
    });

    editor.box.querySelector(".js-save").addEventListener("click", function () {
      saveComment({ path: path, side: side, lineStart: lineStart, lineEnd: lineEnd, existing: existing, images: images, textarea: editor.textarea });
    });

    setTimeout(function () { editor.textarea.focus(); }, 0);
  };

  function resolveAnchor(section, side, lineStart, lineEnd) {
    if (!lineStart) return section.querySelector(".diff-file-header");

    var rows = rowsInRange(section, side, lineStart, lineEnd || lineStart);
    return rows.length ? rows[rows.length - 1] : null;
  }

  function buildEditor(rangeLabel, existing) {
    var box = document.createElement("div");
    box.className = "comment-box pending js-editor";
    box.innerHTML =
      '<div class="comment-head">' +
        '<span class="avatar">Y</span><strong>You</strong>' +
        '<span class="muted small">' + rangeLabel + "</span>" +
        '<span class="spacer"></span>' +
        '<button class="gh-btn gh-btn-sm ghost js-cancel">Cancel</button>' +
      "</div>" +
      '<div class="comment-form">' +
        '<div class="editor-wrap">' +
          '<div class="editor-attach js-chips"></div>' +
          '<textarea class="gh-textarea js-text" rows="4" placeholder="Leave a comment… (paste a screenshot with Ctrl+V)">' +
            (existing ? PR.escapeHtml(existing.body) : "") +
          "</textarea>" +
        "</div>" +
        '<div class="comment-form-actions">' +
          '<button class="gh-btn gh-btn-primary gh-btn-sm js-save">' + (existing ? "Update comment" : "Add comment") + "</button>" +
          '<span class="muted small">Ctrl+V / drag-drop for images</span>' +
        "</div>" +
      "</div>";

    return { box: box, textarea: box.querySelector(".js-text") };
  }

  function mountEditor(anchor, box, inline) {
    if (inline) {
      var row = document.createElement("tr");
      row.className = "comment-row js-editor-row";
      row.innerHTML = '<td colspan="' + columnCount(anchor) + '"></td>';
      row.firstChild.appendChild(box);
      anchor.parentNode.insertBefore(row, anchor.nextSibling);
      return;
    }

    var banner = document.createElement("div");
    banner.className = "file-comment-banner js-editor";
    banner.appendChild(box);
    anchor.parentNode.insertBefore(banner, anchor.nextSibling);
  }

  function bindImageInput(textarea, box, onImage) {
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

    textarea.addEventListener("dragover", function (event) { event.preventDefault(); box.classList.add("drop-active"); });
    textarea.addEventListener("dragleave", function () { box.classList.remove("drop-active"); });
    textarea.addEventListener("drop", function (event) {
      event.preventDefault();
      box.classList.remove("drop-active");
      addFiles(event.dataTransfer ? event.dataTransfer.files : []);
    });
  }

  function saveComment(options) {
    var body = options.textarea.value.trim();
    if (!body && options.images.length === 0) { PR.toast("Comment text or image required", true); return; }

    if (options.existing) {
      options.existing.body = body;
      options.existing.images = options.images;
    } else {
      PR.state.comments.push({
        id: "c" + PR.state.nextId,
        path: options.path,
        side: options.side || "right",
        lineStart: options.lineStart || 0,
        lineEnd: options.lineEnd || options.lineStart || 0,
        body: body,
        images: options.images,
        author: "You",
        createdAt: new Date().toISOString(),
      });
      PR.state.nextId += 1;
    }

    PR.rebuildCommentMap();
    PR.closeCommentForms();
    PR.clearSelection();
    PR.store();
    PR.renderComments();
    PR.renderSummary();
    PR.updateTreeFileRow(options.path);
    PR.toast("Comment saved");
  }

  PR.closeCommentForms = function () {
    // A form can live in the diff list or in the inline host (an unchanged file opened from the…
    var hosts = [PR.els.diffFiles, document.getElementById(PR.IDS.INLINE_HOST)];
    hosts.forEach(function (host) {
      if (!host) return;
      host.querySelectorAll(".js-editor").forEach(function (node) { node.remove(); });
    });
  };

  /** ------------------------------- selection ------------------------------ */
  PR.clearSelection = function () {
    document.querySelectorAll(".row-selected").forEach(function (row) { row.classList.remove("row-selected"); });
    PR.state.selection = null;
  };

  PR.selectRange = function (path, side, from, to) {
    PR.clearSelection();
    if (!from) return;

    var start = Math.min(from, to || from);
    var end = Math.max(from, to || from);
    PR.state.selection = { path: path, side: side, start: start, end: end };

    var section = PR.findSection(path);
    if (!section) return;
    rowsInRange(section, side, start, end).forEach(function (row) { row.classList.add("row-selected"); });
  };

  /** Selects every visual row between two rows (GitHub-style drag), then derives a line range on… */
  PR.selectRowRange = function (section, startRow, endRow, side) {
    PR.clearSelection();
    // Use every diff row; split rows have line numbers on the number cells rather than on the <tr>,…
    var rows = Array.from(section.querySelectorAll("tr")).filter(function (row) {
      return row.querySelector("td.diff-num");
    });
    var startIndex = rows.indexOf(startRow);
    var endIndex = rows.indexOf(endRow);
    if (startIndex === -1 || endIndex === -1) return;

    var from = Math.min(startIndex, endIndex);
    var to = Math.max(startIndex, endIndex);
    var selectedSide = side || startRow.dataset.side || PR.SIDE.RIGHT;
    var lines = [];

    for (var i = from; i <= to; i += 1) {
      rows[i].classList.add("row-selected");
      var cell = rows[i].querySelector('td.diff-num[data-side="' + selectedSide + '"]');
      var line = cell ? parseInt(cell.dataset.line, 10) : NaN;
      if (!isNaN(line)) lines.push(line);
    }

    if (!lines.length) return;

    PR.state.selection = {
      path: section.dataset.path,
      side: selectedSide,
      start: Math.min.apply(null, lines),
      end: Math.max.apply(null, lines),
    };
  };

  PR.deleteComment = function (id) {
    var comment = PR.state.comments.find(function (item) { return item.id === id; });
    PR.state.comments = PR.state.comments.filter(function (item) { return item.id !== id; });
    PR.rebuildCommentMap();
    PR.store();
    PR.renderComments();
    PR.renderSummary();
    if (comment) PR.updateTreeFileRow(comment.path);
    PR.toast("Comment deleted");
  };
})();
