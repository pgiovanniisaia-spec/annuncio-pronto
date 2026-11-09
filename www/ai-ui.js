// Pezzi d'interfaccia condivisi per la copertina con AI:
//  • LLStyleRef: "Stile copertina" = una o più foto modello salvate sul telefono (IndexedDB
//    "listlab-ref", ridotte a 1024 px) con una predefinita; riquadro compatto (Cambia/Togli) e gestore
//    completo per le Impostazioni;
//  • LLAsk: foglio di conferma generico;  LLPickImage: selettore di una foto.
(function () {
  "use strict";

  // ---------- archivio ----------
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("no idb"));
    const r = indexedDB.open("listlab-ref", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("ref");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction("ref", mode); const q = fn(t.objectStore("ref")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  const get = k => tx("readonly", s => s.get(k)).catch(() => null);
  const put = (k, v) => tx("readwrite", s => s.put(v, k)).catch(() => {});

  let list = null, def = null, listeners = [];
  async function load() {
    if (list) return;
    list = (await get("list")) || [];
    def = (await get("default")) || null;
    const old = await get("style");                       // foto unica della versione precedente
    if (old && !list.length) { const id = "s" + Date.now(); list.push({ id, blob: old }); def = id; await save(); }
  }
  async function save() { await put("list", list); await put("default", def); }
  const notify = () => { const b = current(); listeners.forEach(f => { try { f(b); } catch (_) {} }); };
  const current = () => { const it = list && list.find(x => x.id === def); return it ? it.blob : null; };

  const StyleRef = {
    async get() { await load(); return current(); },
    async all() { await load(); return list.slice(); },
    defaultId: () => def,
    async add(blob, makeDefault) {
      await load();
      const c = await toCanvas(blob, 1024), b = await new Promise(r => c.toBlob(r, "image/jpeg", 0.92));
      const id = "s" + Date.now() + Math.random().toString(36).slice(2, 5);
      list.push({ id, blob: b }); if (makeDefault || !def) def = id;
      await save(); notify(); return id;
    },
    async set(blob) { return StyleRef.add(blob, true); },
    async setDefault(id) { await load(); def = id; await save(); notify(); },
    async remove(id) { await load(); list = list.filter(x => x.id !== id); if (def === id) def = list[0] ? list[0].id : null; await save(); notify(); },
    async clear() { await load(); def = null; await save(); notify(); },     // nessuna foto modello in uso
    onChange(f) { listeners.push(f); return () => { listeners = listeners.filter(x => x !== f); }; },

    // riquadro compatto: foto modello in uso, «Cambia» (aggiunge e usa una nuova foto), «Togli»
    mount(host) {
      host.classList.add("refbox");
      host.innerHTML = `<img class="ref-thumb" alt="" hidden><span class="ref-ph" aria-hidden="true">🖼️</span>
        <div class="ref-txt"><strong>Foto modello (stile)</strong><small>Il regista ne copia scena, luce e inquadratura, mai il capo. Puoi salvarne più di una in Impostazioni.</small></div>
        <div class="ref-btns"><button type="button" class="btn small" data-ref="pick">Scegli</button><button type="button" class="linkbtn" data-ref="clear" hidden>Togli</button></div>`;
      const img = host.querySelector(".ref-thumb"), ph = host.querySelector(".ref-ph"), pick = host.querySelector('[data-ref="pick"]'), clr = host.querySelector('[data-ref="clear"]');
      let u = null;
      const show = b => {
        if (u) URL.revokeObjectURL(u); u = b ? URL.createObjectURL(b) : null;
        img.hidden = !b; ph.hidden = !!b; if (b) img.src = u;
        pick.textContent = b ? "Cambia" : "Scegli"; clr.hidden = !b;
      };
      StyleRef.get().then(show);
      const off = StyleRef.onChange(show);
      host._off && host._off(); host._off = off;
      host.onclick = async e => {
        const b = e.target.closest("[data-ref]"); if (!b) return;
        if (b.dataset.ref === "clear") return StyleRef.clear();
        const f = await pickImage(); if (f) StyleRef.add(f, true);
      };
    },

    // gestore completo (Impostazioni → Stile copertina): tocca per renderla predefinita, × per eliminarla
    async manage(host) {
      await load();
      const urls = [];
      const draw = () => {
        urls.splice(0).forEach(x => URL.revokeObjectURL(x));
        host.innerHTML = `<div class="ref-grid">${list.map(x => { const u = URL.createObjectURL(x.blob); urls.push(u);
          return `<div class="ref-cell${x.id === def ? " on" : ""}"><button type="button" class="ref-pick" data-id="${x.id}" aria-pressed="${x.id === def}" aria-label="Usa come predefinita"><img src="${u}" alt=""></button>
            <button type="button" class="ref-del" data-del="${x.id}" aria-label="Elimina">×</button>${x.id === def ? `<span class="ref-def">Predefinita</span>` : ""}</div>`; }).join("")}
          <button type="button" class="ref-add" data-add="1"><span>+</span>Aggiungi foto modello</button></div>`;
      };
      draw(); StyleRef.onChange(draw);
      host.onclick = async e => {
        const p = e.target.closest("[data-id]"), d = e.target.closest("[data-del]"), a = e.target.closest("[data-add]");
        if (d) return StyleRef.remove(d.dataset.del);
        if (p) return StyleRef.setDefault(p.dataset.id);
        if (a) { const f = await pickImage(); if (f) StyleRef.add(f, !def); }
      };
    }
  };

  async function toCanvas(blob, maxSide) {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); if (bmp.close) bmp.close();
    return c;
  }
  function pickImage() {
    return new Promise(res => {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
      inp.style.cssText = "position:fixed;left:-9999px;opacity:0";
      inp.onchange = () => { const f = inp.files && inp.files[0]; inp.remove(); res(f || null); };
      document.body.append(inp); inp.click();
    });
  }

  // ---------- foglio di conferma generico ----------
  function ask(o) {
    return new Promise(res => {
      const w = document.createElement("div"); w.className = "ll-sheet";
      w.innerHTML = `<div class="ll-sheet-box" role="dialog" aria-modal="true"><h3>${o.title}</h3>${o.body ? `<p>${o.body}</p>` : ""}
        <div class="ll-btns"><button type="button" class="btn" data-a="no">${o.cancel || "Annulla"}</button><button type="button" class="btn primary" data-a="ok">${o.ok || "OK"}</button></div></div>`;
      document.body.append(w);
      w.addEventListener("click", e => { const b = e.target.closest("[data-a]"); if (!b) return; w.remove(); res({ ok: b.dataset.a === "ok" }); });
    });
  }

  window.LLStyleRef = StyleRef;
  window.LLAsk = ask;
  window.LLPickImage = pickImage;
})();
