// Scheda «Magazzino»: gli articoli salvati (ex storico «Annunci creati»).
// Ogni articolo: testo dell'annuncio (o "solo foto"), miniatura, stato (da pubblicare / pubblicato /
// venduto) e le foto finali in ordine, così si può riaprire in «Carica».
// Dati: localStorage "ap_history" (stesso formato di prima + status, photosOnly, details, photos);
// foto: IndexedDB "listlab-stock" (separato da "listlab", che il servizio guidato svuota).
// app.js lo crea con createStock(api).
(function () {
  "use strict";

  const KEY = "ap_history", MAX = 60;
  const STATES = [
    { id: "todo", label: "Da pubblicare" },
    { id: "live", label: "Pubblicato" },
    { id: "sold", label: "Venduto" }
  ];

  // ---------- foto (IndexedDB) ----------
  const DB = (() => {
    let p = null;
    const open = () => p || (p = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("no idb"));
      const r = indexedDB.open("listlab-stock", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("photos");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("photos", mode); const q = fn(t.objectStore("photos")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
    return {
      put: (k, v) => tx("readwrite", st => st.put(v, k)),
      get: k => tx("readonly", st => st.get(k)).catch(() => null),
      del: k => tx("readwrite", st => st.delete(k)).catch(() => {})
    };
  })();

  window.createStock = function createStock(api) {
    const $ = id => document.getElementById(id);
    let filter = "all", openId = null;

    // ---------- dati ----------
    function load() {
      let a = [];
      try { a = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (_) {}
      if (!Array.isArray(a)) return [];
      // articoli salvati prima del Magazzino: «da pubblicare»
      return a.map(e => Object.assign({ status: "todo", photosOnly: false, photos: 0 }, e));
    }
    function write(list) {
      // se lo spazio finisce si tolgono i più vecchi (e le loro foto) finché ci sta
      let l = list.slice(0, MAX);
      for (;;) {
        try { localStorage.setItem(KEY, JSON.stringify(l)); break; }
        catch (_) { if (!l.length) break; const gone = l[l.length - 1]; dropPhotos(gone); l = l.slice(0, -1); }
      }
      list.slice(MAX).forEach(dropPhotos);
    }
    function dropPhotos(e) { for (let i = 0; i < (e.photos || 0); i++) DB.del(e.id + ":" + i); }
    const get = id => load().find(e => e.id === id) || null;

    /** Crea o aggiorna un articolo. Restituisce l'id. */
    function upsert(fields) {
      fields = Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v !== undefined));   // i campi non dati restano come prima
      const list = load(), old = fields.id ? list.find(e => e.id === fields.id) : null;
      const e = Object.assign({ id: Date.now(), date: Date.now(), status: "todo", photosOnly: false, photos: 0, hashtag: [], controlli: [] }, old || {}, fields);
      if (!fields.date && old) e.date = old.date;
      e.updated = Date.now();
      write([e, ...list.filter(x => x.id !== e.id)]);
      render();
      return e.id;
    }
    function patch(id, fields) {
      const list = load(), e = list.find(x => x.id === id); if (!e) return;
      Object.assign(e, fields, { updated: Date.now() });
      write(list); render();
    }
    function remove(id) {
      const list = load(), e = list.find(x => x.id === id);
      if (e) dropPhotos(e);
      write(list.filter(x => x.id !== id));
      if (openId === id) openId = null;
      api.onRemoved && api.onRemoved(id);
      render();
    }
    /** Salva le foto finali dell'articolo (in ordine). Le vecchie in più vengono tolte. */
    async function savePhotos(id, blobs) {
      const e = get(id); if (!e || !blobs) return;
      const old = e.photos || 0;
      let n = 0;
      try { for (; n < blobs.length; n++) await DB.put(id + ":" + n, blobs[n]); }
      catch (_) { /* spazio finito: si tiene quello che è entrato */ }
      for (let i = n; i < old; i++) DB.del(id + ":" + i);
      patch(id, { photos: n });
    }
    async function photos(id) {
      const e = get(id), out = [];
      if (!e) return out;
      for (let i = 0; i < (e.photos || 0); i++) { const b = await DB.get(id + ":" + i); if (b) out.push(b); }
      return out;
    }

    // ---------- interfaccia ----------
    const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const fmt = ms => { const d = new Date(ms); return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); };
    const title = e => e.titolo || (e.photosOnly ? `${e.tipo || e.cat || "Articolo"} · solo foto` : "Senza titolo");

    function render() {
      const box = $("stockList"); if (!box) return;
      const list = load();
      const n = id => list.filter(e => e.status === id).length;
      $("stockFilters").innerHTML = [{ id: "all", label: "Tutti", n: list.length }, ...STATES.map(s => ({ id: s.id, label: s.label, n: n(s.id) }))]
        .map(f => `<button type="button" data-filter="${f.id}" aria-pressed="${filter === f.id}">${esc(f.label)} <b>${f.n}</b></button>`).join("");
      const shown = list.filter(e => filter === "all" || e.status === filter);
      $("stockEmpty").hidden = !!list.length;
      $("stockNone").hidden = !list.length || !!shown.length;
      box.innerHTML = shown.map(e => `
        <li class="sk${openId === e.id ? " open" : ""}" data-id="${e.id}">
          <button type="button" class="sk-main" data-act="toggle" aria-expanded="${openId === e.id}">
            ${e.thumb ? `<img class="sk-thumb" src="${esc(e.thumb)}" alt="">` : `<span class="sk-thumb"></span>`}
            <span class="sk-txt"><strong>${esc(title(e))}</strong>
              <span class="hint">${esc([e.cat, fmt(e.date), e.photos ? e.photos + " foto" : ""].filter(Boolean).join(" · "))}</span></span>
            <span class="sk-state s-${e.status}">${esc((STATES.find(s => s.id === e.status) || STATES[0]).label)}</span>
          </button>
          ${openId === e.id ? detail(e) : ""}
        </li>`).join("");
    }
    function detail(e) {
      return `<div class="sk-detail">
        <div class="seg" role="group" aria-label="Stato">${STATES.map(s => `<button type="button" data-act="state" data-v="${s.id}" aria-pressed="${e.status === s.id}">${s.label}</button>`).join("")}</div>
        ${e.descrizione ? `<p class="sk-desc">${esc(e.descrizione)}</p>` : `<p class="hint">Solo foto: nessuna descrizione. Riaprilo per scriverla quando vuoi.</p>`}
        <div class="toolbar">
          <button type="button" class="btn primary" data-act="reopen">Riapri</button>
          ${e.titolo ? `<button type="button" class="btn" data-act="copytitle">Copia titolo</button>` : ""}
          ${e.descrizione ? `<button type="button" class="btn" data-act="copy">Copia testo</button>` : ""}
          <button type="button" class="btn danger" data-act="del">Elimina</button>
        </div>
        <span class="hint" data-msg></span>
      </div>`;
    }

    function init() {
      const root = $("tab-stock"); if (!root) return;
      root.addEventListener("click", async ev => {
        const f = ev.target.closest("[data-filter]");
        if (f) { filter = f.dataset.filter; render(); return; }
        const b = ev.target.closest("[data-act]"), li = ev.target.closest("[data-id]");
        if (!b || !li) return;
        const id = Number(li.dataset.id), e = get(id); if (!e) return;
        const msg = t => { const m = li.querySelector("[data-msg]"); if (m) m.textContent = t; };
        switch (b.dataset.act) {
          case "toggle": openId = openId === id ? null : id; render(); break;
          case "state": patch(id, { status: b.dataset.v }); api.haptic && api.haptic(); break;
          case "copy": msg(await api.copy(e) ? "Testo copiato ✓" : "Copia non riuscita"); break;
          case "copytitle": { const ok = await api.copyText(e.titolo || ""); msg(ok ? "Titolo copiato ✓" : "Copia non riuscita"); break; }
          case "reopen": {
            if (api.busyGrid(id) && b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Sostituisco le foto in Carica?"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "Riapri"; }, 3000); return; }
            b.disabled = true; msg("Apro l'articolo…");
            try { await api.reopen(e, await photos(id)); } finally { b.disabled = false; }
            break;
          }
          case "del":
            if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tocca di nuovo per eliminare"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "Elimina"; }, 3000); return; }
            remove(id); break;
        }
      });
      render();
    }

    init();
    return { upsert, patch, remove, get, load, savePhotos, photos, render, STATES };
  };
})();
