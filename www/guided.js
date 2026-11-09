// Servizio guidato (es. "Cappotto"): scaletta di scatto → controlli → elaborazione automatica
// → prima/dopo → lettura etichette → ordine → annuncio pronto.
// Il lavoro si salva sul telefono (IndexedDB per le foto, localStorage per lo stato) e riprende
// alla riapertura dell'app. app.js lo crea con createGuided(api).
(function () {
  "use strict";

  const STATE_KEY = "ll_guided_v1";

  // ---------- archivio foto (IndexedDB) ----------
  const DB = (() => {
    let p = null;
    const open = () => p || (p = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("no idb"));
      const r = indexedDB.open("listlab", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("blobs");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("blobs", mode); const st = t.objectStore("blobs"); const q = fn(st); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
    return {
      put: (k, v) => tx("readwrite", st => st.put(v, k)).catch(() => {}),
      get: k => tx("readonly", st => st.get(k)).catch(() => null),
      del: k => tx("readwrite", st => st.delete(k)).catch(() => {}),
      clear: () => tx("readwrite", st => st.clear()).catch(() => {})
    };
  })();

  // ---------- utilità immagini ----------
  async function blobToCanvas(blob, maxSide) {
    let bmp;
    try { bmp = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
    catch (_) {
      bmp = await new Promise((res, rej) => { const im = new Image(), u = URL.createObjectURL(blob); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("decode")); }; im.src = u; });
    }
    const k = Math.min(1, (maxSide || 1600) / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  }
  const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("blob")), type || "image/jpeg", q || 0.92));
  function toB64(c, maxSide) {
    const k = Math.min(1, (maxSide || 1024) / Math.max(c.width, c.height));
    const d = document.createElement("canvas"); d.width = Math.round(c.width * k); d.height = Math.round(c.height * k);
    d.getContext("2d").drawImage(c, 0, 0, d.width, d.height);
    return d.toDataURL("image/jpeg", 0.85).split(",")[1];
  }
  function edgeColor(c) {
    const s = document.createElement("canvas"); s.width = 32; s.height = 32;
    const x = s.getContext("2d"); x.drawImage(c, 0, 0, 32, 32);
    const d = x.getImageData(0, 0, 32, 32).data, R = [], G = [], B = [];
    for (let i = 0; i < 32; i++) for (const [px, py] of [[i, 0], [i, 31], [0, i], [31, i]]) { const k = (py * 32 + px) * 4; R.push(d[k]); G.push(d[k + 1]); B.push(d[k + 2]); }
    const med = a => a.sort((p, q) => p - q)[a.length >> 1];
    return `rgb(${med(R)},${med(G)},${med(B)})`;
  }
  // raddrizza (ruota di -tilt) e ritaglia attorno al capo in formato 3:4, senza mai tagliarlo
  function prepare(c, tiltDeg, box, aspect) {
    const A = aspect || 3 / 4;
    let src = c;
    if (tiltDeg) {
      const a = -tiltDeg * Math.PI / 180, w = c.width, h = c.height, cs = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
      const k = Math.max((w * cs + h * sn) / w, (w * sn + h * cs) / h);
      src = document.createElement("canvas"); src.width = w; src.height = h;
      const x = src.getContext("2d"); x.imageSmoothingQuality = "high";
      x.translate(w / 2, h / 2); x.rotate(a); x.scale(k, k); x.drawImage(c, -w / 2, -h / 2);
    }
    const W = src.width, H = src.height;
    let bx0 = 0, by0 = 0, bx1 = W, by1 = H;
    if (Array.isArray(box) && box.length === 4 && box[2] - box[0] > 0.15 && box[3] - box[1] > 0.15) {
      bx0 = box[0] * W; by0 = box[1] * H; bx1 = box[2] * W; by1 = box[3] * H;
      const pad = 0.08 * Math.max(bx1 - bx0, by1 - by0);
      bx0 -= pad; by0 -= pad; bx1 += pad; by1 += pad;
    }
    let bw = bx1 - bx0, bh = by1 - by0;
    if (bw / bh > A) bh = bw / A; else bw = bh * A;
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    const OW = Math.min(1200, Math.round(bw)), OH = Math.round(OW / A), k = OW / bw;
    const out = document.createElement("canvas"); out.width = OW; out.height = OH;
    const x = out.getContext("2d"); x.fillStyle = edgeColor(src); x.fillRect(0, 0, OW, OH);
    x.imageSmoothingQuality = "high";
    x.drawImage(src, (OW / 2) - (cx * k), (OH / 2) - (cy * k), W * k, H * k);
    return out;
  }

  window.createGuided = function createGuided(api) {
    const P = window.LL_PRESETS, Q = window.LLQuality;
    const cam = window.createGuidedCamera({ plugin: api.plugin, haptic: api.haptic });
    let G = null;                          // stato del servizio in corso
    const canv = new Map();                // uid → canvas della foto originale (in memoria)
    const urls = new Map();                // chiave blob → objectURL per le anteprime
    let root = null, running = 0, saveTimer = 0;

    // ---------- stato e salvataggio ----------
    const preset = () => P.PRESETS[G.preset];
    const mains = () => G.shots.filter(s => s.kind === "main");
    const details = () => G.shots.filter(s => s.kind === "detail");
    const stepOf = s => s.kind === "main" ? preset().steps.find(x => x.id === s.step) : preset().details.find(x => x.type === s.type);
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    function save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!G) return;
        try { G.fields = api.getDetails(); localStorage.setItem(STATE_KEY, JSON.stringify(G)); } catch (_) {}
      }, 150);
    }
    function load() { try { const s = JSON.parse(localStorage.getItem(STATE_KEY) || "null"); return s && s.v === 1 && P.PRESETS[s.preset] ? s : null; } catch (_) { return null; } }
    async function clearSession() {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear(); canv.clear(); G = null;
      try { localStorage.removeItem(STATE_KEY); } catch (_) {}
      await DB.clear();
    }
    async function blobUrl(key) {
      if (urls.has(key)) return urls.get(key);
      const b = await DB.get(key); if (!b) return null;
      const u = URL.createObjectURL(b); urls.set(key, u); return u;
    }
    async function setBlob(key, blob) {
      await DB.put(key, blob);
      if (urls.has(key)) { URL.revokeObjectURL(urls.get(key)); urls.delete(key); }
    }
    async function origCanvas(s) {
      if (canv.has(s.uid)) return canv.get(s.uid);
      const b = await DB.get(s.uid + ":orig"); if (!b) return null;
      const c = await blobToCanvas(b, 1600); canv.set(s.uid, c); return c;
    }

    // ---------- interfaccia ----------
    function ensureRoot() {
      if (root) return root;
      root = document.createElement("div");
      root.id = "guided"; root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true");
      root.innerHTML = `<header class="g-head">
          <button type="button" class="g-x" data-act="close" aria-label="Chiudi e riprendi dopo">✕</button>
          <div class="g-ttl"><small>Servizio guidato</small><strong id="gTitle"></strong></div>
          <ol class="g-dots" id="gDots" aria-hidden="true"></ol>
        </header>
        <div class="g-body" id="gBody"></div>
        <footer class="g-foot" id="gFoot"></footer>
        <div class="g-sheet" id="gSheet" hidden></div>`;
      document.body.append(root);
      root.addEventListener("click", onClick);
      root.addEventListener("input", e => { if (e.target.matches("[data-measure]")) save(); });
      return root;
    }
    const $g = id => document.getElementById(id);
    const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    function show() {
      ensureRoot(); root.hidden = false; document.documentElement.classList.add("guided-open");
      render();
    }
    function hide() { if (root) root.hidden = true; document.documentElement.classList.remove("guided-open"); }
    const STAGES = ["pick", "steps", "process", "review", "ready"];
    function dots() {
      const i = STAGES.indexOf(G ? G.stage : "pick");
      $g("gDots").innerHTML = ["Categoria", "Scatti", "Elaborazione", "Controllo", "Pronto"].map((t, k) => `<li class="${k < i ? "done" : k === i ? "on" : ""}" title="${t}"></li>`).join("");
    }
    function render() {
      if (!root) return;
      $g("gTitle").textContent = G ? preset().name : "Nuovo annuncio";
      dots();
      const st = G ? G.stage : "pick";
      ({ pick: renderPick, steps: renderSteps, process: renderProcess, review: renderReview, ready: renderReady })[st]();
      $g("gBody").scrollTop = $g("gBody").scrollTop; // mantiene la posizione
    }

    // ---------- 1. scelta categoria ----------
    function renderPick() {
      const saved = load();
      $g("gBody").innerHTML = `
        <h2 class="g-h">Che cosa vendi?</h2>
        <p class="g-lead">Scegli la categoria: ti guido scatto per scatto e preparo foto e annuncio nell'ordine giusto per Vinted.</p>
        ${saved && saved.stage !== "ready" && saved.stage !== "pick" ? `<button type="button" class="g-resume" data-act="resume">
            <strong>Riprendi il servizio in corso</strong><span>${esc(P.PRESETS[saved.preset].name)} · ${saved.shots.filter(s => s.status === "ok").length} foto fatte</span></button>` : ""}
        <div class="g-cats">${P.ORDER.map(id => { const p = P.PRESETS[id]; return `
          <button type="button" class="g-cat${p.soon ? " soon" : ""}" data-act="pick" data-preset="${id}" ${p.soon ? "disabled" : ""}>
            <svg viewBox="0 0 120 90" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${p.icon}</svg>
            <strong>${esc(p.name)}</strong><span>${p.soon ? "In arrivo" : "Copertina da negozio, fronte, retro e dettagli"}</span></button>`; }).join("")}</div>
        ${api.gridCount() ? `<p class="g-note">Le ${api.gridCount()} foto ora in Home verranno sostituite da quelle del servizio.</p>` : ""}`;
      $g("gFoot").innerHTML = "";
    }
    async function startPreset(id) {
      await clearSession();
      const p = P.PRESETS[id];
      G = { v: 1, preset: id, stage: "steps", mode: api.keys().openai ? "ai" : "local", shots: [], labels: null, fields: null, reviewed: {}, detailPick: null, startedAt: Date.now() };
      p.steps.forEach(st => G.shots.push({ uid: uid(), kind: "main", step: st.id, status: "empty", issues: [], framing: null, tilt: null, box: null, ai: "none", aiErr: "", choice: null, proc: "idle", at: 0 }));
      api.setCategory(p.cat);
      save(); render();
    }

    // ---------- 2. scaletta ----------
    const statusText = s => {
      if (s.status === "empty") return "Da fare";
      if (s.status === "checking") return "Controllo la foto…";
      if (s.status === "framing") return "Controllo l'inquadratura…";
      if (s.issues && s.issues.length && s.accepted) return "Tenuta così: " + s.issues.map(i => i.short || i.code).join(", ");
      return "Fatta ✓";
    };
    function thumbHtml(s, cls) { return `<img class="${cls || "g-thumb"}" data-thumb="${s.uid}" alt="">`; }
    async function fillThumbs() {
      for (const img of root.querySelectorAll("img[data-thumb]")) {
        const s = G.shots.find(x => x.uid === img.dataset.thumb); if (!s) continue;
        const key = img.dataset.which === "result" ? resultKey(s) : s.uid + ":orig";
        const u = await blobUrl(key) || await blobUrl(s.uid + ":orig");
        if (u) img.src = u;
      }
    }
    function stepCard(s, i, current) {
      const st = stepOf(s), done = s.status !== "empty";
      return `<section class="g-step${current ? " current" : ""}${done ? " done" : ""}">
        <div class="g-step-head"><span class="g-num">${done && s.status === "ok" ? "✓" : i + 1}</span>
          <div><strong>${esc(st.title)}</strong><small>${esc(statusText(s))}</small></div>
          ${done ? thumbHtml(s, "g-mini") : ""}</div>
        ${current ? `<div class="g-step-body">
          <div class="g-ill">${P.ILL[s.step] || ""}</div>
          <ul class="g-tips">${st.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
          <div class="g-btns"><button type="button" class="btn primary" data-act="shoot" data-uid="${s.uid}">📷 Scatta</button>
            <button type="button" class="btn" data-act="gallery" data-uid="${s.uid}">Scegli dalla galleria</button></div>
        </div>` : `<div class="g-step-actions"><button type="button" class="linkbtn" data-act="shoot" data-uid="${s.uid}">${done ? "Rifai lo scatto" : "Scatta"}</button><button type="button" class="linkbtn" data-act="gallery" data-uid="${s.uid}">Dalla galleria</button></div>`}
      </section>`;
    }
    function renderSteps() {
      const ms = mains(), cur = ms.findIndex(s => s.status === "empty");
      const ds = details(), p = preset(), ok = ms.every(s => s.status === "ok");
      const aiOn = G.mode === "ai", hasOpenai = api.keys().openai;
      $g("gBody").innerHTML = `
        <div class="g-mode">
          <div class="seg" role="group" aria-label="Elaborazione">
            <button type="button" data-act="mode" data-v="ai" aria-pressed="${aiOn}" ${hasOpenai ? "" : "disabled"}>Pulizia con AI</button>
            <button type="button" data-act="mode" data-v="local" aria-pressed="${!aiOn}">Solo sistemazione locale</button>
          </div>
          <span class="hint">${hasOpenai ? (aiOn ? "🎬 Il regista (Claude) studia ogni foto principale e scrive le istruzioni; 📷 il fotografo (OpenAI) fa uno scatto dalla foto originale. Per ognuna vedi la sintesi e il costo e decidi tu. I dettagli restano foto reali." : "Gratis: luce, colori e ritaglio sul telefono, senza AI.") : "Per la pulizia con AI aggiungi la chiave OpenAI in Impostazioni. Intanto: sistemazione locale gratuita."}</span>
          ${aiOn && hasOpenai ? `<div id="gRefBox"></div>` : ""}
        </div>
        <h2 class="g-h">Scaletta di scatto</h2>
        ${ms.map((s, i) => stepCard(s, i, i === cur)).join("")}
        <section class="g-step g-details${ok ? " current" : ""}">
          <div class="g-step-head"><span class="g-num">+</span><div><strong>Dettagli facoltativi</strong><small>Etichette, fodera, tasche, difetti, metro: restano foto reali, mai modificate con l'AI.</small></div></div>
          <div class="g-dlist">${ds.map(s => `<div class="g-drow">${thumbHtml(s, "g-mini")}<div><strong>${esc(stepOf(s).title)}</strong><small>${esc(statusText(s))}</small></div>
              <button type="button" class="linkbtn" data-act="shoot" data-uid="${s.uid}">Rifai</button><button type="button" class="linkbtn" data-act="remove" data-uid="${s.uid}">Togli</button></div>`).join("")}</div>
          ${G.detailPick ? detailPicker() : `<button type="button" class="btn" data-act="adddetail">+ Aggiungi dettaglio</button>`}
        </section>
        <section class="g-step g-measures">
          <div class="g-step-head"><span class="g-num">cm</span><div><strong>Misure (facoltative)</strong><small>Le metto nella descrizione.</small></div></div>
          <div class="g-mgrid">${p.measures.map(m => `<label><span>${esc(m.label)}</span><input type="number" inputmode="decimal" min="0" max="300" data-measure="${m.id}" value="${esc((api.getDetails().measures || {})[m.id] || "")}" placeholder="cm"></label>`).join("")}</div>
        </section>`;
      const refHost = $g("gRefBox");
      if (refHost && window.LLStyleRef) window.LLStyleRef.mount(refHost);
      const missing = ms.filter(s => s.status !== "ok").map(s => stepOf(s).short);
      $g("gFoot").innerHTML = `<button type="button" class="go" data-act="process" ${ok ? "" : "disabled"}>Elabora e crea l'annuncio</button>
        <span class="hint">${ok ? (running ? "Sto già elaborando le prime foto in sottofondo…" : "Puoi aggiungere dettagli prima di continuare.") : "Mancano: " + missing.join(", ")}</span>`;
      fillThumbs();
      // le misure si salvano nei Dettagli di Home
      root.querySelectorAll("[data-measure]").forEach(inp => inp.addEventListener("change", () => {
        const m = Object.assign({}, api.getDetails().measures || {}); m[inp.dataset.measure] = inp.value; api.setDetails({ measures: m }); save();
      }));
    }
    function detailPicker() {
      const p = preset(), t = G.detailPick && G.detailPick !== "*" ? p.details.find(d => d.type === G.detailPick) : null;
      if (t) return `<div class="g-dpick-one"><div class="g-ill small">${P.ILL[t.type] || ""}</div><div><strong>${esc(t.title)}</strong>
          <ul class="g-tips">${t.tips.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
        <div class="g-btns"><button type="button" class="btn primary" data-act="shootdetail" data-type="${t.type}">📷 Scatta</button>
          <button type="button" class="btn" data-act="gallerydetail" data-type="${t.type}">Scegli dalla galleria</button></div>
        <button type="button" class="linkbtn" data-act="canceldetail">Annulla</button>`;
      return `<div class="g-dpick">${p.details.map(d => `<button type="button" class="g-dtype" data-act="picktype" data-type="${d.type}">
          <span class="g-ill tiny">${P.ILL[d.type] || ""}</span><span>${esc(d.title)}</span></button>`).join("")}</div>
        <button type="button" class="linkbtn" data-act="canceldetail">Annulla</button>`;
    }

    // ---------- scatto e controlli ----------
    async function capture(s, fromGallery) {
      const st = stepOf(s);
      const shot = fromGallery ? await cam.pickFile(false) : await cam.open({ title: st.title, shape: s.kind === "main" ? st.shape : "detail", level: s.kind === "main" ? st.level : "flat" });
      if (!shot || !shot.blob) return false;
      const c = await blobToCanvas(shot.blob, 1600);
      const jpg = await toBlob(c, "image/jpeg", 0.92);
      await setBlob(s.uid + ":orig", jpg);
      await setBlob(s.uid + ":raw", shot.blob);            // originale integro: è quello che va all'AI
      await DB.del(s.uid + ":ai"); await DB.del(s.uid + ":ai2"); await DB.del(s.uid + ":prep");
      canv.set(s.uid, c);
      Object.assign(s, { status: "checking", issues: [], accepted: false, framing: null, ai: "none", aiErr: "", choice: null, proc: "idle", at: Date.now(), box: null, tilt: null });
      delete G.reviewed[s.uid];
      save(); render();
      // controlli locali veloci
      const q = Q.analyze(c, { sensorTilt: shot.sensorTilt });
      s.tilt = q.tilt;
      s.issues = q.issues.map(i => Object.assign({ short: { blur: "mossa", dark: "scura", tilt: "inclinata" }[i.code] }, i));
      if (s.issues.length) {
        const keep = await askRetake(s, s.issues.map(i => i.text));
        if (!keep) return retake(s, fromGallery);
        s.accepted = true;
      }
      // il capo è tutto dentro? (Claude, solo copertina/fronte/retro)
      if (s.kind === "main" && st.framing && api.keys().claude) {
        s.status = "framing"; save(); render();
        const f = await checkFraming(s, c, st);
        s.framing = f; if (f && Array.isArray(f.box)) s.box = f.box;
        if (f && f.cut) {
          const keep = await askRetake(s, [`Il cappotto sembra tagliato fuori dall'inquadratura${f.where ? " (" + f.where + ")" : ""}.`]);
          if (!keep) return retake(s, fromGallery);
          s.issues.push({ code: "cut", short: "tagliata", text: "Capo tagliato" }); s.accepted = true;
        }
      }
      s.status = "ok"; save(); render();
      if (s.kind === "detail" && stepOf(s).label) readLabels();   // etichette: lettura in sottofondo
      queue(s);                                                    // elaborazione in sottofondo
      if (mains().every(x => x.status === "ok") && s.kind === "main") toast("Scatti principali fatti! Aggiungi i dettagli o tocca «Elabora».");
      return true;
    }
    // «Rifai»: nuovo scatto; se poi si annulla, resta valida la foto appena fatta
    async function retake(s, fromGallery) {
      const again = await capture(s, fromGallery);
      if (!again) { s.status = "ok"; s.accepted = true; save(); render(); queue(s); }
      return true;
    }
    function askRetake(s, reasons) {
      return new Promise(async res => {
        const sh = $g("gSheet"), u = await blobUrl(s.uid + ":orig");
        sh.innerHTML = `<div class="g-sheet-box" role="alertdialog" aria-label="Rifai lo scatto?">
          <img src="${u || ""}" alt=""><h3>Rifai lo scatto?</h3><ul>${reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
          <div class="g-btns"><button type="button" class="btn" data-ans="keep">Va bene così</button><button type="button" class="btn primary" data-ans="redo">Rifai</button></div></div>`;
        sh.hidden = false;
        sh.onclick = e => { const b = e.target.closest("[data-ans]"); if (!b) return; sh.hidden = true; sh.onclick = null; res(b.dataset.ans === "keep"); };
      });
    }
    async function checkFraming(s, c, st) {
      try {
        const r = await api.claude([toB64(c, 1024)], `Questa è la foto "${st.title}" di un ${preset().tipo.toLowerCase()} da vendere su Vinted.
Rispondi SOLO con JSON: {"capo":true,"box":[x0,y0,x1,y1],"tagliato":false,"dove":""}
- capo: c'è il ${preset().tipo.toLowerCase()} nella foto?
- box: riquadro che contiene l'INTERO capo (gruccia esclusa), valori da 0 a 1, 0,0 in alto a sinistra.
- tagliato: true se una parte del capo (maniche, orlo, colletto, spalle) esce dall'inquadratura.
- dove: se tagliato, dove (es. "in basso", "manica destra"), altrimenti "".`, 200);
        const box = Array.isArray(r.box) && r.box.length === 4 ? r.box.map(Number) : null;
        const touches = box && (box[0] < 0.005 || box[1] < 0.005 || box[2] > 0.995 || box[3] > 0.995) && st.id !== "cover";
        return { cut: !!r.tagliato || (r.capo === false) || !!touches, where: r.capo === false ? "non vedo il capo" : (r.dove || (touches ? "tocca il bordo" : "")), box };
      } catch (_) { return null; }   // senza rete si va avanti lo stesso
    }

    // ---------- elaborazione (in sottofondo, due alla volta) ----------
    const waiting = [];
    const resultKey = s => s.choice === "ai" ? s.uid + ":ai" : (s.kind === "main" && s.step !== "cover" ? s.uid + ":prep" : s.uid + ":orig");
    function queue(s) { if (!waiting.includes(s.uid)) waiting.push(s.uid); s.proc = "queued"; pump(); }
    function pump() {
      while (running < 2 && waiting.length) {
        const id = waiting.shift(), s = G && G.shots.find(x => x.uid === id);
        if (!s || s.status !== "ok") continue;
        running++;
        processShot(s).catch(() => {}).finally(() => { running--; save(); if (G) { if (G.stage === "process") afterProcess(); else render(); } pump(); });
      }
    }
    async function processShot(s) {
      const st = stepOf(s), c = await origCanvas(s); if (!c) return;
      s.proc = "working"; s.phase = "Sistemo luce e inquadratura"; render();
      let input = c;
      if (s.kind === "main" && s.step !== "cover") {
        // fronte/retro: raddrizza (angolo del capo) e ritaglia attorno al cappotto
        const t = s.tilt != null ? s.tilt : Q.tilt(c);
        const tiltFix = t != null && Math.abs(t) >= 0.8 && Math.abs(t) <= 10 ? t : 0;
        s.straightened = tiltFix;
        input = prepare(c, tiltFix, s.box);
        await setBlob(s.uid + ":prep", await toBlob(input, "image/jpeg", 0.92));
      }
      if (s.kind === "main" && st.ai && G.mode === "ai" && api.keys().openai) {
        const ok = await runAi(s);
        if (!ok) s.choice = "local";
      } else {
        s.choice = "local";
      }
      s.proc = "done"; s.phase = "";
    }

    // Regista (Claude) + Fotografo (OpenAI) dalla foto ORIGINALE: sintesi, conferma, 1 scatto, controllo.
    // L'esito del regista sostituisce il prima/dopo: la scelta (Usa questa / Tieni l'originale) è già fatta lì.
    async function runAi(s) {
      const st = stepOf(s), cover = s.step === "cover";
      const raw = await DB.get(s.uid + ":raw") || await DB.get(s.uid + ":orig");
      s.ai = "working"; s.phase = "Il regista prepara lo scatto"; render();
      try {
        const r = await api.directorRun({ raw, kind: s.step, title: (cover ? "Copertina" : st.short) + " con AI", useRef: cover && !!(await api.styleRef()) });
        if (r.choice === "ai" && r.blob) {
          await setBlob(s.uid + ":ai", r.blob);
          s.director = r.record; s.ai = "done"; s.choice = "ai"; s.aiErr = ""; G.reviewed[s.uid] = true;
          return true;
        }
        s.ai = "skipped"; s.aiErr = "";
        return false;
      } catch (e) {
        s.ai = "error"; s.aiErr = e.message || "Non riuscito";
        return false;
      }
    }

    // ---------- 3. elaborazione ----------
    function finalOrder() {
      const rank = s => (stepOf(s) || {}).order || 9;
      return G.shots.filter(s => s.status === "ok").sort((a, b) => rank(a) - rank(b) || a.at - b.at);
    }
    function renderProcess() {
      const list = finalOrder(), labels = details().some(s => s.status === "ok" && stepOf(s).label);
      $g("gBody").innerHTML = `<h2 class="g-h">Elaborazione</h2>
        <p class="g-lead">${G.mode === "ai" ? "Raddrizzo, ritaglio e pulisco le foto. La copertina diventa una foto da studio." : "Sistemo luce, colori e ritaglio sul telefono."} I dettagli restano foto reali.</p>
        <ul class="g-plist">${list.map((s, i) => { const st = stepOf(s), w = s.proc === "working" || s.proc === "queued";
          return `<li class="${w ? "working" : ""}${s.proc === "done" ? " done" : ""}"><span class="g-pthumb">${thumbHtml(s, "")}<i class="ring" aria-hidden="true"></i></span>
            <div><strong>${i + 1}. ${esc(st.short || st.title)}</strong><small>${esc(s.proc === "done" ? (s.ai === "done" ? "Pronta con AI ✦ (approvata da te)" : s.ai === "error" ? "AI non riuscita: " + s.aiErr + " – uso la sistemazione locale" : s.ai === "skipped" ? "Pronta (senza AI)" : "Pronta") : s.proc === "working" ? (s.phase || "In lavorazione…") : "In coda")}</small></div></li>`; }).join("")}
          ${labels ? `<li class="${G.labelsState === "working" ? "working" : G.labelsState === "done" ? "done" : ""}"><span class="g-pthumb g-picon">🏷️<i class="ring"></i></span>
            <div><strong>Lettura etichette</strong><small>${esc(labelSummary())}</small></div></li>` : ""}
          <li class="${G.writing ? "working" : G.textDone ? "done" : ""}"><span class="g-pthumb g-picon">✍️<i class="ring"></i></span>
            <div><strong>Annuncio</strong><small>${G.writing ? "Scrivo titolo, descrizione e hashtag…" : G.textDone ? "Pronto" : "Dopo le foto"}</small></div></li>
        </ul>`;
      $g("gFoot").innerHTML = `<button type="button" class="btn" data-act="back">← Torna agli scatti</button>`;
      fillThumbs();
    }
    function labelSummary() {
      if (G.labelsState === "working") return "Leggo marca, taglia e composizione…";
      const l = G.labels; if (!l) return G.labelsState === "error" ? "Non riuscita: compila a mano nei Dettagli" : "In coda";
      return [l.marca, l.taglia, l.composizione].filter(Boolean).join(" · ") || "Niente di leggibile";
    }
    async function readLabels() {
      if (!api.keys().claude) return;
      const ls = details().filter(s => s.status === "ok" && stepOf(s).label);
      if (!ls.length) return;
      // una lettura alla volta: se arriva un'altra etichetta nel frattempo, si rilegge alla fine
      if (G.labelsState === "working") { G.labelsAgain = true; return; }
      G.labelsState = "working"; G.labelsAgain = false; render();
      try {
        const imgs = []; for (const s of ls) { const c = await origCanvas(s); if (c) imgs.push(toB64(c, 1400)); }
        const r = await api.claude(imgs, `Sono foto delle etichette di un ${preset().tipo.toLowerCase()} (marca, taglia, composizione).
Leggi SOLO ciò che è scritto davvero, senza inventare. Rispondi SOLO con JSON:
{"marca":"","taglia_letta":"","taglia":"","composizione":"","materiale":""}
- taglia: nel formato italiano, es. "TG. 52" → "IT 52", "Taglia 46" → "IT 46"; taglie a lettere restano così (es. "M").
- composizione: percentuali dei tessuti esterni, es. "80% lana, 20% cashmere".
- materiale: forma breve per il titolo, es. "lana e cashmere".
Usa "" per ciò che non è leggibile.`, 300);
        G.labels = { marca: (r.marca || "").trim(), taglia: (r.taglia || r.taglia_letta || "").trim(), composizione: (r.composizione || "").trim(), materiale: (r.materiale || "").trim() };
        const d = {}, auto = [];
        if (G.labels.marca) { d.brand = G.labels.marca; auto.push("brand"); }
        if (G.labels.taglia) { d.size = G.labels.taglia; auto.push("size"); }
        if (G.labels.composizione || G.labels.materiale) { d.material = G.labels.composizione || G.labels.materiale; auto.push("material"); }
        api.setDetails(d, auto);
        G.labelsState = "done";
      } catch (_) { G.labelsState = "error"; }
      save(); render();
      if (G.labelsAgain) { G.labelsAgain = false; G.labelsState = null; return readLabels(); }
      if (G.stage === "process") afterProcess();
    }
    async function startProcess() {
      G.stage = "process"; save();
      G.shots.filter(s => s.status === "ok" && s.proc !== "done" && s.proc !== "working").forEach(queue);
      if (!G.labels && G.labelsState !== "working") readLabels();
      render(); afterProcess();
    }
    function afterProcess() {
      if (!G || G.stage !== "process") return;
      render();
      const busy = G.shots.some(s => s.status === "ok" && s.proc !== "done") || G.labelsState === "working";
      if (busy) return;
      const toReview = G.shots.filter(s => s.ai === "done" && !G.reviewed[s.uid]);
      if (toReview.length) { G.stage = "review"; save(); render(); }
      else finalize();
    }

    // ---------- 4. prima / dopo ----------
    function renderReview() {
      const list = G.shots.filter(s => s.ai === "done" || (s.ai === "working" && !G.reviewed[s.uid]));
      const s = list.find(x => !G.reviewed[x.uid]) || list[0];
      if (!s) { finalize(); return; }
      const i = list.indexOf(s), st = stepOf(s), before = s.uid + ":orig", after = s.uid + (s.pick === 2 ? ":ai2" : ":ai");
      $g("gBody").innerHTML = `<h2 class="g-h">Prima / dopo <small>${i + 1} di ${list.length}</small></h2>
        <p class="g-lead">${esc(st.title)}: trascina la linea per confrontare. Controlla che il capo sia identico (colore, bottoni, difetti).</p>
        <div class="g-cmp${s.ai === "working" ? " working" : ""}" id="gCmp" style="--x:50%">
          <img data-k="${before}" alt="Prima">
          <div class="g-after"><img data-k="${after}" alt="Dopo"></div>
          <span class="g-tag l">Prima</span><span class="g-tag r">Dopo · AI</span>
          <div class="g-handle" aria-hidden="true"><span></span></div>
          <i class="ring" aria-hidden="true"></i>
        </div>
        <input type="range" min="0" max="100" value="50" id="gCmpRange" aria-label="Confronto prima e dopo">
        ${s.variants > 1 ? `<div class="g-vseg"><div class="seg" role="group" aria-label="Variante">
          <button type="button" data-act="variant" data-v="1" data-uid="${s.uid}" aria-pressed="${s.pick !== 2}">Variante 1</button>
          <button type="button" data-act="variant" data-v="2" data-uid="${s.uid}" aria-pressed="${s.pick === 2}">Variante 2</button></div></div>` : ""}`;
      $g("gFoot").innerHTML = `<div class="g-rev">
          <button type="button" class="btn" data-act="keeporig" data-uid="${s.uid}">Tieni l'originale</button>
          <button type="button" class="btn" data-act="redoai" data-uid="${s.uid}" ${s.ai === "working" ? "disabled" : ""}>Rifai</button>
          <button type="button" class="btn primary" data-act="useai" data-uid="${s.uid}" ${s.ai === "working" ? "disabled" : ""}>Usa questa</button></div>`;
      root.querySelectorAll("#gCmp img[data-k]").forEach(async img => { const u = await blobUrl(img.dataset.k); if (u) img.src = u; });
      const cmp = $g("gCmp"), rng = $g("gCmpRange");
      const setX = v => { cmp.style.setProperty("--x", v + "%"); rng.value = v; };
      rng.addEventListener("input", () => setX(rng.value));
      const drag = e => { const r = cmp.getBoundingClientRect(); setX(Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100))); };
      cmp.addEventListener("pointerdown", e => { cmp.setPointerCapture(e.pointerId); drag(e); });
      cmp.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "touch") drag(e); });
    }
    async function redoAi(s) {
      const ok = await runAi(s);
      if (!ok && s.ai !== "error") { s.choice = "local"; }
      save(); render();
    }

    // ---------- 5. ordine, griglia e annuncio ----------
    async function finalize() {
      if (G.finalizing) return;
      G.finalizing = true; G.stage = "process"; G.writing = true; save(); render();
      try {
        const list = finalOrder(), entries = [];
        for (const s of list) {
          const st = stepOf(s);
          const useAi = s.choice === "ai" && await DB.get(s.uid + (s.pick === 2 ? ":ai2" : ":ai"));
          const main = useAi || await DB.get(resultKey(Object.assign({}, s, { choice: "local" })));
          const orig = await DB.get(s.uid + ":orig");
          entries.push({
            blob: main || orig, origBlob: useAi ? orig : null, rawBlob: await DB.get(s.uid + ":raw"), director: useAi ? s.director : null,
            name: (st.short || st.title || "foto").toLowerCase().replace(/\W+/g, "-") + ".jpg",
            ai: !!useAi, step: s.kind === "main" ? s.step : "detail:" + s.type,
            box: !useAi && s.kind === "main" && s.step === "cover" ? s.box : null,
            straightened: !!s.straightened
          });
        }
        await api.replaceGrid(entries);
        const anyAiCover = list.some(s => s.step === "cover" && s.choice === "ai");
        const r = await api.writeListing(listingRules(anyAiCover));
        G.textDone = true; G.note = r && r.note || "";
      } catch (e) { G.note = e.message || ""; }
      G.writing = false; G.finalizing = false; G.stage = "ready"; save(); render();
    }
    function listingRules(aiCover) {
      const p = preset(), l = G.labels || {};
      return [
        `Questo è un ${p.tipo.toLowerCase()}.`,
        `- titolo nello stile: ${p.listing.titleStyle}. Usa solo dati certi (marca, materiali e taglia letti dall'etichetta o indicati dal venditore).`,
        l.composizione ? `- composizione letta dall'etichetta: ${l.composizione}.` : "",
        "- descrizione: includi materiale/composizione, taglia, misure in cm (se date), condizioni e difetti visibili o indicati.",
        aiCover ? `- chiudi la descrizione con questa riga esatta: "${p.listing.honestNote}"` : "",
        "- l'ordine delle foto è: copertina, fronte, retro, etichette, dettagli, difetti, misure."
      ].filter(Boolean).join("\n");
    }

    // ---------- 6. annuncio pronto ----------
    function renderReady() {
      const t = api.textNow(), list = finalOrder();
      $g("gBody").innerHTML = `<div class="g-ready"><span class="g-ok">✓</span><h2 class="g-h">Annuncio pronto</h2>
          <p class="g-lead">Foto già nell'ordine giusto per Vinted. Puoi cambiarlo in Home trascinando.</p></div>
        <div class="g-strip">${list.map((s, i) => `<figure>${thumbHtml(s, "")}<figcaption>${i + 1}${s.choice === "ai" ? " · ✦ AI" : ""}</figcaption></figure>`).join("")}</div>
        ${t ? `<div class="g-text"><strong>${esc(t.titolo)}</strong><p>${esc(t.descrizione)}</p><span class="hint">${esc((t.hashtag || []).join(" "))}</span></div>` : ""}
        ${G.note ? `<p class="g-note">${esc(G.note)}</p>` : ""}
        <div class="status" id="gStatus" role="status"></div>`;
      root.querySelectorAll(".g-strip img[data-thumb]").forEach(img => { img.dataset.which = "result"; });
      $g("gFoot").innerHTML = `<div class="g-final">
          <button type="button" class="btn primary" data-act="copy">Copia testo</button>
          <button type="button" class="btn" data-act="savephotos">Salva foto in ordine</button>
          <button type="button" class="btn" data-act="share">Condividi</button>
          <button type="button" class="linkbtn" data-act="tohome">Apri in Home per modificare</button></div>`;
      fillThumbs();
    }

    // ---------- avvisi ----------
    function toast(msg) {
      let t = document.getElementById("gToast");
      if (!t) { t = document.createElement("div"); t.id = "gToast"; t.setAttribute("role", "status"); document.body.append(t); }
      t.textContent = msg; t.classList.remove("show"); void t.offsetWidth; t.classList.add("show");
      clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3200);
    }

    // ---------- pulsanti ----------
    async function onClick(e) {
      const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
      const act = b.dataset.act, s = b.dataset.uid && G && G.shots.find(x => x.uid === b.dataset.uid);
      switch (act) {
        case "close": hide(); api.onClose && api.onClose(); break;
        case "resume": G = load(); if (G) { G.finalizing = false; G.writing = false; if (G.fields) api.setDetails(G.fields, G.fields._auto || []); api.setCategory(preset().cat); resumeWork(); } render(); break;
        case "pick": startPreset(b.dataset.preset); break;
        case "mode": G.mode = b.dataset.v; save(); render(); break;
        case "shoot": if (s) await capture(s, false); break;
        case "gallery": if (s) await capture(s, true); break;
        case "adddetail": G.detailPick = "*"; render(); break;
        case "picktype": G.detailPick = b.dataset.type; render(); break;
        case "canceldetail": G.detailPick = null; render(); break;
        case "shootdetail": case "gallerydetail": {
          const d = { uid: uid(), kind: "detail", type: b.dataset.type, status: "empty", issues: [], ai: "none", choice: "local", proc: "idle", at: Date.now() };
          G.shots.push(d); G.detailPick = null;
          const ok = await capture(d, act === "gallerydetail");
          if (!ok && d.status === "empty") G.shots = G.shots.filter(x => x !== d);
          save(); render(); break;
        }
        case "remove": if (s) { G.shots = G.shots.filter(x => x !== s); ["orig", "ai", "prep"].forEach(k => DB.del(s.uid + ":" + k)); save(); render(); } break;
        case "process": startProcess(); break;
        case "back": G.stage = "steps"; save(); render(); break;
        case "variant": if (s) { s.pick = Number(b.dataset.v); save(); render(); } break;
        case "useai": if (s) { s.choice = "ai"; G.reviewed[s.uid] = true; save(); next(); } break;
        case "keeporig": if (s) { s.choice = "local"; G.reviewed[s.uid] = true; save(); next(); } break;
        case "redoai": if (s) redoAi(s); break;
        case "copy": { const ok = await api.copyText(); $g("gStatus").textContent = ok ? "Testo copiato ✓ Incollalo su Vinted." : "Copia non riuscita: apri in Home e copia da lì."; break; }
        case "savephotos": $g("gStatus").textContent = "Salvo…"; $g("gStatus").textContent = await api.saveAll(); break;
        case "share": $g("gStatus").textContent = await api.shareAll(); break;
        case "tohome": hide(); await clearSession(); api.showTab("home"); api.onClose && api.onClose(); break;
      }
    }
    function next() {
      const left = G.shots.filter(s => s.ai === "done" && !G.reviewed[s.uid]);
      if (left.length) render(); else finalize();
    }
    function resumeWork() {
      if (G.stage === "process") { G.shots.forEach(s => { if (s.proc === "working" || s.proc === "queued") s.proc = "idle"; }); startProcess(); }
      else if (G.stage === "steps") G.shots.forEach(s => { if (s.status === "ok" && s.proc !== "done") queue(s); else if (s.status === "checking" || s.status === "framing") s.status = "ok"; });
      if (G.labelsState === "working") G.labelsState = null;
    }

    // ---------- avvio ----------
    function open() { if (!G) { const saved = load(); if (saved && saved.stage === "ready") { G = saved; } } show(); }
    function init() {
      const saved = load();
      if (saved && saved.stage !== "ready" && saved.stage !== "pick") {
        // ripresa automatica dal punto in cui si era
        G = saved; G.finalizing = false; G.writing = false;
        if (G.fields) api.setDetails(G.fields, G.fields._auto || []);
        api.setCategory(preset().cat);
        resumeWork(); show();
        toast("Ripreso il servizio guidato da dove eri rimasto.");
        return true;
      }
      return false;
    }
    function newSession() { G = null; show(); }
    return { open: newSession, resume: open, init, get active() { return !!G; }, hasSaved: () => { const s = load(); return !!(s && s.stage !== "ready" && s.stage !== "pick"); } };
  };
})();
