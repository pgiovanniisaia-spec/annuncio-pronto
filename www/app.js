(() => {
"use strict";
// Nome dell'app: è l'UNICO punto del codice web dove compare. Tutta l'interfaccia lo prende da qui.
const APP_NAME = "ListLab";
const APP_VERSION = "2.0";
const $ = id => document.getElementById(id);
const MAX = 20;          // foto per annuncio, come Vinted
const AI_PHOTOS = 5;     // foto inviate a Claude (le prime)
const WORK_SIDE = 1500;  // larghezza di decodifica della copia di lavoro
const S = { items: [], cat: "Scarpe", tone: "amichevole", fmt: "34", writing: false, text: null, histId: null };
let nextId = 1;
let viewer = null, studio = null;   // creati più in basso (viewer.js, studio.js)

// ---------- plugin nativi (Capacitor) ----------
// Senza bundler window.Capacitor arriva dal ponte nativo, che espone i plugin in
// Capacitor.Plugins e NON ha registerPlugin: lo usiamo solo se c'è. Un plugin
// mancante non deve mai bloccare il resto dell'app.
const Cap = window.Capacitor;
let native = false;
try { native = !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform()); } catch (_) {}
function plugin(name) {
  if (!native) return null;
  try {
    const p = Cap.Plugins && Cap.Plugins[name];
    if (p) return p;
    if (typeof Cap.registerPlugin === "function") return Cap.registerPlugin(name);
  } catch (e) { console.warn("Plugin " + name + " non disponibile", e); }
  return null;
}
const Filesystem = plugin("Filesystem");
const Share = plugin("Share");
const Gallery = plugin("GallerySaver");   // plugin locale: plugins/gallery-saver
const Haptics = plugin("Haptics");
function haptic() {
  try {
    if (Haptics) Promise.resolve(Haptics.impact({ style: "LIGHT" })).catch(() => {});
    else if (navigator.vibrate) navigator.vibrate(12);
  } catch (_) {}
}
// esegue un pezzo di inizializzazione: se fallisce lo segnala ma l'app va avanti
function on(id, fn) { section(id, () => { $(id).onclick = fn; }); }
function section(name, fn) {
  try { fn(); } catch (e) { if (window.apReportError) window.apReportError(`Avvio (${name}): ${e && e.message || e}`, e); else console.error(e); }
}

// ---------- nome dell'app ----------
section("nome", () => {
  document.title = APP_NAME;
  document.querySelectorAll("[data-app-name]").forEach(el => { el.textContent = APP_NAME; });
  const v = $("appVersion"); if (v) v.textContent = "Versione " + APP_VERSION;
});

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
function updateKeyNotice() { $("keyNotice").hidden = !!apiKey; }
section("impostazioni", () => {
  $("apiKey").value = apiKey; segSet("model", model);
  let pendingModel = model;
  seg("model", v => { pendingModel = v; });
  $("saveSettings").onclick = () => {
    apiKey = $("apiKey").value.trim(); model = pendingModel;
    store.set("ap_key", apiKey); store.set("ap_model", model);
    const st = $("settingsStatus");
    st.textContent = apiKey ? "Impostazioni salvate ✓" : "Salvate. Senza chiave preparo solo una bozza semplice.";
    st.classList.remove("flash"); void st.offsetWidth; st.classList.add("flash");
    updateKeyNotice();
  };
  updateKeyNotice();
});

// ---------- schede (barra in basso) ----------
let currentTab = "home";
const tabScroll = {};
function showTab(name) {
  const to = $("tab-" + name);
  if (!to || name === currentTab) return;
  tabScroll[currentTab] = window.scrollY;
  $("tab-" + currentTab).hidden = true;
  to.hidden = false;
  to.classList.remove("enter"); void to.offsetWidth; to.classList.add("enter");
  window.scrollTo(0, tabScroll[name] || 0);
  currentTab = name;
  document.querySelectorAll(".tabbar [data-tab]").forEach(b => {
    if (b.dataset.tab === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if (name === "settings") { $("apiKey").value = apiKey; segSet("model", model); $("settingsStatus").textContent = ""; }
  if (name === "ai" && studio) studio.sync();
}
section("schede", () => {
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-tab],[data-goto]");
    if (b) { e.preventDefault(); showTab(b.dataset.tab || b.dataset.goto); }
  });
});

section("dettagli", () => {
const sizeHints = { Scarpe: "es. 42 EU", Abbigliamento: "es. M o 44 IT", Capispalla: "es. L o 50 IT" };
seg("cat", v => { S.cat = v; $("size").placeholder = sizeHints[v]; });
seg("tone", v => { S.tone = v; });
seg("fmt", v => { S.fmt = v; $("grid").classList.toggle("square", v === "11"); rerenderAll(); });
$("whiten").addEventListener("change", rerenderAll);
});

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
section("foto", () => {
drop.addEventListener("click", () => fileInput.click());
["dragover", "dragenter"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, () => drop.classList.remove("over")));
drop.addEventListener("drop", e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
fileInput.addEventListener("change", () => { const f = [...(fileInput.files || [])]; fileInput.value = ""; addFiles(f); });
});

function addFiles(list) {
  // Su Android il selettore spesso restituisce file senza tipo, o con tipo generico
  // "application/octet-stream", e senza estensione: li accettiamo e lasciamo decidere
  // alla decodifica. Scartiamo solo ciò che è sicuramente altro (video, testo, PDF…).
  const files = [...list].filter(f => !f.type || f.type.startsWith("image/") || f.type === "application/octet-stream" ||
    /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(f.name || ""));
  if (!files.length) { setStatus("Nessuna foto ricevuta. Riprova scegliendo dalla Galleria.", true); return; }
  let skipped = 0;
  $("status").classList.remove("err");
  for (const f of files) {
    if (S.items.length >= MAX) { skipped++; continue; }
    const it = { id: nextId++, file: f, rot: 0, tilt: 0, edits: new Set(), forceWhiten: false, box: null, boxRot: 0, src: null, ver: 0, out: null, outPromise: null };
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
// rotazione fine (Raddrizza): ingrandisce quel tanto che basta per non lasciare angoli vuoti
function coverScale(deg, w, h) {
  const a = Math.abs(deg || 0) * Math.PI / 180;
  if (!a) return 1;
  const c = Math.cos(a), sn = Math.sin(a);
  return Math.max((w * c + h * sn) / w, (w * sn + h * c) / h);
}
function oriented(it) {
  const base = rotated(it.src, it.rot);
  if (!it.tilt) return base;
  const w = base.width, h = base.height, k = coverScale(it.tilt, w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.imageSmoothingQuality = "high";
  x.translate(w / 2, h / 2); x.rotate(it.tilt * Math.PI / 180); x.scale(k, k); x.drawImage(base, -w / 2, -h / 2);
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
  const Src = oriented(it), W = Src.width, H = Src.height;
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
  if (!it.orig) drawTile(it, out); // il nuovo taglio si vede subito

  const img = await enhanceAsync(x.getImageData(0, 0, OW, OH), $("whiten").checked || it.forceWhiten);
  if (v !== it.ver || !S.items.includes(it)) return;
  x.putImageData(img, 0, 0);
  setProcessed(it, out);
  setWorking(it, false);
  it.el.classList.remove("done"); void it.el.offsetWidth; it.el.classList.add("done");
  // il JPG finale si prepara in sottofondo, serve solo per salvare o condividere
  it.out = null;
  it.outPromise = new Promise(r => out.toBlob(r, "image/jpeg", 0.92)).then(b => {
    if (v === it.ver) { it.out = b; refresh(); if (viewer) viewer.refreshItem(it); }
    return b;
  });
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
// it.proc = anteprima sistemata; la casella mostra quella o, col pulsante occhio, l'originale
function setProcessed(it, out) {
  const p = it.proc || (it.proc = document.createElement("canvas"));
  const h = tileH(); p.width = TILE_W; p.height = h;
  const x = p.getContext("2d"), k = Math.max(TILE_W / out.width, h / out.height);
  x.imageSmoothingQuality = "medium";
  x.drawImage(out, (TILE_W - out.width * k) / 2, (h - out.height * k) / 2, out.width * k, out.height * k);
  paintTile(it);
}
function paintTile(it) {
  if (it.orig && it.src) drawTile(it, rotated(it.src, it.rot));
  else if (it.proc) drawTile(it, it.proc);
  it.el.classList.toggle("orig", !!it.orig);
  if (it.eye) { it.eye.setAttribute("aria-pressed", String(!!it.orig)); it.eye.setAttribute("aria-label", it.orig ? "Mostra la foto sistemata" : "Mostra l'originale"); }
  if (!it.el.classList.contains("failed")) it.badge.textContent = it.orig ? "Originale" : label(it);
  paintEdits(it);
}
const EDIT_NAMES = { auto: "Auto", crop: "Ritaglio", straighten: "Dritta" };
function editLabel(it) {
  if (!it.edits || !it.edits.size) return "";
  const names = [...it.edits].map(e => EDIT_NAMES[e] || e);
  return names.length === 1 ? names[0] : `${names.length} modifiche`;
}
function paintEdits(it) {
  if (!it.ebadge) return;
  const l = editLabel(it);
  it.ebadge.hidden = !l; it.ebadge.textContent = l ? "✦ " + l : "";
  it.ebadge.title = l ? "Modifiche AI: " + [...it.edits].map(e => EDIT_NAMES[e] || e).join(", ") : "";
}
const EYE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
function makeTile(it) {
  const t = document.createElement("div"); t.className = "tile working"; t.dataset.id = it.id;
  t.style.animationDelay = Math.min(S.items.length - 1, 10) * 30 + "ms";
  t.addEventListener("animationend", e => { if (e.animationName === "pop") t.classList.add("in"); });
  const cv = document.createElement("canvas"); cv.width = TILE_W; cv.height = tileH();
  const badge = document.createElement("span"); badge.className = "badge";
  const x = document.createElement("button"); x.type = "button"; x.className = "ico x"; x.textContent = "×"; x.setAttribute("aria-label", "Rimuovi foto");
  const r = document.createElement("button"); r.type = "button"; r.className = "ico rot"; r.textContent = "↻"; r.setAttribute("aria-label", "Ruota foto");
  const eye = document.createElement("button"); eye.type = "button"; eye.className = "ico eye"; eye.innerHTML = EYE_SVG;
  eye.setAttribute("aria-pressed", "false"); eye.setAttribute("aria-label", "Mostra l'originale");
  x.onclick = e => { e.stopPropagation(); removeItem(it); };
  r.onclick = e => {
    e.stopPropagation(); it.rot = (it.rot + 90) % 360;
    r.classList.remove("spin"); void r.offsetWidth; r.classList.add("spin");
    if (it.orig && it.src) drawTile(it, rotated(it.src, it.rot));
    rotateItem(it);
  };
  // occhio: tocca per vedere l'originale, ritocca per tornare alla foto sistemata
  eye.onclick = e => { e.stopPropagation(); if (!it.src) return; it.orig = !it.orig; paintTile(it); };
  const ebadge = document.createElement("span"); ebadge.className = "ebadge"; ebadge.hidden = true;
  const ring = document.createElement("i"); ring.className = "ring"; ring.setAttribute("aria-hidden", "true");
  t.append(cv, ring, badge, ebadge, x, eye, r);
  it.el = t; it.cv = cv; it.badge = badge; it.eye = eye; it.ebadge = ebadge;
  setupDrag(it);
  $("grid").append(t);
}

// ---------- gesti sulla griglia (Pointer Events) ----------
// • tocco breve → foto a schermo intero
// • pressione lunga senza muovere il dito → piccola vibrazione, poi al rilascio schermo intero
// • pressione lunga + trascinamento → riordino
// Se il dito si muove prima della pressione lunga è un normale scorrimento della pagina.
const LONG_PRESS = 300, SLOP = 10;
let drag = null;
function setupDrag(it) {
  const t = it.el;
  let press = null;
  const clear = () => { if (press) { clearTimeout(press.timer); press = null; } t.classList.remove("armed"); };
  t.addEventListener("pointerdown", e => {
    if (drag || press || (e.pointerType === "mouse" && e.button !== 0) || e.target.closest("button")) return;
    if (!S.items.includes(it)) return;
    const p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, armed: false };
    p.timer = setTimeout(() => {
      if (press !== p) return;
      p.armed = true; t.classList.add("armed"); haptic();
    }, LONG_PRESS);
    press = p;
  });
  t.addEventListener("pointermove", e => {
    if (!press || e.pointerId !== press.id) return;
    press.x = e.clientX; press.y = e.clientY;
    if (Math.hypot(press.x - press.x0, press.y - press.y0) <= SLOP) return;
    if (press.armed && S.items.length > 1) { const p = press; clear(); startDrag(it, p); }
    else if (!press.armed) clear();
  });
  t.addEventListener("pointerup", e => {
    if (!press || e.pointerId !== press.id) return;
    clear();
    openViewer(it);
  });
  t.addEventListener("pointercancel", e => { if (press && e.pointerId === press.id) clear(); });
  // dopo la pressione lunga (e mentre si trascina) la pagina non deve scorrere col dito (Android)
  t.addEventListener("touchmove", e => {
    if (((drag && drag.it === it) || (press && press.armed)) && e.cancelable) e.preventDefault();
  }, { passive: false });
  t.addEventListener("contextmenu", e => e.preventDefault());
}
function pageSlot(el) { const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; }
function startDrag(it, p) {
  if (!S.items.includes(it)) return;
  const slots = S.items.map(i => pageSlot(i.el));
  const from = S.items.indexOf(it);
  drag = { it, from, to: from, slots, id: p.id, sx: p.x + window.scrollX, sy: p.y + window.scrollY, px: p.x, py: p.y, raf: 0 };
  try { it.el.setPointerCapture(p.id); } catch (_) {}
  it.el.classList.add("dragging"); $("grid").classList.add("sorting");
  document.addEventListener("pointermove", onDragMove, true);
  document.addEventListener("pointerup", onDragEnd, true);
  document.addEventListener("pointercancel", onDragEnd, true);
  drag.raf = requestAnimationFrame(dragFrame);
  updateDrag();
}
function onDragMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  drag.px = e.clientX; drag.py = e.clientY;
  if (e.cancelable) e.preventDefault();
  updateDrag();
}
function updateDrag() {
  const d = drag, X = d.px + window.scrollX, Y = d.py + window.scrollY;
  d.it.el.style.transform = `translate(${X - d.sx}px, ${Y - d.sy}px) scale(1.07)`;
  let best = d.to, bd = Infinity;
  d.slots.forEach((sl, i) => {
    const dx = X - (sl.x + sl.w / 2), dy = Y - (sl.y + sl.h / 2), dd = dx * dx + dy * dy;
    if (dd < bd) { bd = dd; best = i; }
  });
  if (best !== d.to) { d.to = best; layoutOthers(); }
}
// le altre foto scorrono per fare spazio
function layoutOthers() {
  const d = drag, order = S.items.filter(i => i !== d.it);
  order.splice(d.to, 0, d.it);
  order.forEach((i, k) => {
    if (i === d.it) return;
    const cur = d.slots[S.items.indexOf(i)], dst = d.slots[k];
    i.el.style.transform = cur === dst ? "" : `translate(${dst.x - cur.x}px, ${dst.y - cur.y}px)`;
  });
}
// scorrimento automatico della pagina vicino ai bordi
function dragFrame() {
  if (!drag) return;
  const bar = document.querySelector(".tabbar"), barH = bar ? bar.offsetHeight : 0;
  const edge = 80, top = edge, bottom = window.innerHeight - barH - edge;
  let v = 0;
  if (drag.py < top) v = -Math.ceil((top - drag.py) / 5);
  else if (drag.py > bottom) v = Math.ceil((drag.py - bottom) / 5);
  if (v) { const y0 = window.scrollY; window.scrollBy(0, Math.max(-24, Math.min(24, v))); if (window.scrollY !== y0) updateDrag(); }
  drag.raf = requestAnimationFrame(dragFrame);
}
function onDragEnd(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  cancelAnimationFrame(d.raf);
  document.removeEventListener("pointermove", onDragMove, true);
  document.removeEventListener("pointerup", onDragEnd, true);
  document.removeEventListener("pointercancel", onDragEnd, true);
  try { d.it.el.releasePointerCapture(d.id); } catch (_) {}
  const el = d.it.el, X = d.px + window.scrollX, Y = d.py + window.scrollY;
  const curX = d.slots[d.from].x + (X - d.sx), curY = d.slots[d.from].y + (Y - d.sy);
  S.items.splice(d.from, 1); S.items.splice(d.to, 0, d.it);
  const grid = $("grid");
  S.items.forEach(i => { i.el.style.transition = "none"; i.el.style.transform = ""; grid.append(i.el); });
  // la foto parte da dove l'hai lasciata e scivola nella sua nuova casella
  const dst = d.slots[d.to];
  el.style.transform = `translate(${curX - dst.x}px, ${curY - dst.y}px) scale(1.07)`;
  void el.offsetWidth;
  S.items.forEach(i => { i.el.style.transition = ""; });
  el.classList.remove("dragging"); el.classList.add("dropping");
  el.style.transform = "";
  grid.classList.remove("sorting");
  setTimeout(() => el.classList.remove("dropping"), 260);
  refresh();
  if (d.to !== d.from) setStatus(d.to === 0 ? "Nuova copertina impostata." : `Foto spostata in posizione ${d.to + 1}.`);
}

function label(it) { return S.items[0] === it ? "Copertina" : String(S.items.indexOf(it) + 1); }
function setWorking(it, on) {
  if (!it.el) return;
  it.el.classList.toggle("working", on);
  if (viewer) viewer.refreshItem(it);
  if (studio) studio.sync();
}
function rotateItem(it) { it.rot = (it.rot + 90) % 360; enqueue(() => renderItem(it)); }
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
  S.items.forEach(it => { if (!it.el.classList.contains("failed")) it.badge.textContent = it.orig ? "Originale" : label(it); });
  const n = S.items.length, ready = S.items.filter(i => i.proc && !i.el.classList.contains("working")).length;
  const c = $("count"); const txt = `${n} / ${MAX}`;
  if (c.textContent !== txt) { c.textContent = txt; c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); }
  $("photoTools").hidden = !ready;
  $("go").disabled = !n || S.writing;
  if (studio) studio.sync();
  if (!S.writing && !$("status").classList.contains("err")) {
    setStatus(!n ? "Aggiungi almeno una foto per iniziare." : ready < n ? `Sistemo le foto… ${ready} di ${n}` : `${n} ${n === 1 ? "foto pronta" : "foto pronte"}. Ora puoi scrivere l'annuncio.`);
  }
}

// ---------- salvataggio e condivisione ----------
// I file seguono sempre l'ordine della griglia: 01-copertina.jpg, 02.jpg, 03.jpg…
const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(b); });
const fname = i => i === 0 ? "01-copertina.jpg" : `${String(i + 1).padStart(2, "0")}.jpg`;
const isCancel = e => /cancel|annull|abort/i.test(String(e && (e.message || e)));
const pad2 = n => String(n).padStart(2, "0");

function folderName() {
  const clean = t => String(t || "").replace(/[\\/:*?"<>|\u0000-\u001f#%]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 50).trim();
  const fromTitle = clean(S.text && S.text.titolo);
  if (fromTitle) return fromTitle;
  const d = new Date();
  return `Annuncio ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}.${pad2(d.getMinutes())}`;
}
function photosReady() {
  const ok = S.items.filter(i => !i.el.classList.contains("failed"));
  if (!ok.length) { setStatus("Nessuna foto da salvare.", true); return false; }
  if (ok.some(i => i.el.classList.contains("working") || !i.outPromise)) { setStatus("Aspetta un attimo: sto ancora sistemando le foto.", true); return false; }
  return true;
}
async function orderedBlobs() {
  const ok = S.items.filter(i => !i.el.classList.contains("failed"));
  return (await Promise.all(ok.map(i => i.outPromise))).filter(Boolean);
}
async function writeAll(blobs, directory, folder) {
  const uris = [];
  for (let i = 0; i < blobs.length; i++) {
    const r = await Filesystem.writeFile({ path: `${folder}/${fname(i)}`, data: await blobToB64(blobs[i]), directory, recursive: true });
    uris.push(r.uri);
  }
  return uris;
}
function busy(id, on) { const b = $(id); if (b) b.disabled = on; }

on("shareAll", async () => {
  if (!photosReady()) return;
  const blobs = await orderedBlobs();
  if (!native || !Filesystem || !Share) return browserDownload(blobs);
  busy("shareAll", true);
  try {
    setStatus("Preparo le foto…");
    try { await Filesystem.rmdir({ path: "condividi", directory: "CACHE", recursive: true }); } catch (_) {}
    const files = await writeAll(blobs, "CACHE", "condividi");
    await Share.share({ title: "Foto annuncio", files });
    setStatus("Foto condivise nell'ordine della griglia.");
  } catch (e) {
    if (!isCancel(e)) setStatus("Condivisione non riuscita. Prova «Salva nel telefono».", true); else refresh();
  } finally { busy("shareAll", false); }
});

on("saveAll", async () => {
  if (!photosReady()) return;
  const blobs = await orderedBlobs(), folder = folderName();
  if (!native || (!Gallery && !Filesystem)) return browserDownload(blobs);
  busy("saveAll", true);
  try {
    if (Gallery) {
      // date crescenti: anche la Galleria mostra le foto nell'ordine della griglia
      const base = Date.now() - blobs.length * 1000;
      for (let i = 0; i < blobs.length; i++) {
        setStatus(`Salvo nella Galleria… ${i + 1} di ${blobs.length}`);
        await Gallery.saveImage({ data: await blobToB64(blobs[i]), root: APP_NAME, folder, fileName: fname(i), time: base + i * 1000 });
      }
      setStatus(`Salvate ${blobs.length} foto nella Galleria › ${APP_NAME} › ${folder}`);
    } else {
      await writeAll(blobs, "DOCUMENTS", `${APP_NAME}/${folder}`);
      setStatus(`Foto salvate in Documenti › ${APP_NAME} › ${folder}`);
    }
  } catch (e) {
    setStatus("Salvataggio non riuscito" + (e && e.message ? ` (${e.message})` : "") + ". Prova «Scarica ZIP» o «Condividi tutte».", true);
  } finally { busy("saveAll", false); }
});

let jszipLoading = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return jszipLoading || (jszipLoading = new Promise((res, rej) => {
    const sc = document.createElement("script"); sc.src = "vendor/jszip.min.js";
    sc.onload = () => window.JSZip ? res(window.JSZip) : rej(new Error("JSZip non disponibile"));
    sc.onerror = () => { jszipLoading = null; rej(new Error("JSZip non caricato")); };
    document.head.append(sc);
  }));
}
on("zipAll", async () => {
  if (!photosReady()) return;
  busy("zipAll", true);
  try {
    setStatus("Preparo lo ZIP…");
    const [JSZip, blobs] = await Promise.all([loadJSZip(), orderedBlobs()]);
    const folder = folderName(), zip = new JSZip(), dir = zip.folder(folder), base = Date.now() - blobs.length * 1000;
    blobs.forEach((b, i) => dir.file(fname(i), b, { binary: true, date: new Date(base + i * 1000) }));
    const zipName = folder.replace(/\s+/g, "-") + ".zip";
    if (native && Filesystem && Share) {
      const data = await zip.generateAsync({ type: "base64", compression: "STORE" });
      try { await Filesystem.rmdir({ path: "zip", directory: "CACHE", recursive: true }); } catch (_) {}
      const r = await Filesystem.writeFile({ path: `zip/${zipName}`, data, directory: "CACHE", recursive: true });
      await Share.share({ title: zipName, files: [r.uri] });
      setStatus(`ZIP pronto: ${zipName}`);
    } else {
      downloadBlob(await zip.generateAsync({ type: "blob", compression: "STORE" }), zipName);
      setStatus(`ZIP scaricato: ${zipName}`);
    }
  } catch (e) {
    if (isCancel(e)) refresh(); else setStatus("ZIP non riuscito" + (e && e.message ? ` (${e.message})` : "") + ".", true);
  } finally { busy("zipAll", false); }
});

function downloadBlob(b, name) {
  const u = URL.createObjectURL(b);
  const a = document.createElement("a"); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
function browserDownload(blobs) { blobs.forEach((b, i) => downloadBlob(b, fname(i))); }

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

async function askClaude(items) { return callClaude(items, buildPrompt(items.length), 1500); }
async function askBoxes(items) {
  const prompt = `Ti mostro ${items.length} foto dello stesso articolo da vendere su Vinted (categoria: ${S.cat}).
Per OGNI foto, nell'ordine, indica il riquadro che contiene l'intero articolo (per le scarpe tutto il paio visibile) come [x0,y0,x1,y1] con valori da 0 a 1 (0,0 in alto a sinistra). Se l'articolo riempie già la foto usa [0,0,1,1].
Rispondi SOLO con JSON: {"box":[[0.1,0.05,0.9,0.95]]}`;
  const r = await callClaude(items, prompt, 400);
  if (!r || !Array.isArray(r.box)) throw new Error("json");
  return r.box;
}
async function callClaude(items, prompt, maxTokens) {
  const content = items.map(it => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: aiImage(it) } }));
  content.push({ type: "text", text: prompt });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content }] })
  });
  if (!res.ok) { const e = new Error("http"); e.status = res.status; throw e; }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("json");
  return JSON.parse(text.slice(a, b + 1));
}

function errMsg(e, offline) {
  if (e.status === 401 || e.status === 403) return "Chiave API non valida: controllala in Impostazioni.";
  if (e.status === 429) return "Troppe richieste ravvicinate: riprova tra un minuto.";
  if (e.status === 400) return "Richiesta rifiutata. Controlla credito e modello su console.anthropic.com.";
  if (e.status === 529 || e.status >= 500) return "Il servizio è occupato: riprova tra poco.";
  if (e.message === "json") return "Risposta non leggibile: premi di nuovo «Scrivi l'annuncio».";
  return offline || "Nessuna connessione. Ho preparato una bozza semplice.";
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

on("go", async () => {
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
    ai.box.forEach((b, i) => { const it = ready[i]; if (it && S.items.includes(it) && validBox(b)) { it.box = b; it.boxRot = it.rot; enqueue(() => renderItem(it)); } });
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
});

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
section("storico", renderHistory);

// ---------- nuovo annuncio ----------
on("reset", () => {
  const b = $("reset");
  if (b.dataset.sure !== "1") {
    b.dataset.sure = "1"; b.textContent = "Tocca di nuovo per svuotare tutto";
    setTimeout(() => { b.dataset.sure = ""; b.textContent = "+ Nuovo annuncio"; }, 3000);
    return;
  }
  b.dataset.sure = ""; b.textContent = "+ Nuovo annuncio"; b.hidden = true;
  S.items.forEach(it => { it.ver++; it.el.remove(); });
  $("grid").classList.remove("sorting");
  S.items = []; S.text = null; S.histId = null;
  ["brand", "size", "notes"].forEach(id => { $(id).value = ""; });
  $("cond").value = "Ottime condizioni";
  $("resText").hidden = true; $("out").innerHTML = "";
  $("go").textContent = "Scrivi l'annuncio";
  $("status").classList.remove("err");
  refresh();
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
});

// ---------- visualizzatore a schermo intero (viewer.js) ----------
const viewable = () => S.items.filter(i => i.src && !i.el.classList.contains("failed"));
const urlCache = new WeakMap();
function cachedUrl(it, key, make) {
  const c = urlCache.get(it) || {};
  if (c[key[0]] && c[key[0]].key === key) return c[key[0]].url;
  const url = make(); if (!url) return null;
  if (c[key[0]] && c[key[0]].url.startsWith("blob:")) URL.revokeObjectURL(c[key[0]].url);
  c[key[0]] = { key, url }; urlCache.set(it, c);
  return url;
}
const phCache = new WeakMap();
function placeholder(it, orig) {
  const key = orig ? `o${it.rot}` : `f${it.ver}`;
  const c = phCache.get(it) || {};
  if (c[orig ? "o" : "f"] && c[orig ? "o" : "f"].key === key) return c[orig ? "o" : "f"].url;
  const src = orig ? (it.src && rotated(it.src, it.rot)) : (it.proc || it.cv);
  if (!src) return null;
  const k = Math.min(1, 480 / Math.max(src.width, src.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k);
  cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL("image/jpeg", 0.8);
  c[orig ? "o" : "f"] = { key, url }; phCache.set(it, c);
  return url;
}
async function fullUrl(it, orig) {
  if (orig) {
    if (!it.src) return null;
    const key = `o${it.rot}`, have = (urlCache.get(it) || {}).o;
    if (have && have.key === key) return have.url;
    const blob = await new Promise(r => rotated(it.src, it.rot).toBlob(r, "image/jpeg", 0.92));
    return blob ? cachedUrl(it, key, () => URL.createObjectURL(blob)) : null;
  }
  const v = it.ver, blob = it.out || (it.outPromise && await it.outPromise);
  if (!blob) return null;
  return cachedUrl(it, `f${v}`, () => URL.createObjectURL(blob));
}
function openViewer(it) {
  if (!viewer || !it.src || it.el.classList.contains("failed")) return;
  viewer.open(it);
}
section("visualizzatore", () => {
  viewer = window.createViewer({
    items: viewable,
    tileRect: it => (it.el && it.el.isConnected && !$("tab-home").hidden) ? it.el.getBoundingClientRect() : null,
    placeholder, fullUrl,
    aspect: () => S.fmt === "34" ? 4 / 3 : 1,
    isWorking: it => it.el.classList.contains("working"),
    rotate: it => rotateItem(it),
    remove: it => removeItem(it)
  });
});

// ---------- scheda AI (studio.js) ----------
section("studio", () => {
  const rerender = list => Promise.all(list.map(it => enqueue(() => renderItem(it))));
  studio = window.createStudio({
    items: viewable,
    thumbSource: it => it.proc || it.cv,
    isWorking: it => it.el.classList.contains("working"),
    editLabel,
    coverScale,
    async applyAuto(list) {
      list.forEach(it => { it.forceWhiten = true; it.edits.add("auto"); });
      await rerender(list);
    },
    async applyCrop(list) {
      if (!apiKey) throw new Error("Per il ritaglio intelligente serve la chiave API: aggiungila nella scheda Impostazioni.");
      let found = 0;
      for (let i = 0; i < list.length; i += AI_PHOTOS) {
        const batch = list.slice(i, i + AI_PHOTOS);
        let boxes;
        try { boxes = await askBoxes(batch); }
        catch (e) { throw new Error(errMsg(e, "Nessuna connessione: il ritaglio intelligente ha bisogno di internet.")); }
        batch.forEach((it, k) => {
          const b = boxes[k];
          if (S.items.includes(it) && validBox(b)) { it.box = b; it.boxRot = it.rot; it.edits.add("crop"); found++; }
        });
      }
      await rerender(list);
      return found ? `Ritaglio fatto su ${found} ${found === 1 ? "foto" : "foto"}. Le trovi in Home.` : "Claude non ha trovato un ritaglio migliore: le foto restano com'erano.";
    },
    async applyTilt(list, deg) {
      list.forEach(it => { it.tilt = deg; if (deg) it.edits.add("straighten"); else it.edits.delete("straighten"); });
      await rerender(list);
      return deg ? `Foto raddrizzate di ${deg.toLocaleString("it-IT")}°. Le trovi in Home.` : "Raddrizzamento tolto.";
    }
  });
  studio.sync();
});

// ---------- caricamento iniziale ----------
// La splash nativa (bianca, col logo) si chiude appena la pagina è pronta; la splash
// in pagina continua con la stessa grafica e un'animazione, poi si dissolve.
section("splash", () => {
  const SplashScreen = plugin("SplashScreen");
  if (SplashScreen) { try { Promise.resolve(SplashScreen.hide({ fadeOutDuration: 120 })).catch(() => {}); } catch (_) {} }
  const el = $("splash");
  if (!el) return;
  const wait = Math.max(0, 750 - performance.now());
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, wait);
});
})();
