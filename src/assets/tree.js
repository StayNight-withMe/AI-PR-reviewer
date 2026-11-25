
(function () {
  "use strict";

  var PR = window.PR;

  var STATUS_LETTER = PR.STATUS_LETTER;


  var SVG_OPEN = '<svg class="tree-svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false">';
  var SVG_CLOSE = "</svg>";

  var DOC_PATH = "M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z";
  var FOLDER_PATH = "M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1Z";
  var CHEVRON_PATH = "M12.78 5.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.28a.75.75 0 0 1 1.06-1.06L8 8.94l3.72-3.72a.75.75 0 0 1 1.06 0Z";

  function chevronIcon() {
    return SVG_OPEN + '<path class="tree-chevron-path" fill="currentColor" d="' + CHEVRON_PATH + '"/>' + SVG_CLOSE;
  }

  function folderIcon() {
    return SVG_OPEN + '<path class="tree-folder-path" d="' + FOLDER_PATH + '"/>' + SVG_CLOSE;
  }

  function fileIcon() {
    return SVG_OPEN + '<path class="tree-doc-path" fill-rule="evenodd" d="' + DOC_PATH + '"/>' + SVG_CLOSE;
  }

  function buildNodes(items) {
    var root = {};
    items.forEach(function (item) {
      var parts = item.path.split("/");
      var node = root;
      for (var i = 0; i < parts.length; i += 1) {
        var name = parts[i];
        var isFile = i === parts.length - 1;
        if (!node[name]) {
          node[name] = { children: {}, status: isFile ? item.status : "unchanged", path: isFile ? item.path : null };
        }
        node = node[name].children;
      }
    });
    return root;
  }

  function statusOf(path) { return PR.state.changedMap[path] || "unchanged"; }


  function indent(depth) {
    var html = "";
    for (var i = 0; i < depth; i += 1) html += '<span class="tree-indent"></span>';
    return html;
  }

  PR.renderTree = function () {
    var state = PR.state;
    var query = state.treeFilter.trim().toLowerCase();
    var nodes = buildNodes(state.allFiles);





    if (!PR.els.tree.querySelector(".tree-head")) {
      PR.setHtml(PR.els.tree,
        '<div class="tree-head">' +
          '<input class="gh-input tree-search" id="tree-filter-input" placeholder="Find file…" autocomplete="off">' +
          '<button class="gh-btn gh-btn-sm js-tree-toggle" title="Expand / collapse all">⇕</button>' +
        "</div>" +
        '<div class="tree-body"></div>');
    }

    var field = PR.els.tree.querySelector("#tree-filter-input");
    if (field && field.value !== state.treeFilter) field.value = state.treeFilter;

    PR.setHtml(PR.els.tree.querySelector(".tree-body"), renderNode(nodes, 0, "", query));
    expandChangedPaths();
  };

  function renderNode(node, depth, prefix, query) {
    var names = Object.keys(node).sort(function (a, b) {
      var aDir = Object.keys(node[a].children).length > 0;
      var bDir = Object.keys(node[b].children).length > 0;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });

    var html = "";
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      var child = node[name];
      var path = child.path || (prefix ? prefix + "/" + name : name);
      var isDir = Object.keys(child.children).length > 0;

      if (query && !matches(child, path, query, isDir)) continue;

      html += isDir ? renderDir(name, path, child, depth, query, !!query) : renderFile(name, path, child, depth);
    }
    return html;
  }

  function matches(child, path, query, isDir) {
    if (path.toLowerCase().indexOf(query) !== -1) return true;
    return isDir && subtreeMatches(child, path, query);
  }

  function subtreeMatches(child, path, query) {
    var names = Object.keys(child.children);
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      var kid = child.children[name];
      var kidPath = kid.path || path + "/" + name;
      if (kidPath.toLowerCase().indexOf(query) !== -1) return true;
      if (Object.keys(kid.children).length && subtreeMatches(kid, kidPath, query)) return true;
    }
    return false;
  }

  function renderDir(name, path, child, depth, query, expanded) {
    // A search hides everything that does not match, so a matching folder is
    // opened: the file the person searched for must be visible, not one
    // expansion away.
    var open = expanded === true;
    return '<div class="tree-node" data-path="' + PR.escapeHtml(path) + '">' +
      '<div class="tree-row dir" data-path="' + PR.escapeHtml(path) + '" data-dir="true">' +
        indent(depth) +
        '<span class="tree-chevron' + (open ? "" : " collapsed") + '">' + chevronIcon() + "</span>" +
        '<span class="tree-icon folder">' + folderIcon() + "</span>" +
        '<span class="tree-label">' + PR.escapeHtml(name) + "</span>" +
      "</div>" +
      '<div class="tree-children' + (open ? "" : " hidden") + '">' + renderNode(child.children, depth + 1, path, query) + "</div>" +
    "</div>";
  }

  function renderFile(name, path, child, depth) {
    var status = statusOf(path);
    var isViewed = PR.state.viewed.has(path);
    var comments = PR.state.commentMap[path] || 0;
    var letter = STATUS_LETTER[status] || "";

    return '<div class="tree-node" data-path="' + PR.escapeHtml(path) + '">' +
      '<a class="tree-row file status-' + status + (isViewed ? " is-viewed" : "") + '"' +
        ' href="' + PR.fileUrl(path) + '" data-path="' + PR.escapeHtml(path) + '" data-dir="false"' +
        ' title="' + PR.escapeHtml(path) + '">' +
        indent(depth) +
        '<span class="tree-chevron leaf"></span>' +
        '<span class="tree-icon">' + fileIcon() + "</span>" +
        '<span class="tree-label">' + PR.escapeHtml(name) + "</span>" +
        (comments ? '<span class="tree-comment-count">' + comments + "</span>" : "") +
        '<span class="tree-status">' + letter + "</span>" +
      "</a></div>";
  }


  function expandChangedPaths() {
    var seen = {};
    PR.state.files.forEach(function (file) {
      var parts = file.path.split("/");
      var prefix = "";
      for (var i = 0; i < parts.length - 1; i += 1) {
        prefix = prefix ? prefix + "/" + parts[i] : parts[i];
        if (seen[prefix]) continue;
        seen[prefix] = true;

        var row = PR.els.tree.querySelector('.tree-row[data-path="' + PR.cssEscape(prefix) + '"][data-dir="true"]');
        if (!row) continue;
        var wrap = row.closest(".tree-node").querySelector(".tree-children");
        if (wrap && wrap.classList.contains(PR.SELECTORS.HIDDEN)) {
          wrap.classList.remove(PR.SELECTORS.HIDDEN);
          row.querySelector(".tree-chevron").classList.remove("collapsed");
        }
      }
    });
  }


  PR.updateTreeFileRow = function (path) {
    var row = PR.els.tree.querySelector('.tree-row[data-path="' + PR.cssEscape(path) + '"][data-dir="false"]');
    if (!row) return;

    row.classList.toggle("is-viewed", PR.state.viewed.has(path));

    var count = PR.state.commentMap[path] || 0;
    var badge = row.querySelector(".tree-comment-count");
    if (count && !badge) {
      badge = document.createElement("span");
      badge.className = "tree-comment-count";
      row.insertBefore(badge, row.querySelector(".tree-status"));
    }
    if (badge) {
      badge.textContent = count;
      badge.style.display = count ? "" : "none";
    }
  };


  PR.setActiveTreeFile = function (path) {
    var rows = PR.els.tree.querySelectorAll(PR.SELECTORS.TREE_ROW + ".is-active");
    for (var i = 0; i < rows.length; i += 1) rows[i].classList.remove("is-active");

    if (!path) return;
    var row = findTreeRow(path);

    if (!row || !isTreeRowVisible(row)) {
      PR.revealTreePath(path);
      row = findTreeRow(path);
    }
    if (!row) return;

    row.classList.add("is-active");
    if (PR.state.settings.autoScrollTree) scrollTreeTo(row);
  };

  function findTreeRow(path) {
    return PR.els.tree.querySelector(
      '.tree-row[data-dir="false"][data-path="' + PR.cssEscape(path) + '"]'
    );
  }


  function isTreeRowVisible(row) {
    var node = row.parentElement;
    while (node && node !== PR.els.tree) {
      if (node.classList.contains("hidden")) return false;
      node = node.parentElement;
    }
    return true;
  }


  PR.revealTreePath = function (path) {
    var parts = path.split("/");
    var prefix = "";

    for (var i = 0; i < parts.length - 1; i += 1) {
      prefix = prefix ? prefix + "/" + parts[i] : parts[i];
      var dirRow = PR.els.tree.querySelector(
        '.tree-row[data-dir="true"][data-path="' + PR.cssEscape(prefix) + '"]'
      );
      if (!dirRow) continue;

      var wrap = dirRow.closest(".tree-node").querySelector(PR.SELECTORS.TREE_CHILDREN);
      if (wrap && wrap.classList.contains(PR.SELECTORS.HIDDEN)) {
        wrap.classList.remove(PR.SELECTORS.HIDDEN);
        var chevron = dirRow.querySelector(PR.SELECTORS.TREE_CHEVRON);
        if (chevron) chevron.classList.remove("collapsed");
      }
    }
  };


  function scrollTreeTo(row) {
    var pane = PR.els.tree;
    var paneRect = pane.getBoundingClientRect();
    var rowRect = row.getBoundingClientRect();

    if (rowRect.top >= paneRect.top && rowRect.bottom <= paneRect.bottom) return;

    var delta = rowRect.top - paneRect.top - (pane.clientHeight - rowRect.height) / 2;
    pane.scrollTo({ top: Math.max(0, pane.scrollTop + delta), behavior: "smooth" });
  }


  PR.pinActiveTreeFile = function (path) {
    PR.state.spySuppressed = true;
    PR.state.activePinnedPath = path;
    PR.setActiveTreeFile(path);
  };


  PR.releaseTreePin = function () {
    PR.state.spySuppressed = false;
  };


  PR.pressFeedback = function (element) {
    if (!element || !element.classList) return;
    element.classList.remove("is-pressing");

    void element.offsetWidth;
    element.classList.add("is-pressing");
    setTimeout(function () { element.classList.remove("is-pressing"); }, 220);
  };

  PR.toggleTreeAll = function () {
    var bodies = PR.els.tree.querySelectorAll(".tree-children");
    var anyHidden = Array.from(bodies).some(function (b) { return b.classList.contains("hidden"); });

    bodies.forEach(function (body) {
      body.classList.toggle("hidden", !anyHidden);
      var chevron = body.parentNode.querySelector(".tree-row.dir .tree-chevron");
      if (chevron) chevron.classList.toggle("collapsed", !anyHidden);
    });
  };
})();
