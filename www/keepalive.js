// Lavoro in sottofondo: finché c'è una chiamata a Claude o OpenAI in corso, il plugin nativo KeepAlive
// accende un servizio con notifica, così chiudere l'app o cambiare app non blocca più nulla.
// Si spegne 10 secondi dopo l'ultima chiamata (le pause tra un passo e l'altro non lo spengono).
(function () {
  "use strict";
  const P = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KeepAlive) || null;
  let n = 0, on = false, offT = 0, label = "";
  const AI = /api\.anthropic\.com|api\.openai\.com/;

  function text() { return label || (n > 1 ? "Sto preparando " + n + " lavori…" : "Sto preparando foto e descrizione…"); }
  function up() {
    clearTimeout(offT);
    const p = P(); if (!p) return;
    if (!on) { on = true; p.start({ text: text() }).catch(() => { on = false; }); }
  }
  function down() {
    clearTimeout(offT);
    offT = setTimeout(() => { if (n > 0 || !on) return; const p = P(); on = false; if (p) p.stop().catch(() => {}); }, 10000);
  }
  const begin = () => { n++; up(); }, end = () => { n = Math.max(0, n - 1); if (!n) down(); };

  const orig = window.fetch && window.fetch.bind(window);
  if (orig) window.fetch = function (input, init) {
    const u = typeof input === "string" ? input : (input && input.url) || "";
    if (!AI.test(u)) return orig(input, init);
    begin();
    return orig(input, init).finally(end);
  };

  // permesso notifiche chiesto subito, con l'app aperta (in sottofondo Android non può mostrare la richiesta)
  setTimeout(() => { const p = P(); if (p && p.requestPermissions) p.requestPermissions().catch(() => {}); }, 2500);

  /** Aspetta che l'app torni aperta e la rete ci sia (per riprovare dopo una connessione interrotta). */
  function whenBack() {
    return new Promise(res => {
      const ok = () => !document.hidden && navigator.onLine !== false;
      if (ok()) return setTimeout(res, 1500);
      const h = () => { if (ok()) { document.removeEventListener("visibilitychange", h); window.removeEventListener("online", h); setTimeout(res, 1500); } };
      document.addEventListener("visibilitychange", h); window.addEventListener("online", h);
    });
  }

  // per lavori lunghi senza rete (es. elaborazione foto): LLKeep.run(promessa)
  window.LLKeep = { begin, end, whenBack, setLabel(t) { label = t || ""; }, run(p) { begin(); return Promise.resolve(p).finally(end); }, get busy() { return n > 0; } };
})();
