// Riquadro errori visibile in fondo allo schermo. Caricato prima di app.js,
// così mostra anche gli errori che impediscono all'app di partire.
(function () {
  "use strict";
  var box = null, list = null, seen = {};
  function ensure() {
    if (box) return;
    box = document.createElement("div");
    box.id = "errbox"; box.setAttribute("role", "alert");
    var head = document.createElement("div"); head.className = "errhead";
    var t = document.createElement("strong"); t.textContent = "Qualcosa non ha funzionato";
    var x = document.createElement("button"); x.type = "button"; x.textContent = "Chiudi";
    x.onclick = function () { box.hidden = true; };
    head.appendChild(t); head.appendChild(x);
    var hint = document.createElement("span");
    hint.textContent = "Fai uno screenshot di questo riquadro e mandalo a chi ti aiuta.";
    list = document.createElement("ul");
    box.appendChild(head); box.appendChild(hint); box.appendChild(list);
    (document.body || document.documentElement).appendChild(box);
  }
  function report(msg, err) {
    try {
      var text = String(msg || "Errore sconosciuto");
      if (err && err.stack) {
        var where = String(err.stack).split("\n").filter(function (l) { return /\.js/.test(l); })[0];
        if (where) text += "\n" + where.trim().replace(/^at\s+/, "").replace(/https?:\/\/[^/]+\//, "");
      }
      if (seen[text]) return; seen[text] = 1;
      ensure();
      var li = document.createElement("li"); li.textContent = text; list.appendChild(li);
      box.hidden = false;
    } catch (_) {}
  }
  window.apReportError = report;
  window.addEventListener("error", function (e) {
    if (e.target && e.target !== window && (e.target.src || e.target.href)) return; // risorse (es. font offline)
    var where = e.filename ? " (" + String(e.filename).split("/").pop() + ":" + e.lineno + ")" : "";
    report((e.message || "Errore") + where, e.error);
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    report("Promessa non gestita: " + (r && r.message ? r.message : String(r)), r);
  });
})();
