
(function () {
  "use strict";

  var PR = window.PR;


  var DELAY_MS = 350;

  var OFFSET_PX = 8;

  var MARGIN_PX = 8;

  var GRACE_MS = 150;


  var TRIGGER = ".diff-file-header .path";
  var TIP_CLASS = "path-tip";

  var current = null;
  var hideTimer = null;
  var showTimer = null;


  function splitPath(path) {
    var at = path.lastIndexOf("/");
    if (at === -1) return { dir: "", name: path };
    return { dir: path.slice(0, at + 1), name: path.slice(at + 1) };
  }

  function build(path) {
    var parts = splitPath(path);
    var box = document.createElement("div");
    box.className = TIP_CLASS;

    var dir = document.createElement("span");
    dir.className = "path-tip-dir";
    dir.textContent = parts.dir;

    var name = document.createElement("span");
    name.className = "path-tip-name";
    name.textContent = parts.name;

    box.appendChild(dir);
    box.appendChild(name);
    return box;
  }


  function position(box, anchor) {
    var rect = anchor.getBoundingClientRect();
    var size = box.getBoundingClientRect();

    var below = rect.bottom + OFFSET_PX;
    var above = rect.top - size.height - OFFSET_PX;
    var top = below + size.height + MARGIN_PX <= window.innerHeight ? below : Math.max(MARGIN_PX, above);

    var left = Math.min(rect.left, window.innerWidth - size.width - MARGIN_PX);

    box.style.top = Math.round(top) + "px";
    box.style.left = Math.round(Math.max(MARGIN_PX, left)) + "px";
  }

  function hide() {
    clearTimeout(showTimer);
    showTimer = null;
    if (!current) return;
    current.remove();
    current = null;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, GRACE_MS);
  }

  function show(anchor) {
    hide();
    var path = anchor.getAttribute("data-full-path") || anchor.textContent.trim();
    if (!path) return;

    var box = build(path);
    document.body.appendChild(box);
    position(box, anchor);
    current = box;
  }

  document.addEventListener("mouseover", function (event) {
    var anchor = event.target.closest ? event.target.closest(TRIGGER) : null;
    if (!anchor) return;
    if (current && current.parentNode) return;


    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(function () { show(anchor); }, DELAY_MS);
  }, true);

  document.addEventListener("mouseout", function (event) {
    var anchor = event.target.closest ? event.target.closest(TRIGGER) : null;
    if (!anchor) return;
    scheduleHide();
  }, true);

  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);


  window.PR.PathTip = { show: show, hide: hide };
})();
