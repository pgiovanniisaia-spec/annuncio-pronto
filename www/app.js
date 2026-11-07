(() => {
"use strict";
const $ = id => document.getElementById(id);
const MAX = 20;          // foto per annuncio, come Vinted
const AI_PHOTOS = 5;     // foto inviate a Claude (le prime)
const WORK_SIDE = 1500;  // larghezza di decodifica della copia di lavoro
const S = { items: [], cat: "Scarpe", tone: "amichevole", fmt: "34", writing: false, text: null, histId: null };
let nextId = 1;

// ---------- plugin nativi (Capacitor) ----------
const Cap = window.Capacitor;
const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const Filesystem = native ? Cap.registerPlugin("Filesystem") : null;
const Share = native ? Cap.registerPlugin("Share") : null;

// ---------- impostazioni ----------
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
};
let apiKey = store.get("ap_key", "");
let model = store.get("ap_model", "claude-haiku-5-5");

function segSet(id, v) { [...$(id).children].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v))); }
function seg(id, onPick) {
  $(id).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    segSet(id, b.dataset.v); onPick(b.dataset.v);
  });
}
$("openSettings").onclick = () => {
  const p = $("settings"); p.hidden = !p.hidden;
  if (!p.hidden) { $("apiKey").value = apiKey; segSet("model", model); p.scrollIntoView({ block: "start" }); }
};
let pendingModel = model;
seg("model", v => { pendingModel = v; });
$("saveSettings").onclick = () => {
  apiKey = $("apiKey").value.trim(); model = pendingModel;
  store.set("ap_key", apiKey); store.set("ap_model", model);
  $("settings").hidden = true;
  setStatus(apiKey ? "Impostazioni salvate." : "Impostazioni salvate. Senza chiave preparo solo una bozza semplice.");
};
if (!apiKey) $("settings").hidden = false;

const sizeHints = { Scarpe: "es. 42 EU", Abbigliamento: "es. M o 44 IT", Capispalla: "es. L o 50 IT" };
seg("cat", v => { S.cat = v; $("size").placeholder = sizeHints[v]; });
seg("tone", v => { S.tone = v; });
seg("fmt", v => { S.fmt = v; $("grid").classList.toggle("square", v === "11"); rerenderAll(); });
$("whiten").addEventListener("change", rerenderAll);

function setStatus(msg, err) { const s = $("status"); s.textContent = msg; s.classList.toggle("err", !!err); }

// ---------- worker pool ----------
const pool = [];
const pending = new Map();
let jobSeq = 0, rr = 0;
try {
  const n = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
  for (let i = 0; i < n; i++) {
    const w = new Worker("worker.js");
    w.onmessage = e => { const cb = pending.get(e.data.job); if (cb) { pending.delete(e.data.job); cb(e.data); } };
    pool.push(w);
  }
} catch (_) { /* senza worker si lavora sul thread principale */ }

function enhanceAsync(img, whiten) {
  if (!pool.length) { enhancePixels(img.data, img.width, img.height, whiten); return Promise.resolve(img); }
  return new Promise(res => {
    const job = ++jobSeq;
    pending.set(job, d => res(new ImageData(new Uint8ClampedArray(d.buf), d.w, d.h)));
    pool[rr++ % pool.length].postMessage({ job, buf: img.data.buffer, w: img.width, h: img.height, whiten }, [img.data.buffer]);
  });
}

// coda: massimo 3 foto decodificate insieme, per non saturare la memoria
let active = 0; const queue = [];
function enqueue(fn) { return new Promise((res, rej) => { queue.push(() => fn().then(res, rej)); pump(); }); }
function pump() { while (active < 3 && queue.length) { active++; queue.shift()().finally(() => { active--; pump(); }); } }

// ---------- aggiunta foto ----------
const drop = $("drop"), fileInput = $("file");
drop.addEventListener("click", () => fileInput.click());
["dragover", "dragenter"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, () => drop.classList.remove("over")));
drop.addEventListener("drop", e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
fileInput.addEventListener("change", () => { const f = [...(fileInput.files || [])]; fileInput.value = ""; addFiles(f); });

function addFiles(list) {
  // Su Android il selettore spesso restituisce file senza tipo né estensione: li accettiamo e
  // lasciamo decidere alla decodifica.
  const files = [...list].filter(f => !f.type || f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || ""));
  if (!files.length) { setStatus("Nessuna foto ricevuta. Riprova scegliendo dalla Galleria.", true); return; }
  let skipped = 0;
  $("status").classList.remove("err");
  for (const f of files) {
    if (S.items.length >= MAX) { skipped++; continue; }
    const it = { id: nextId++, file: f, rot: 0, box: null, boxRot: 0, src: null, ver: 0, out: null, outPromise: null };
    S.items.push(it); makeTile(it);
    enqueue(() => prepare(it).then(() => { drawTile(it, rotated(it.src, it.rot)); return renderItem(it); })).catch(() => failTile(it));
  }
  refresh();
  if (skipped) setStatus(`Massimo ${MAX} foto: ${skipped} non aggiunte.`, true);
}

async function loadBitmap(file) {
  // Decodifica già ridotta: molto più veloce delle foto da 12+ megapixel.
  try { return await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: WORK_SIDE, resizeQuality: "medium" }); } catch (_) {}
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) {}
  return await new Promise((res, rej) => {
    const im = new Image(); const u = URL.createObjectURL(file);
    im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("decode")); }; im.src = u;
  });
}
async function prepare(it) {
  const bmp = await loadBitmap(it.file);
  const k = Math.min(1, (WORK_SIDE * 4 / 3) / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  it.src = c;
}

// ---------- ritaglio e correzione ----------
function rotated(src, rot) {
  const r = ((rot % 360) + 360) % 360;
  if (!r) return src;
  const c = document.createElement("canvas");
  c.width = r % 180 ? src.height : src.width; c.height = r % 180 ? src.width : src.height;
  const x = c.getContext("2d");
  x.translate(c.width / 2, c.height / 2); x.rotate(r * Math.PI / 180);
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}
function rotateBox(b, deg) {
  let r = ((deg % 360) + 360) % 360, box = b;
  while (r > 0) { const [x0, y0, x1, y1] = box; box = [1 - y1, x0, 1 - y0, x1]; r -= 90; }
  return box;
}
function validBox(b) {
  return Array.isArray(b) && b.length === 4 && b.every(v => typeof v === "number" && isFinite(v)) &&
    b[2] - b[0] > 0.15 && b[3] - b[1] > 0.15;
}
function borderColor(c) {
  const s = document.createElement("canvas"); s.width = 48; s.height = 48;
  const x = s.getContext("2d"); x.drawImage(c, 0, 0, 48, 48);
  const d = x.getImageData(0, 0, 48, 48).data, R = [], G = [], B = [];
  for (let i = 0; i < 48; i++) for (const [px, py] of [[i, 0], [i, 47], [0, i], [47, i]]) {
    const k = (py * 48 + px) * 4; R.push(d[k]); G.push(d[k + 1]); B.push(d[k + 2]);
  }
  const med = a => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(R), med(G), med(B)];
}

async function renderItem(it) {
  if (!it.src) return;
  const v = ++it.ver;
  setWorking(it, true);
  const Src = rotated(it.src, it.rot), W = Src.width, H = Src.height;
  const OW = 1200, OH = S.fmt === "34" ? 1600 : 1200, A = OW / OH;
  let rx, ry, rw, rh;
  const box = validBox(it.box) ? rotateBox(it.box.map(n => Math.min(1, Math.max(0, n))), it.rot - it.boxRot) : null;
  if (box) {
    let bx0 = box[0] * W, by0 = box[1] * H, bx1 = box[2] * W, by1 = box[3] * H;
    const pad = 0.09 * Math.max(bx1 - bx0, by1 - by0);
    bx0 -= pad; by0 -= pad; bx1 += pad; by1 += pad;
    let bw = bx1 - bx0, bh = by1 - by0;
    if (bw / bh > A) bh = bw / A; else bw = bh * A;
    rw = bw; rh = bh; rx = (bx0 + bx1) / 2 - rw / 2; ry = (by0 + by1) / 2 - rh / 2;
  } else {
    if (W / H > A) { rh = H; rw = H * A; } else { rw = W; rh = W / A; }
    rx = (W - rw) / 2; ry = (H - rh) / 2;
  }
  rx = rw <= W ? Math.min(Math.max(rx, 0), W - rw) : (W - rw) / 2;
  ry = rh <= H ? Math.min(Math.max(ry, 0), H - rh) : (H - rh) / 2;

  const out = document.createElement("canvas"); out.width = OW; out.height = OH;
  const x = out.getContext("2d");
  const bg = borderColor(Src);
  x.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`; x.fillRect(0, 0, OW, OH);
  const sx0 = Math.max(0, rx), sy0 = Math.max(0, ry), sx1 = Math.min(W, rx + rw), sy1 = Math.min(H, ry + rh), k = OW / rw;
  x.imageSmoothingQuality = "high";
  x.drawImage(Src, sx0, sy0, sx1 - sx0, sy1 - sy0, (sx0 - rx) * k, (sy0 - ry) * k, (sx1 - sx0) * k, (sy1 - sy0) * k);
  drawTile(it, out); // il nuovo taglio si vede subito

  const img = await enhanceAsync(x.getImageData(0, 0, OW, OH), $("whiten").checked);
  if (v !== it.ver || !S.items.includes(it)) return;
  x.putImageData(img, 0, 0);
  drawTile(it, out);
  saveProcessed(it);
  setWorking(it, false);
  it.el.classList.remove("done"); void it.el.offsetWidth; it.el.classList.add("done");
  // il JPG finale si prepara in sottofondo, serve solo per salvare o condividere
  it.out = null;
  it.outPromise = new Promise(r => out.toBlob(r, "image/jpeg", 0.92)).then(b => { if (v === it.ver) { it.out = b; refresh(); } return b; });
  refresh();
}

let rerenderTimer = 0;
function rerenderAll() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => S.items.forEach(it => { if (it.src) enqueue(() => renderItem(it)); }), 80);
}

// ---------- griglia ----------
const TILE_W = 240;
function tileH() { return S.fmt === "34" ? 320 : 240; }
function drawTile(it, source) {
  const c = it.cv, h = tileH();
  if (c.width !== TILE_W || c.height !== h) { c.width = TILE_W; c.height = h; }
  const x = c.getContext("2d"), s = Math.max(TILE_W / source.width, h / source.height);
  const w = source.width * s, hh = source.height * s;
  x.imageSmoothingQuality = "medium";
  x.drawImage(source, (TILE_W - w) / 2, (h - hh) / 2, w, hh);
  it.el.classList.add("has-img");
}
function saveProcessed(it) {
  const p = it.proc || (it.proc = document.createElement("canvas"));
  p.width = it.cv.width; p.height = it.cv.height; p.getContext("2d").drawImage(it.cv, 0, 0);
}
function makeTile(it) {
  const t = document.createElement("div"); t.className = "tile working";
  t.style.animationDelay = Math.min(S.items.length - 1, 10) * 30 + "ms";
  const cv = document.createElement("canvas"); cv.width = TILE_W; cv.height = tileH();
  const badge = document.createElement("span"); badge.className = "badge";
  const x = document.createElement("button"); x.type = "button"; x.className = "ico x"; x.textContent = "×"; x.setAttribute("aria-label", "Rimuovi foto");
  const r = document.createElement("button"); r.type = "button"; r.className = "ico rot"; r.textContent = "↻"; r.setAttribute("aria-label", "Ruota foto");
  x.onclick = e => { e.stopPropagation(); removeItem(it); };
  r.onclick = e => {
    e.stopPropagation(); it.rot = (it.rot + 90) % 360;
    r.classList.remove("spin"); void r.offsetWidth; r.classList.add("spin");
    enqueue(() => renderItem(it));
  };
  // tieni premuto per vedere l'originale
  let holding = false;
  const showOrig = on => {
    if (!it.proc || !it.src || holding === on) return;
    holding = on;
    drawTile(it, on ? rotated(it.src, it.rot) : it.proc);
    badge.textContent = on ? "Originale" : label(it);
  };
  t.addEventListener("pointerdown", e => { if (e.target === t || e.target === cv) showOrig(true); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => t.addEventListener(ev, () => showOrig(false)));
  t.addEventListener("contextmenu", e => e.preventDefault());
  t.append(cv, badge, x, r);
  it.el = t; it.cv = cv; it.badge = badge;
  $("grid").append(t);
}
function label(it) { return S.items[0] === it ? "Copertina" : String(S.items.indexOf(it) + 1); }
function setWorking(it, on) { it.el && it.el.classList.toggle("working", on); }
function failTile(it) {
  setWorking(it, false); it.el.classList.add("failed");
  setStatus("Una foto non si apre (formato non supportato). Toccala con × e prova con un'altra.", true);
  it.badge.textContent = "Errore";
}
function removeItem(it) {
  it.ver++; S.items = S.items.filter(x => x !== it);
  it.el.classList.add("leaving");
  setTimeout(() => it.el.remove(), 180);
  refresh();
}
function refresh() {
  S.items.forEach(it => { if (!it.el.classList.contains("failed")) it.badge.textContent = label(it); });
  const n = S.items.length, ready = S.items.filter(i => i.proc && !i.el.classList.contains("working")).length;
  const c = $("count"); const txt = `${n} / ${MAX}`;
  if (c.textContent !== txt) { c.textContent = txt; c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); }
  $("photoTools").hidden = !ready;
  $("go").disabled = !n || S.writing;
  if (!S.writing && !$("status").classList.contains("err")) {
    setStatus(!n ? "Aggiungi almeno una foto per iniziare." : ready < n ? `Sistemo le foto… ${ready} di ${n}` : `${n} ${n === 1 ? "foto pronta" : "foto pronte"}. Ora puoi scrivere l'annuncio.`);
  }
}

// ---------- salvataggio e condivisione ----------
const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(b); });
const fname = i => `vinted-${String(i + 1).padStart(2, "0")}.jpg`;

async function writeAll(directory, folder) {
  const uris = [];
  const blobs = (await Promise.all(S.items.map(i => i.outPromise))).filter(Boolean);
  for (let i = 0; i < blobs.length; i++) {
    const r = await Filesystem.writeFile({ path: `${folder}/${fname(i)}`, data: await blobToB64(blobs[i]), directory, recursive: true });
    uris.push(r.uri);
  }
  return uris;
}
$("shareAll").onclick = async () => {
  if (!native) return browserDownload();
  try {
    setStatus("Preparo le foto…");
    const files = await writeAll("CACHE", "condividi");
    await Share.share({ title: "Foto annuncio", files });
    setStatus("Foto condivise.");
  } catch (e) {
    if (!/cancel/i.test(String(e && e.message))) setStatus("Condivisione non riuscita. Prova «Salva nel telefono».", true);
    else refresh();
  }
};
$("saveAll").onclick = async () => {
  if (!native) return browserDownload();
  try {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    await writeAll("DOCUMENTS", `AnnuncioPronto/${stamp}`);
    setStatus(`Foto salvate in Documenti › AnnuncioPronto › ${stamp}`);
  } catch (_) { setStatus("Salvataggio non riuscito. Usa «Condividi tutte» e scegli Google Foto o File.", true); }
};
async function browserDownload() {
  const blobs = (await Promise.all(S.items.map(i => i.outPromise))).filter(Boolean);
  blobs.forEach((b, i) => {
    const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = fname(i); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  });
}

// ---------- testo con Claude ----------
function buildPrompt(n) {
  const brand = $("brand").value.trim(), size = $("size").value.trim(), notes = $("notes").value.trim();
  return `Sei un venditore esperto su Vinted Italia. Ti mostro ${n} foto dello STESSO articolo usato da vendere.
Categoria: ${S.cat}
Marca indicata dal venditore: ${brand || "non indicata"}
Taglia: ${size || "non indicata"}
Condizioni: ${$("cond").value}
Note del venditore: ${notes || "nessuna"}
Tono: ${S.tone === "amichevole" ? "amichevole e caldo, come una persona reale, senza esagerare" : "essenziale e ordinato, frasi brevi"}

Regole:
- Scrivi in italiano. Non inventare marca, materiale o misure: usali solo se indicati dal venditore o chiaramente leggibili in foto (logo, etichetta). Se un dettaglio non è certo, non scriverlo.
- titolo: massimo 60 caratteri, con tipo di capo, colore, marca (se nota) e taglia (se nota). Niente emoji, niente maiuscolo.
- descrizione: 4-8 righe. Prima cosa è, colore, stile e dettagli visibili; poi una riga "Taglia: ..." e una riga "Condizioni: ..." se note; includi i difetti indicati nelle note; chiudi con una frase cortese su spedizione o domande. Niente segnaposto tra parentesi.
- hashtag: da 4 a 6, minuscoli, senza spazi, pertinenti.
- controlli: cose da verificare prima di pubblicare (possibili macchie o segni visti in foto, marca non leggibile). Lista vuota se nulla.
- box: per OGNI foto, nell'ordine, il riquadro che contiene l'intero articolo (per le scarpe tutto il paio visibile) come [x0,y0,x1,y1] con valori da 0 a 1 (0,0 in alto a sinistra). Se l'articolo riempie già la foto usa [0,0,1,1].

Rispondi SOLO con JSON:
{"titolo":"...","descrizione":"...","hashtag":["#..."],"controlli":["..."],"box":[[0.1,0.05,0.9,0.95]]}`;
}

function aiImage(it) {
  const Src = rotated(it.src, it.rot);
  const k = Math.min(1, 1024 / Math.max(Src.width, Src.height));
  const c = document.createElement("canvas"); c.width = Math.round(Src.width * k); c.height = Math.round(Src.height * k);
  c.getContext("2d").drawImage(Src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85).split(",")[1];
}

async function askClaude(items) {
  const content = items.map(it => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: aiImage(it) } }));
  content.push({ type: "text", text: buildPrompt(items.length) });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: "user", content }] })
  });
  if (!res.ok) { const e = new Error("http"); e.status = res.status; throw e; }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("json");
  return JSON.parse(text.slice(a, b + 1));
}

function errMsg(e) {
  if (e.status === 401 || e.status === 403) return "Chiave API non valida: controllala in Impostazioni.";
  if (e.status === 429) return "Troppe richieste ravvicinate: riprova tra un minuto.";
  if (e.status === 400) return "Richiesta rifiutata. Controlla credito e modello su console.anthropic.com.";
  if (e.status === 529 || e.status >= 500) return "Il servizio è occupato: riprova tra poco.";
  if (e.message === "json") return "Risposta non leggibile: premi di nuovo «Scrivi l'annuncio».";
  return "Nessuna connessione. Ho preparato una bozza semplice.";
}

function fallbackText() {
  const brand = $("brand").value.trim(), size = $("size").value.trim(), notes = $("notes").value.trim();
  const tipo = { Scarpe: "Scarpe", Abbigliamento: "Capo", Capispalla: "Giacca" }[S.cat];
  const cond = $("cond").value;
  return {
    titolo: [tipo, brand, size && ("taglia " + size)].filter(Boolean).join(" "),
    descrizione: [
      `${tipo}${brand ? " " + brand : ""} in ${cond.toLowerCase()}.`,
      ...(notes ? [notes] : []),
      ...(size ? [`Taglia: ${size}`] : []),
      `Condizioni: ${cond.toLowerCase()}`,
      "",
      "Spedisco con cura. Per qualsiasi domanda scrivimi pure!"
    ].join("\n"),
    hashtag: ["#" + S.cat.toLowerCase(), brand && "#" + brand.toLowerCase().replace(/\s+/g, "")].filter(Boolean),
    controlli: []
  };
}

$("go").onclick = async () => {
  if (S.writing || !S.items.length) return;
  const ready = S.items.filter(i => i.src).slice(0, AI_PHOTOS);
  if (!ready.length) { setStatus("Aspetta che le foto siano pronte.", true); return; }
  S.writing = true; $("go").disabled = true;
  $("resText").hidden = false;
  $("resText").classList.remove("show"); void $("resText").offsetWidth; $("resText").classList.add("show");
  $("out").innerHTML = '<div class="skel"><i></i><i></i><i></i><i></i></div>';
  $("resText").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  let ai = null, note = "";
  if (!apiKey) note = "Aggiungi la chiave API in Impostazioni per la descrizione automatica. Intanto ecco una bozza.";
  else {
    setStatus("Claude guarda le foto e scrive…");
    try { ai = await askClaude(ready); } catch (e) { note = errMsg(e); }
  }
  if (ai && Array.isArray(ai.box)) {
    ai.box.forEach((b, i) => { const it = ready[i]; if (it && S.items.includes(it)) { it.box = b; it.boxRot = it.rot; enqueue(() => renderItem(it)); } });
  }
  const text = ai && ai.titolo && ai.descrizione ? ai : fallbackText();
  S.text = text;
  S.histId = saveHistory(text, S.histId);
  renderText(text, S.histId);
  S.writing = false;
  $("status").classList.remove("err");
  if (note) setStatus(note, true); else { setStatus("Fatto. Condividi le foto e copia il testo su Vinted."); }
  $("go").disabled = false; $("go").textContent = "Riscrivi l'annuncio";
  $("reset").hidden = false;
};

function mkBtn(text, fn, cls) { const b = document.createElement("button"); b.type = "button"; b.className = "btn small" + (cls ? " " + cls : ""); b.textContent = text; b.onclick = fn; return b; }
const fullText = t => `${t.titolo}\n\n${t.descrizione}\n\n${(t.hashtag || []).join(" ")}`.trim();

// Mostra l'annuncio. Titolo e descrizione si possono modificare: le modifiche
// valgono per i pulsanti «Copia» e vengono salvate nello storico (histId).
function renderText(t, histId, fromHistory) {
  const o = $("out"); o.innerHTML = "";
  const head = document.createElement("div"); head.className = "outhead";
  const l = document.createElement("span"); l.className = "label";
  l.textContent = fromHistory ? `Annuncio del ${fmtDate(fromHistory)}` : "Annuncio";
  head.append(l, mkBtn("Copia tutto", e => copy(fullText(t), e.target), "primary"));
  const onEdit = () => saveHistoryEditSoon(histId, t);
  o.append(head,
    block("Titolo", t, "titolo", "outtitle", onEdit),
    block("Descrizione", t, "descrizione", "outtext", onEdit));
  if (t.hashtag && t.hashtag.length) {
    const b = document.createElement("div"); b.className = "outblock";
    const h = document.createElement("div"); h.className = "outhead";
    const lb = document.createElement("span"); lb.className = "label"; lb.textContent = "Hashtag";
    h.append(lb, mkBtn("Copia", e => copy(t.hashtag.join(" "), e.target)));
    const tg = document.createElement("div"); tg.className = "tags";
    t.hashtag.forEach(x => { const s = document.createElement("span"); s.textContent = x; tg.append(s); });
    b.append(h, tg); o.append(b);
  }
  if (t.controlli && t.controlli.length) {
    const c = document.createElement("div"); c.className = "check";
    const s = document.createElement("strong"); s.textContent = "Da controllare prima di pubblicare";
    const ul = document.createElement("ul");
    t.controlli.forEach(x => { const li = document.createElement("li"); li.textContent = x; ul.append(li); });
    c.append(s, ul); o.append(c);
  }
  const hint = document.createElement("span"); hint.className = "hint";
  hint.textContent = "Puoi toccare titolo e descrizione per correggerli prima di copiarli.";
  o.append(hint);
}
function block(label, t, key, cls, onEdit) {
  const b = document.createElement("div"); b.className = "outblock";
  const h = document.createElement("div"); h.className = "outhead";
  const l = document.createElement("span"); l.className = "label"; l.textContent = label;
  h.append(l, mkBtn("Copia", e => copy(t[key], e.target)));
  const f = document.createElement("textarea"); f.className = "edit " + cls; f.value = t[key];
  f.rows = 1; f.setAttribute("aria-label", label); f.spellcheck = true;
  const fit = () => { f.style.height = "auto"; f.style.height = f.scrollHeight + 2 + "px"; };
  f.addEventListener("input", () => { t[key] = key === "titolo" ? f.value.replace(/\n/g, " ") : f.value; fit(); onEdit(); });
  b.append(h, f); requestAnimationFrame(fit); return b;
}
async function copy(text, el) {
  const old = el.textContent;
  try { await navigator.clipboard.writeText(text); el.textContent = "Copiato ✓"; el.classList.add("ok"); }
  catch (_) {
    const ta = document.createElement("textarea"); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
    ta.remove(); el.textContent = ok ? "Copiato" : "Seleziona a mano";
  }
  setTimeout(() => { el.textContent = old; el.classList.remove("ok"); }, 1500);
}

// ---------- storico annunci (salvato sul telefono) ----------
const HIST_KEY = "ap_history", HIST_MAX = 40;
function loadHistory() { try { const a = JSON.parse(store.get(HIST_KEY, "[]")); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
function writeHistory(list) {
  // se lo spazio finisce, togliamo i più vecchi finché ci sta
  for (let l = list.slice(0, HIST_MAX); ; l = l.slice(0, -1)) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(l)); return; } catch (_) { if (!l.length) return; }
  }
}
function coverThumb() {
  const it = S.items.find(i => i.cv && i.el.classList.contains("has-img"));
  if (!it) return "";
  const c = document.createElement("canvas"); c.width = 96; c.height = Math.round(96 * it.cv.height / it.cv.width);
  try { c.getContext("2d").drawImage(it.proc || it.cv, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.7); } catch (_) { return ""; }
}
function saveHistory(t, id) {
  const list = loadHistory();
  const entry = {
    id: id || Date.now(), date: Date.now(), cat: S.cat,
    titolo: t.titolo, descrizione: t.descrizione, hashtag: t.hashtag || [], controlli: t.controlli || [],
    thumb: coverThumb()
  };
  writeHistory([entry, ...list.filter(e => e.id !== entry.id)]);
  renderHistory();
  return entry.id;
}
let editTimer = 0;
function saveHistoryEditSoon(id, t) {
  if (!id) return;
  clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    const list = loadHistory(), e = list.find(x => x.id === id);
    if (!e) return;
    e.titolo = t.titolo; e.descrizione = t.descrizione;
    writeHistory(list); renderHistory();
  }, 400);
}
function fmtDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}
function renderHistory() {
  const list = loadHistory(), ul = $("histList");
  $("history").hidden = !list.length;
  $("histCount").textContent = list.length ? String(list.length) : "";
  ul.innerHTML = "";
  for (const e of list) {
    const li = document.createElement("li");
    const open = document.createElement("button"); open.type = "button"; open.className = "histopen";
    const im = document.createElement(e.thumb ? "img" : "span"); im.className = "histthumb";
    if (e.thumb) { im.src = e.thumb; im.alt = ""; }
    const txt = document.createElement("span"); txt.className = "histtxt";
    const ti = document.createElement("strong"); ti.textContent = e.titolo || "Senza titolo";
    const me = document.createElement("span"); me.className = "hint"; me.textContent = `${e.cat || ""} · ${fmtDate(e.date)}`;
    txt.append(ti, me); open.append(im, txt);
    open.onclick = () => openHistory(e.id);
    const del = document.createElement("button"); del.type = "button"; del.className = "btn small histdel"; del.textContent = "Elimina";
    del.onclick = () => {
      if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Sicuro?"; setTimeout(() => { del.dataset.sure = ""; del.textContent = "Elimina"; }, 2500); return; }
      writeHistory(loadHistory().filter(x => x.id !== e.id));
      if (S.histId === e.id) S.histId = null;
      renderHistory();
    };
    li.append(open, del); ul.append(li);
  }
}
function openHistory(id) {
  const e = loadHistory().find(x => x.id === id);
  if (!e) return;
  const t = { titolo: e.titolo, descrizione: e.descrizione, hashtag: e.hashtag, controlli: [] };
  $("resText").hidden = false;
  $("resText").classList.remove("show"); void $("resText").offsetWidth; $("resText").classList.add("show");
  renderText(t, e.id, e.date);
  $("resText").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
renderHistory();

// ---------- nuovo annuncio ----------
$("reset").onclick = () => {
  const b = $("reset");
  if (b.dataset.sure !== "1") {
    b.dataset.sure = "1"; b.textContent = "Tocca di nuovo per svuotare tutto";
    setTimeout(() => { b.dataset.sure = ""; b.textContent = "+ Nuovo annuncio"; }, 3000);
    return;
  }
  b.dataset.sure = ""; b.textContent = "+ Nuovo annuncio"; b.hidden = true;
  S.items.forEach(it => { it.ver++; it.el.remove(); });
  S.items = []; S.text = null; S.histId = null;
  ["brand", "size", "notes"].forEach(id => { $(id).value = ""; });
  $("cond").value = "Ottime condizioni";
  $("resText").hidden = true; $("out").innerHTML = "";
  $("go").textContent = "Scrivi l'annuncio";
  $("status").classList.remove("err");
  refresh();
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
};
})();
