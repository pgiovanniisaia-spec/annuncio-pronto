// Scheda «Archivio» (la scatola): ogni volta che una copertina AI viene approvata o una descrizione viene scritta,
// l'articolo si salva da solo qui con la descrizione così com'è e SOLO le foto fatte con l'AI (scaricabili),
// non le altre. Dati: localStorage "ll_archive" + IndexedDB "listlab-archive/photos" (chiavi "<id>:<n>").
(function () {
  "use strict";
  const KEY = "ll_archive", MAX = 40, PHOTOS = 8;

  const DB = (() => {
    let p = null;
    const open = () => p || (p = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("no idb"));
      const r = indexedDB.open("listlab-archive", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("photos");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("photos", mode); const q = fn(t.objectStore("photos")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
    return { put: (k, v) => tx("readwrite", s => s.put(v, k)), get: k => tx("readonly", s => s.get(k)).catch(() => null), del: k => tx("readwrite", s => s.delete(k)).catch(() => {}) };
  })();

  const load = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
  function write(list) {
    let l = list.slice(0, MAX);
    for (;;) { try { localStorage.setItem(KEY, JSON.stringify(l)); break; } catch (_) { if (!l.length) break; drop(l[l.length - 1]); l = l.slice(0, -1); } }
    list.slice(MAX).forEach(drop);
  }
  function drop(e) { for (let i = 0; i < (e.photos || 0); i++) DB.del(e.id + ":" + i); }
  const $ = id => document.getElementById(id);

  /** Animazione della scatola nella barra: si apre, l'articolo ci cade dentro, si chiude. */
  function play() {
    const b = document.querySelector('.tabbar [data-tab="box"]'); if (!b) return;
    b.classList.remove("boxing"); void b.offsetWidth; b.classList.add("boxing");
    clearTimeout(play.t); play.t = setTimeout(() => b.classList.remove("boxing"), 1700);
  }

  /** Salva (o aggiorna) un articolo: meta = {id, titolo, descrizione, hashtag}, blobs = foto in ordine. */
  async function save(meta, blobs) {
    const pics = (blobs || []).slice(0, PHOTOS);
    if (!meta || !meta.id || (!pics.length && !meta.descrizione)) return false;
    const list = load(), old = list.find(e => e.id === meta.id);
    for (let i = 0; i < pics.length; i++) await DB.put(meta.id + ":" + i, pics[i]);
    for (let i = pics.length; i < (old ? old.photos || 0 : 0); i++) DB.del(meta.id + ":" + i);
    const e = Object.assign({}, old || {}, { id: meta.id, date: Date.now(), titolo: meta.titolo || (old && old.titolo) || "", descrizione: meta.descrizione || (old && old.descrizione) || "",
      hashtag: meta.hashtag || (old && old.hashtag) || [], photos: pics.length });
    write([e].concat(list.filter(x => x.id !== meta.id)));
    play();
    if (!$("tab-box").hidden) render();
    return true;
  }
  /** Aggiorna solo il testo di un articolo già in archivio (modifiche a mano). */
  function patch(id, fields) {
    const list = load(), e = list.find(x => x.id === id); if (!e) return;
    Object.assign(e, fields); write(list);
  }

  const urls = [];
  async function render() {
    const box = $("boxList"); if (!box) return;
    urls.splice(0).forEach(u => URL.revokeObjectURL(u));
    const list = load();
    $("boxEmpty").hidden = list.length > 0; $("boxCount").textContent = list.length ? String(list.length) : "";
    box.innerHTML = "";
    for (const e of list) {
      const li = document.createElement("li"); li.className = "boxitem";
      const strip = document.createElement("div"); strip.className = "boxstrip";
      for (let i = 0; i < (e.photos || 0); i++) {
        const b = await DB.get(e.id + ":" + i); if (!b) continue;
        const u = URL.createObjectURL(b); urls.push(u);
        const im = document.createElement("img"); im.src = u; im.alt = ""; strip.appendChild(im);
      }
      const t = document.createElement("strong"); t.textContent = e.titolo || "Senza titolo";
      const d = document.createElement("pre"); d.className = "boxdesc"; d.style.maxHeight = "none"; d.textContent = e.descrizione || "Descrizione non ancora scritta.";
      const bar = document.createElement("div"); bar.className = "toolbar";
      const cp = document.createElement("button"); cp.type = "button"; cp.className = "btn"; cp.textContent = "Copia descrizione";
      cp.addEventListener("click", async () => { try { await navigator.clipboard.writeText(e.descrizione || ""); cp.textContent = "Copiato ✓"; } catch (_) { cp.textContent = "Non riesco a copiare"; } setTimeout(() => { cp.textContent = "Copia descrizione"; }, 1800); });
      const rm = document.createElement("button"); rm.type = "button"; rm.className = "btn danger"; rm.textContent = "Elimina";
      rm.addEventListener("click", () => {
        if (rm.dataset.sure !== "1") { rm.dataset.sure = "1"; rm.textContent = "Tocca di nuovo"; setTimeout(() => { rm.dataset.sure = ""; rm.textContent = "Elimina"; }, 3000); return; }
        drop(e); write(load().filter(x => x.id !== e.id)); render();
      });
      const dl = document.createElement("button"); dl.type = "button"; dl.className = "btn primary"; dl.textContent = "Scarica foto AI";
      dl.hidden = !(e.photos > 0);
      dl.addEventListener("click", async () => {
        dl.disabled = true; dl.textContent = "Salvo…";
        let ok = 0;
        const G = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GallerySaver;
        const folder = (e.titolo || "Archivio").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 60) || "Archivio";
        for (let i = 0; i < e.photos; i++) {
          const b = await DB.get(e.id + ":" + i); if (!b) continue;
          const name = String(i + 1).padStart(2, "0") + "-ai.jpg";
          try {
            if (G) {
              const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(b); });
              await G.saveImage({ data, root: (window.APP_NAME || "ListLab"), folder, fileName: name, time: Date.now() + i * 1000 });
            } else {
              const u = URL.createObjectURL(b), aEl = document.createElement("a"); aEl.href = u; aEl.download = name; document.body.appendChild(aEl); aEl.click(); aEl.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
            }
            ok++;
          } catch (_) {}
        }
        dl.textContent = ok ? ok + " foto salvate ✓" : "Non riesco a salvarle"; dl.disabled = false;
        setTimeout(() => { dl.textContent = "Scarica foto AI"; }, 2500);
      });
      bar.append(dl, cp, rm); li.append(strip, t, d, bar); box.appendChild(li);
    }
  }

  window.LLArchive = { save, patch, render, play, has: id => load().some(e => e.id === id) };
})();
