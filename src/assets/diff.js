
(function () {
  "use strict";

  var PR = window.PR;

  function statusLetter(status) { return PR.STATUS_LETTER[status] || ""; }

  PR.visibleFiles = function () {
    var state = PR.state;
    var query = state.filter.trim().toLowerCase();
    return state.files.filter(function (file) {
      if (state.settings.hideViewed && state.viewed.has(file.path)) return false;
      if (!query) return true;
      return file.path.toLowerCase().indexOf(query) !== -1;
    });
  };


  PR.renderFileList = function () {
    if (PR.state.view.kind !== PR.VIEW_KIND.REVIEW && !PR.state.view.kind) return;
    var files = PR.visibleFiles();

    if (!files.length) {
      PR.setHtml(PR.els.diffFiles, '<div class="empty-state" style="padding:24px">No files match.</div>');
      return;
    }

    PR.setHtml(PR.els.diffFiles, files.map(fileSection).join(""));

    if (PR.renderComments) PR.renderComments();
    PR.scheduleHydration(files);
  };


  PR.scheduleHydration = function (files) {
    var paths = files.map(function (file) { return file.path; });
    PR.prefetch(paths).then(function () { hydrateAll(paths); });
  };


  function hydrateAll(paths) {
    var index = 0;

    function step() {
      var end = Math.min(index + PR.UI.HYDRATION_CHUNK, paths.length);
      for (; index < end; index += 1) {
        var section = PR.els.diffFiles.querySelector('section[data-path="' + PR.cssEscape(paths[index]) + '"]');
        if (section) PR.hydrate(paths[index], section);
      }
      if (index < paths.length) setTimeout(step, PR.UI.HYDRATION_DELAY_MS);
    }

    step();
  }


  function fileMenu(file) {
    return '<a class="file-menu-item js-open-file" href="' + PR.fileUrl(file.path) + '" title="Open the file in a new tab">' +
        FILE_SVG + "<span>View file</span></a>" +
      '<button class="file-menu-item js-file-comment" title="Add a comment to this file">' +
        COMMENT_SVG + "<span>Add file comment</span></button>";
  }


  PR.refreshFileMenu = function (section) {
    if (!section) return;
    var file = PR.findFile(section.dataset.path);
    if (!file) return;

    var header = section.querySelector(".diff-file-header");
    if (!header) return;

    var menu = header.querySelector(".file-menu");
    if (!menu) {
      header.insertAdjacentHTML("beforeend",
        '<span class="file-menu" hidden>' +
          '<button class="icon-btn js-file-menu" aria-haspopup="true" aria-expanded="false" title="More actions" aria-label="More actions">' + MORE_SVG + "</button>" +
          '<div class="file-menu-pop" hidden></div>' +
        "</span>");
      menu = header.querySelector(".file-menu");
    }

    var pop = menu.querySelector(".file-menu-pop");
    if (!pop) return;

    var expandItem = hasCollapsedRegions(file)
      ? '<button class="file-menu-item js-expand-all" title="Show the whole file, including unchanged lines">' +
          EXPAND_SVG + "<span>Expand all</span></button>"
      : "";
    pop.innerHTML = expandItem + fileMenu(file);

    menu.hidden = false;
  };

  function hasCollapsedRegions(file) {
    if (!file || file.binary || !file.hunks || !file.hunks.length) return false;
    var gaps = gapsOf(file);
    for (var index = 0; index < gaps.length; index += 1) {
      if (isCollapsed(file, gaps[index])) return true;
    }
    return false;
  }

  function fileSection(file) {
    var state = PR.state;
    var isViewed = state.viewed.has(file.path);
    var expanded = !state.collapsed.has(file.path);
    var deferred = isDeferred(file) && !state.loaded.has(file.path);

    return (
      '<section class="diff-file' + (expanded ? "" : " collapsed") + (isViewed ? " is-viewed" : "") +
        (deferred ? " is-deferred" : "") +
        '" id="' + PR.anchorId(file.path) + '" data-path="' + PR.escapeHtml(file.path) + '">' +
        '<header class="diff-file-header">' +
          '<button class="chevron js-collapse" aria-label="Toggle" title="Collapse / expand">' + CHEVRON_SVG + "</button>" +
          '<span class="status-pill status-' + file.status + '">' + statusLetter(file.status) + "</span>" +
          '<span class="path-group">' +
            '<span class="path" data-full-path="' + PR.escapeHtml(file.path) + '">' + PR.escapeHtml(file.path) +
              (file.status === "renamed" ? ' <span class="muted small">' + PR.escapeHtml(file.oldPath) + "</span>" : "") +
            "</span>" +
            '<button class="icon-btn js-copy-path" data-path="' + PR.escapeHtml(file.path) +
              '" title="Copy file path" aria-label="Copy file path">' + COPY_SVG + "</button>" +
          "</span>" +
          '<span class="file-stats">' +
            '<span class="stat-add">+' + file.additions + "</span>" +
            '<span class="stat-del">-' + file.deletions + "</span>" +
            '<span class="diff-blocks">' + diffBlocks(file) + "</span>" +
          "</span>" +
          (deferred
            ? '<button class="gh-btn gh-btn-sm js-load-file" title="Large file: load it on demand">Load file</button>'
            : "") +
          '<label class="viewed-wrap' + (isViewed ? " checked" : "") + '" title="Mark as viewed">' +
            '<span class="viewed-box">' + CHECK_SVG + "</span><span>Viewed</span>" +
          "</label>" +


          (deferred ? "" : '<span class="file-menu" hidden>' +
            '<button class="icon-btn js-file-menu" aria-haspopup="true" aria-expanded="false" title="More actions" aria-label="More actions">' + MORE_SVG + "</button>" +
            '<div class="file-menu-pop" hidden></div>' +
          "</span>") +
        "</header>" +
        '<div class="diff-body">' +
          (deferred ? deferredPlaceholder(file) : bodyHtml(file)) +
        "</div>" +
      "</section>"
    );
  }


  function isDeferred(file) {
    var limit = PR.state.settings.largeFileLines;
    if (!limit || limit <= 0) return false;




    var changed = file.changeCount || 0;
    var total = file.totalLines || 0;
    return Math.max(changed, total) > limit;
  }


  function deferReason(file) {
    var total = file.totalLines || 0;
    if (total) return total + " lines in the file";
    return (file.changeCount || 0) + " changed lines";
  }

  function deferredPlaceholder(file) {
    return '<div class="deferred-note">' +
      '<div class="deferred-title">Large file</div>' +
      '<div class="deferred-text">' + deferReason(file) +
        ". Loaded on demand so the review stays fast.</div>" +
      '<button class="gh-btn gh-btn-primary gh-btn-sm js-load-file">Load file</button>' +
    "</div>";
  }

  var CHEVRON_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12.78 5.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.28a.75.75 0 0 1 1.06-1.06L8 8.94l3.72-3.72a.75.75 0 0 1 1.06 0Z"></path></svg>';
  var CHECK_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';
  var COMMENT_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>';
  var COPY_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Zm5-1.75C5 4.862 5.862 4 6.75 4h7.5C15.138 4 16 4.862 16 5.75v7.5c0 .888-.862 1.75-1.75 1.75h-7.5A1.75 1.75 0 0 1 5 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>';

  var MORE_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">' +
    '<circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/>' +
  "</svg>";

  var FILE_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor">' +
    '<path d="M3.75 1.5A1.75 1.75 0 0 0 2 3.25v9.5c0 .966.784 1.75 1.75 1.75h9.5A1.75 1.75 0 0 0 15 12.75v-6.5A1.75 1.75 0 0 0 13.25 4.5H8.06L6.4 2.83a1.5 1.5 0 0 0-1.06-.44Z"/>' +
  "</svg>";

  var EXPAND_SVG = '<svg class="hunk-expander-svg" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">' +
    '<path d="M8 0.9 11.6 4.9H9.5v2.2h-3V4.9H4.4Z"/>' +
    '<path d="M8 15.1 4.4 11.1h2.1V8.9h3v2.2h2.1Z"/>' +
  "</svg>";

  function diffBlocks(file) {
    var total = file.additions + file.deletions;
    if (!total) return "";

    var cells = PR.UI.DIFF_BLOCK_CELLS;
    var part = total / cells;
    var out = "";

    for (var i = 0; i < cells; i += 1) {
      var add = Math.max(0, Math.min(file.additions - i * part, part));
      var del = Math.max(0, Math.min(file.deletions - (total - (i + 1) * part), part));
      out += '<span class="blk ' + (add > del ? "b-add" : "b-del") + '"></span>';
    }
    return out;
  }


  function bodyHtml(file) {
    if (file.binary) return '<div class="diff-hunk-header">Binary file — not shown</div>';

    var gaps = gapsOf(file);
    var out = "";
    for (var index = 0; index < file.hunks.length; index += 1) {

      var above = findGap(gaps, index, PR.GAP.UP);
      if (above && isCollapsed(file, above)) out += expanderBlock(file.hunks[index], index, PR.GAP.UP);
      out += hunkBlock(file, file.hunks[index], index);
    }

    var lastIndex = file.hunks.length - 1;
    var below = findGap(gaps, lastIndex, PR.GAP.DOWN);
    if (below && isCollapsed(file, below)) out += expanderBlock(file.hunks[lastIndex], lastIndex, PR.GAP.DOWN);
    return out;
  }


  function gapsOf(file) {
    if (file.gaps && file.gaps.length) return file.gaps;
    return fallbackGaps(file);
  }


  function findGap(gaps, hunkIndex, dir) {
    if (hunkIndex < 0) return null;
    for (var i = 0; i < gaps.length; i++) {
      if (gaps[i].hunk === hunkIndex && gaps[i].dir === dir) return gaps[i];
    }
    return null;
  }


  function fallbackGaps(file) {
    var hunks = file.hunks || [];
    var gaps = [];

    for (var index = 0; index < hunks.length; index += 1) {
      var hunk = hunks[index];
      var previous = hunks[index - 1];
      var start = index === 0 ? 1 : previous.newStart + previous.newLines;
      var end = hunk.newStart - 1;
      if (end < start) continue;

      var shift = hunk.newStart - hunk.oldStart;
      gaps.push({
        hunk: index,
        dir: PR.GAP.UP,
        newStart: start,
        newEnd: end,
        oldStart: start - shift,
        oldEnd: end - shift,
        count: end - start + 1,
        nonEmpty: end - start + 1,
      });
    }

    return gaps;
  }


  function isCollapsed(file, gap) {
    var limit = PR.state.settings.contextCollapseLines;
    if (!limit || limit <= PR.CONTEXT.NEVER_COLLAPSE) return false;
    if (isExpanded(file, gap)) return false;

    var nonEmpty = typeof gap.nonEmpty === "number" ? gap.nonEmpty : gap.count;
    return nonEmpty > limit;
  }


  function isExpanded(file, gap) {
    return PR.state.expandedGaps.has(gapKey(file.path, gap));
  }

  function gapKey(path, gap) {
    return path + "|" + gap.hunk + "|" + gap.dir;
  }


  function gapDomKey(gap) {
    return "gap" + gap.hunk + gap.dir;
  }

  function isOpenInSection(section, gap) {
    return section.dataset[gapDomKey(gap)] === "1";
  }



  function isAllAdditions(hunk) {
    return hunk.rows.length > 0 && hunk.rows.every(function (row) { return row.kind === "add"; });
  }

  function expanderBlock(hunk, hunkIndex, direction) {
    var columns = tableColumns(hunk);




    var simple = hasNoOldSide(hunk);
    var target = simple || !isSplit() ? 3 : 2;
    var rest = columns.count - target;

    return '<div class="hunk-expander" data-hunk="' + hunkIndex + '" data-dir="' + direction + '">' +
      '<table class="diff-expander-table"><colgroup>' + columns.html + "</colgroup><tbody><tr>" +
        '<td class="expander-cell" colspan="' + target + '">' +
          '<button class="hunk-expander-btn js-expand" data-dir="' + direction + '" title="' +
            (direction === PR.DIRECTION.UP ? "Show code above this change" : "Show code below this change") + '">' +
            EXPAND_SVG +
          "</button>" +
        "</td>" +
        (rest > 0 ? '<td class="expander-rest" colspan="' + rest + '"></td>' : "") +
      "</tr></tbody></table>" +
    "</div>";
  }

  function hunkBlock(file, hunk, index) {
    return (
      '<div class="diff-hunk" data-hunk="' + index + '">' +
        '<div class="hunk-body">' +
          (PR.state.diffMode === PR.DIFF_MODE.SPLIT ? splitTable(file, hunk) : unifiedTable(file, hunk)) +
        "</div>" +
      "</div>"
    );
  }


  function hasNoOldSide(hunk) {
    for (var i = 0; i < hunk.rows.length; i += 1) {
      if (hunk.rows[i].kind === "del" || hunk.rows[i].kind === "ctx") return false;
    }
    return hunk.rows.length > 0;
  }


  function isSplit() {
    return PR.state.diffMode === PR.DIFF_MODE.SPLIT;
  }


  function tableColumns(hunk) {
    var simple = hasNoOldSide(hunk);
    if (simple) {

      return { html: '<col class="c-gutter"><col class="c-num"><col>', count: 3 };
    }
    if (isSplit()) {
      return {
        html: '<col class="c-gutter"><col class="c-num"><col>' +
              '<col class="c-gutter"><col class="c-num"><col>',
        count: 6,
      };
    }
    return { html: '<col class="c-gutter"><col class="c-num"><col class="c-num"><col>', count: 4 };
  }

  function unifiedTable(file, hunk) {
    var marks = wordMarks(hunk.rows);
    var simple = hasNoOldSide(hunk);
    var columns = tableColumns(hunk);
    var rows = hunk.rows.map(function (row, index) {
      return rowHtml(file, row, marks[index], simple);
    }).join("");

    return '<table class="diff-table' + (simple ? " no-old-side" : "") +
      '"><colgroup>' + columns.html + '</colgroup><tbody>' + rows + "</tbody></table>";
  }

  function splitTable(file, hunk) {
    var pairs = splitPairs(hunk.rows);
    var simple = hasNoOldSide(hunk);
    var columns = tableColumns(hunk);
    return '<table class="diff-table split' + (simple ? " no-old-side" : "") +
      '"><colgroup>' + columns.html + '</colgroup><tbody>' +
      pairs.map(function (pair) { return splitRowHtml(pair, simple); }).join("") + "</tbody></table>";
  }


  function splitPairs(rows) {
    var pairs = [];
    var i = 0;
    while (i < rows.length) {
      var row = rows[i];
      if (row.kind === "ctx") { pairs.push([row, row]); i += 1; continue; }

      if (row.kind !== "del" && row.kind !== "add") {
        pairs.push([row, null]);
        i += 1;
        continue;
      }

      var dels = [];
      var adds = [];
      while (i < rows.length && rows[i].kind === "del") { dels.push(rows[i]); i += 1; }
      while (i < rows.length && rows[i].kind === "add") { adds.push(rows[i]); i += 1; }

      var count = Math.max(dels.length, adds.length);
      for (var k = 0; k < count; k += 1) pairs.push([dels[k] || null, adds[k] || null]);
    }
    return pairs;
  }

  function splitRowHtml(pair, simple) {
    var left = pair[0];
    var right = pair[1];
    var leftNum = left && left.oldLine ? left.oldLine : "";
    var rightNum = right && right.newLine ? right.newLine : "";
    var marks = pairMarks(left, right);

    var leftPart = simple ? "" :
      gutterCell("left", leftNum, left) +
      '<td class="diff-num cell-' + (left ? left.kind : "empty") + '" data-side="left" data-line="' + leftNum + '">' + leftNum + "</td>" +
      codeCell(left, "left", leftNum, "", marks.left);

    return '<tr class="split-row">' + leftPart +
      gutterCell("right", rightNum, right) +
      '<td class="diff-num cell-' + (right ? right.kind : "empty") + '" data-side="right" data-line="' + rightNum + '">' + rightNum + "</td>" +
      codeCell(right, "right", "", rightNum, marks.right) +
    "</tr>";
  }

  function rowHtml(file, row, marks, simple) {
    var side = row.kind === "del" ? "left" : "right";
    var num = row.kind === "del" ? row.oldLine : row.newLine;

    return '<tr class="row-' + row.kind + '" data-side="' + side + '" data-line="' + (num || "") + '" data-kind="' + row.kind + '">' +
      gutterCell(side, num, row) +
      (simple ? "" :
        '<td class="diff-num" data-side="left" data-line="' + (row.oldLine || "") + '">' + (row.oldLine || "") + "</td>") +
      '<td class="diff-num" data-side="right" data-line="' + (row.newLine || "") + '">' + (row.newLine || "") + "</td>" +
      codeCell(row, "unified", row.oldLine || "", row.newLine || "", marks) +
    "</tr>";
  }

  function gutterCell(side, line, row) {
    var kindClass = row ? " gutter-" + row.kind : "";
    if (!line) return '<td class="diff-gutter' + kindClass + '"></td>';

    var kind = row ? row.kind : "ctx";
    var sign = kind === "add" ? "+" : kind === "del" ? "−" : "";
    var signClass = kind === "add" ? " gutter-sign-add" : kind === "del" ? " gutter-sign-del" : "";

    return '<td class="diff-gutter' + kindClass + signClass + '">' +
      '<span class="gutter-sign">' + sign + "</span>" +
      '<button class="line-plus js-comment" data-side="' + side +
      '" data-line="' + line + '" title="Add a comment on this line">+</button></td>';
  }

  function codeCell(row, mode, oldLine, newLine, marks) {
    var content = row && row.content !== undefined ? row.content : "";
    var kind = row ? row.kind : "ctx";
    var markAttrs = marks
      ? ' data-wm-start="' + marks.start + '" data-wm-end="' + marks.end + '"'
      : "";
    return '<td class="diff-code cell-' + kind + '" data-old="' + oldLine + '" data-new="' + newLine +
      '" data-kind="' + (mode === PR.DIFF_MODE.SPLIT ? mode : kind) + '"' + markAttrs + ">" +
      PR.escapeHtml(content) + "</td>";
  }



  function wordMarks(rows) {
    var marks = {};
    var i = 0;

    while (i < rows.length) {
      if (rows[i].kind !== "del" && rows[i].kind !== "add") { i += 1; continue; }

      var start = i;
      while (i < rows.length && (rows[i].kind === "del" || rows[i].kind === "add")) i += 1;
      var block = rows.slice(start, i);
      var dels = block.filter(function (row) { return row.kind === "del"; });
      var adds = block.filter(function (row) { return row.kind === "add"; });

      var count = Math.min(dels.length, adds.length);
      for (var k = 0; k < count; k += 1) {
        var pair = pairMarks(dels[k], adds[k]);
        marks[start + k] = pair.left;
        marks[start + dels.length + k] = pair.right;
      }
    }

    return marks;
  }


  function pairMarks(left, right) {
    if (!left || !right) return { left: null, right: null };
    if (left.kind !== "del" || right.kind !== "add") return { left: null, right: null };

    var a = left.content;
    var b = right.content;
    var prefix = commonPrefix(a, b);
    var suffix = commonSuffix(a, b, prefix);
    var aEnd = a.length - suffix;
    var bEnd = b.length - suffix;

    if (aEnd <= prefix && bEnd <= prefix) return { left: null, right: null };

    return {
      left: prefix < aEnd ? { start: prefix, end: aEnd } : null,
      right: prefix < bEnd ? { start: prefix, end: bEnd } : null,
    };
  }

  function commonPrefix(a, b) {
    var max = Math.min(a.length, b.length);
    var i = 0;
    while (i < max && a.charAt(i) === b.charAt(i)) i += 1;
    return i;
  }

  function commonSuffix(a, b, prefix) {
    var max = Math.min(a.length, b.length) - prefix;
    var i = 0;
    while (i < max && a.charAt(a.length - 1 - i) === b.charAt(b.length - 1 - i)) i += 1;
    return i;
  }


  PR.contextRow = function (oldLine, newLine, content, simple) {
    return '<tr class="row-ctx" data-side="right" data-line="' + newLine + '" data-kind="ctx">' +
      gutterCell("right", newLine) +
      (simple ? "" :
        '<td class="diff-num" data-side="left" data-line="' + oldLine + '">' + oldLine + "</td>") +
      '<td class="diff-num" data-side="right" data-line="' + newLine + '">' + newLine + "</td>" +
      '<td class="diff-code" data-old="' + (simple ? "" : oldLine) + '" data-new="' + newLine +
        '" data-kind="ctx">' + PR.escapeHtml(content) + "</td></tr>";
  };


  function splitContextRow(oldLine, newLine, content, simple) {
    var code = PR.escapeHtml(content);
    var left = simple ? "" :
      gutterCell("left", oldLine, null) +
      '<td class="diff-num cell-ctx" data-side="left" data-line="' + oldLine + '">' + oldLine + "</td>" +
      '<td class="diff-code cell-ctx" data-old="' + oldLine + '" data-new="" data-kind="ctx">' + code + "</td>";

    return '<tr class="row-ctx split-row" data-side="right" data-line="' + newLine + '" data-kind="ctx">' +
      left +
      gutterCell("right", newLine, null) +
      '<td class="diff-num cell-ctx" data-side="right" data-line="' + newLine + '">' + newLine + "</td>" +
      '<td class="diff-code cell-ctx" data-old="' + (simple ? "" : oldLine) + '" data-new="' + newLine +
        '" data-kind="ctx">' + code + "</td></tr>";
  }


  function contextRowHtml(oldLine, newLine, content, simple) {
    return isSplit()
      ? splitContextRow(oldLine, newLine, content, simple)
      : PR.contextRow(oldLine, newLine, content, simple);
  }



  PR.hydrate = function (path, section) {
    var target = section || PR.els.diffFiles.querySelector('section[data-path="' + PR.cssEscape(path) + '"]');
    if (!target || target.dataset.hydrated === "1") return;

    return PR.getFileData(path).then(function (data) {
      if (!data) return;


      try {
        PR.highlightIn(target, path, data.language);
      } catch (error) {
        target.dataset.highlightFailed = "1";
      }

      PR.applyContextPolicy(target).then(function () {

        PR.refreshFileMenu(target);
      });
      target.dataset.hydrated = "1";
    });
  };


  PR.prefetch = function (paths) {
    var missing = paths.filter(function (path) { return !PR.state.cache[path]; });
    if (!missing.length) return Promise.resolve();

    return fetch(PR.API.FILES, {
      method: PR.HTTP.POST,
      headers: { "content-type": PR.HTTP.JSON },
      body: JSON.stringify({ paths: missing }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.files) return;
        Object.keys(res.files).forEach(function (path) {
          var data = res.files[path];
          if (!data || !data.lines) return;
          PR.state.cache[path] = data;
          PR.state.highlightCache[path] = PR.highlightLines(data.lines.join("\n"), data.language);
        });
      })
      .catch(function () {});
  };



  PR.expandGap = function (section, gap, silent) {
    var file = PR.findFile(section.dataset.path);
    if (!file || !gap) return Promise.resolve();

    if (isOpenInSection(section, gap)) return Promise.resolve();
    section.dataset[gapDomKey(gap)] = "1";

    return PR.getFileData(file.path).then(function (data) {
      var target = section.querySelector('.diff-hunk[data-hunk="' + gap.hunk + '"]');
      var tbody = target ? target.querySelector("tbody") : null;

      if (!data || !data.lines || !tbody) {
        delete section.dataset[gapDomKey(gap)];
        if (!silent) PR.toast(PR.MESSAGES.NO_CONTENT, true);
        return;
      }

      var rows = gapRows(gap, data.lines, file);
      if (!rows) {
        delete section.dataset[gapDomKey(gap)];
        if (!silent) PR.toast(PR.MESSAGES.NO_CONTENT, true);
        return;
      }

      if (gap.dir === PR.GAP.UP) tbody.insertAdjacentHTML("afterbegin", rows);
      else tbody.insertAdjacentHTML("beforeend", rows);

      hideExpander(section, gap.hunk, gap.dir);
      PR.highlightIn(target, file.path, data.language);
    });
  };


  function gapRows(gap, lines, file) {
    var shift = gap.newStart - gap.oldStart;
    var hunk = file.hunks ? file.hunks[gap.hunk] : null;
    var simple = hunk ? hasNoOldSide(hunk) : false;
    var html = "";

    for (var line = gap.newStart; line <= gap.newEnd; line += 1) {
      var content = lines[line - 1];
      if (content === undefined) continue;
      html += contextRowHtml(line - shift, line, content, simple);
    }

    return html;
  }


  PR.expandHunk = function (section, hunkIndex, direction, silent) {
    var file = PR.findFile(section.dataset.path);
    if (!file) return;

    var gap = findGap(gapsOf(file), hunkIndex, direction);
    if (!gap) {
      if (!silent) PR.toast(direction === PR.DIRECTION.UP ? PR.MESSAGES.TOP : PR.MESSAGES.BOTTOM, false);
      return;
    }

    PR.state.expandedGaps.add(gapKey(file.path, gap));
    PR.expandGap(section, gap, silent);
  };


  PR.expandAll = function (section) {
    var file = PR.findFile(section.dataset.path);
    if (!file || !file.hunks) return;
    if (file.binary) { PR.toast(PR.MESSAGES.NO_CONTENT, true); return; }

    var gaps = gapsOf(file);
    for (var index = 0; index < gaps.length; index += 1) {
      PR.state.expandedGaps.add(gapKey(file.path, gaps[index]));
      PR.expandGap(section, gaps[index], true);
    }

    Promise.resolve().then(function () { PR.refreshFileMenu(section); });
  };


  PR.applyContextPolicy = function (section) {
    var file = PR.findFile(section.dataset.path);
    if (!file) return Promise.resolve();

    var gaps = gapsOf(file);
    var pending = [];
    for (var index = 0; index < gaps.length; index += 1) {
      if (!isCollapsed(file, gaps[index])) pending.push(PR.expandGap(section, gaps[index], true));
    }
    return Promise.all(pending);
  };


  function hideExpander(section, hunkIndex, direction) {
    var bar = section.querySelector('.hunk-expander[data-hunk="' + hunkIndex + '"][data-dir="' + direction + '"]');
    if (bar) bar.remove();
  }



  PR.toggleCollapse = function (section) {
    PR.perf("Collapse", function () {
      var path = section.dataset.path;
      var isCollapsed = section.classList.toggle(PR.SELECTORS.COLLAPSED);

      if (isCollapsed) PR.state.collapsed.add(path);
      else PR.state.collapsed.delete(path);

      PR.store();
    });
  };

  PR.bodyHtml = bodyHtml;
})();
