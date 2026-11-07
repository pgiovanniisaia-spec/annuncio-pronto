// Pezzi d'interfaccia condivisi per l'AI di immagini:
//  • LLStyleRef: "Foto di riferimento stile" salvata sul telefono (IndexedDB "listlab-ref",
//    separato dal servizio guidato) e riusata per tutte le copertine;
//  • LLAsk: foglio di conferma con il costo stimato (prima di ogni invio a OpenAI);
//  • LLPick: scelta fra 2 varianti generate.
(function () {
  "use strict";

  // ---------- archivio della foto di riferimento ----------
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("no idb"));
    const r = indexedDB.open("listlab-ref", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("ref");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction("ref", mode); const q = fn(t.objectStore("ref")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  let cache, listeners = [];
  const StyleRef = {
    async get() { if (cache !== undefined) return cache; try { cache = (await tx("readonly", s => s.get("style"))) || null; } catch (_) { cache = null; } return cache; },
    async set(blob) {
      // il riferimento serve solo per scena e luce: basta 1536 px
      const c = await toCanvas(blob, 1536), b = await new Promise(r => c.toBlob(r, "image/jpeg", 0.92));
      try { await tx("readwrite", s => s.put(b, "style")); } catch (_) {}
      cache = b; listeners.forEach(f => f(b));
    },
    async clear() { try { await tx("readwrite", s => s.delete("style")); } catch (_) {} cache = null; listeners.forEach(f => f(null)); },
    onChange(f) { listeners.push(f); },
    // riquadro "Foto di riferimento stile" con anteprima, Scegli/Cambia e Togli
    mount(host) {
      host.classList.add("refbox");
      host.innerHTML = `<img class="ref-thumb" alt="" hidden><span class="ref-ph" aria-hidden="true">🖼️</span>
        <div class="ref-txt"><strong>Foto di riferimento stile</strong><small>Una tua foto ben riuscita (es. cappotto appeso a un muro bianco con luce naturale): l'AI ne copia scena, luce e inquadratura, non il capo.</small></div>
        <div class="ref-btns"><button type="button" class="btn small" data-ref="pick">Scegli</button><button type="button" class="linkbtn" data-ref="clear" hidden>Togli</button></div>`;
      const img = host.querySelector(".ref-thumb"), ph = host.querySelector(".ref-ph"), pick = host.querySelector('[data-ref="pick"]'), clr = host.querySelector('[data-ref="clear"]');
      let url = null;
      const show = b => {
        if (url) URL.revokeObjectURL(url); url = b ? URL.createObjectURL(b) : null;
        img.hidden = !b; ph.hidden = !!b; if (b) img.src = url;
        pick.textContent = b ? "Cambia" : "Scegli"; clr.hidden = !b;
      };
      StyleRef.get().then(show); StyleRef.onChange(show);
      host.addEventListener("click", async e => {
        const b = e.target.closest("[data-ref]"); if (!b) return;
        if (b.dataset.ref === "clear") return StyleRef.clear();
        const f = await pickImage(); if (f) StyleRef.set(f);
      });
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

  // ---------- foglio di conferma ----------
  function sheet(html) {
    const wrap = document.createElement("div");
    wrap.className = "ll-sheet"; wrap.innerHTML = `<div class="ll-sheet-box" role="dialog" aria-modal="true">${html}</div>`;
    document.body.append(wrap);
    return wrap;
  }
  /**
   * @param {object} o { title, body, cost (testo), ok, cancel, remember (testo casella facoltativa) }
   * @returns {Promise<{ok:boolean, remember:boolean}>}
   */
  function ask(o) {
    return new Promise(res => {
      const w = sheet(`<h3>${o.title}</h3>${o.body ? `<p>${o.body}</p>` : ""}
        ${o.cost ? `<div class="ll-cost"><span>Costo stimato</span><strong>${o.cost}</strong></div>` : ""}
        ${o.remember ? `<label class="toggle"><input type="checkbox" data-rem> ${o.remember}</label>` : ""}
        <div class="ll-btns"><button type="button" class="btn" data-a="no">${o.cancel || "Annulla"}</button><button type="button" class="btn primary" data-a="ok">${o.ok || "Invia"}</button></div>`);
      w.addEventListener("click", e => {
        const b = e.target.closest("[data-a]"); if (!b) return;
        const rem = w.querySelector("[data-rem]");
        w.remove(); res({ ok: b.dataset.a === "ok", remember: !!(rem && rem.checked) });
      });
    });
  }
  // ---------- scelta fra varianti ----------
  function pick(blobs, title) {
    return new Promise(res => {
      const urls = blobs.map(b => URL.createObjectURL(b));
      const w = sheet(`<h3>${title || "Scegli la variante migliore"}</h3>
        <div class="ll-variants">${urls.map((u, i) => `<button type="button" data-v="${i}"><img src="${u}" alt="Variante ${i + 1}"><span>Variante ${i + 1}</span></button>`).join("")}</div>
        <div class="ll-btns"><button type="button" class="btn" data-v="-1">Nessuna, tieni l'originale</button></div>`);
      w.addEventListener("click", e => {
        const b = e.target.closest("[data-v]"); if (!b) return;
        const i = Number(b.dataset.v); w.remove(); urls.forEach(u => URL.revokeObjectURL(u));
        res(i >= 0 ? blobs[i] : null);
      });
    });
  }

  window.LLStyleRef = StyleRef;
  window.LLAsk = ask;
  window.LLPick = pick;
  window.LLPickImage = pickImage;
})();
