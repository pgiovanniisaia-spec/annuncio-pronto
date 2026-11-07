// Visualizzatore a schermo intero delle foto della griglia.
// Gesti: zoom con due dita e doppio tocco, scorrimento a destra/sinistra tra le foto,
// trascinamento verso il basso per chiudere, ✕, Esc e tasto indietro di Android (history).
// app.js lo crea con createViewer(api) e gli passa le funzioni per leggere e modificare le foto.
(function () {
  "use strict";

  window.createViewer = function createViewer(api) {
    const $ = id => document.getElementById(id);
    const root = $("viewer"), stage = $("vStage"), bg = root.querySelector(".vbg");
    const slides = [...root.querySelectorAll(".vslide")];
    const imgs = slides.map(s => s.querySelector("img"));
    const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    const EASE = "cubic-bezier(.2,.8,.2,1)";

    let idx = 0, mode = "fixed", isOpen = false, closing = false;
    let offset = 0;                       // spostamento orizzontale delle slide (px)
    const z = { s: 1, tx: 0, ty: 0 };     // zoom della foto centrale
    let pushed = false, ignorePop = false;

    const items = () => api.items();
    const cur = () => items()[idx];
    const W = () => stage.clientWidth, H = () => stage.clientHeight;

    // ---------- immagini ----------
    function setImg(img, it) {
      if (!it) { img.dataset.id = ""; img.dataset.want = ""; img.removeAttribute("src"); return; }
      const want = mode + ":" + it.id;
      // stessa foto già visibile: tienila finché arriva la nuova versione (niente lampeggi)
      const same = img.dataset.want === want && img.getAttribute("src");
      img.dataset.id = it.id; img.dataset.want = want;
      if (!same) { const ph = api.placeholder(it, mode === "orig"); if (ph) img.src = ph; }
      api.fullUrl(it, mode === "orig").then(url => {
        if (url && img.dataset.want === want && img.getAttribute("src") !== url) img.src = url;
      }).catch(() => {});
    }
    function render() {
      const list = items();
      if (!list.length) { close(); return; }
      idx = Math.max(0, Math.min(idx, list.length - 1));
      setImg(imgs[0], list[idx - 1]);
      setImg(imgs[1], list[idx]);
      setImg(imgs[2], list[idx + 1]);
      slides[0].hidden = !list[idx - 1]; slides[2].hidden = !list[idx + 1];
      const it = list[idx];
      $("vCount").textContent = `${idx + 1} / ${list.length}` + (idx === 0 ? " · Copertina" : "");
      stage.classList.toggle("busy", !!(it && api.isWorking(it)));
      resetZoom(false); setOffset(0, false);
      const del = $("vDelete"); del.dataset.sure = ""; del.lastChild.textContent = " Elimina";
    }
    function setOffset(dx, animate) {
      offset = dx;
      slides.forEach((s, k) => {
        s.style.transition = animate ? `transform .3s ${EASE}` : "none";
        s.style.transform = `translate3d(${(k - 1) * (W() + 16) + dx}px,0,0)`;
      });
    }

    // ---------- zoom ----------
    function contained(img) {
      const w = W(), h = H();
      const a = img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : api.aspect();
      const dw = Math.min(w, h / a), dh = dw * a;
      return { w: dw, h: dh, left: (w - dw) / 2, top: (h - dh) / 2 };
    }
    function clampZoom(soft) {
      const d = contained(imgs[1]);
      const mx = Math.max(0, (d.w * z.s - W()) / 2), my = Math.max(0, (d.h * z.s - H()) / 2);
      const lim = (v, m) => {
        if (!soft) return Math.max(-m, Math.min(m, v));
        if (v > m) return m + (v - m) * 0.35;
        if (v < -m) return -m + (v + m) * 0.35;
        return v;
      };
      z.tx = lim(z.tx, mx); z.ty = lim(z.ty, my);
    }
    function applyZoom(animate) {
      const img = imgs[1];
      img.style.transition = animate ? `transform .28s ${EASE}` : "none";
      img.style.transform = z.s === 1 && !z.tx && !z.ty ? "" : `translate3d(${z.tx}px,${z.ty}px,0) scale(${z.s})`;
      root.classList.toggle("zoomed", z.s > 1.01);
    }
    function resetZoom(animate) { z.s = 1; z.tx = 0; z.ty = 0; applyZoom(animate); }
    function zoomAt(px, py, s2) {
      const cx = W() / 2, cy = H() / 2;
      z.tx = px - cx - (px - cx - z.tx) * (s2 / z.s);
      z.ty = py - cy - (py - cy - z.ty) * (s2 / z.s);
      z.s = s2;
    }

    // ---------- gesti ----------
    const pts = new Map();
    let g = null, lastTap = null, tapTimer = 0;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const local = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    stage.addEventListener("pointerdown", e => {
      if (!isOpen || closing) return;
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) {
        const p = local(e);
        g = { type: "pending", x0: p.x, y0: p.y, t0: performance.now(), tx0: z.tx, ty0: z.ty, vx: 0, vy: 0, lx: p.x, ly: p.y, lt: performance.now() };
      } else if (pts.size === 2) {
        if (g && g.type === "swipe") setOffset(0, true);
        if (g && g.type === "dismiss") snapBack();
        const [a, b] = [...pts.values()];
        g = { type: "pinch", d0: dist(a, b) || 1, m0: mid(a, b), s0: z.s, tx0: z.tx, ty0: z.ty };
      }
    });
    stage.addEventListener("pointermove", e => {
      if (!g || !pts.has(e.pointerId)) return;
      const p = local(e); pts.set(e.pointerId, p);
      if (g.type === "pinch") {
        if (pts.size < 2) return;
        const [a, b] = [...pts.values()], m = mid(a, b);
        const s2 = Math.max(0.7, Math.min(5, g.s0 * dist(a, b) / g.d0));
        const cx = W() / 2, cy = H() / 2;
        z.s = s2;
        z.tx = m.x - cx - (g.m0.x - cx - g.tx0) * (s2 / g.s0);
        z.ty = m.y - cy - (g.m0.y - cy - g.ty0) * (s2 / g.s0);
        applyZoom(false);
        return;
      }
      const now = performance.now(), dt = Math.max(1, now - g.lt);
      g.vx = (p.x - g.lx) / dt; g.vy = (p.y - g.ly) / dt; g.lx = p.x; g.ly = p.y; g.lt = now;
      const dx = p.x - g.x0, dy = p.y - g.y0;
      if (g.type === "pending") {
        if (Math.hypot(dx, dy) < 8) return;
        if (z.s > 1.01) g.type = "pan";
        else if (Math.abs(dx) > Math.abs(dy)) g.type = "swipe";
        else g.type = "dismiss";
        clearTimeout(tapTimer);
      }
      if (g.type === "pan") { z.tx = g.tx0 + dx; z.ty = g.ty0 + dy; clampZoom(true); applyZoom(false); }
      else if (g.type === "swipe") {
        const edge = (dx > 0 && idx === 0) || (dx < 0 && idx === items().length - 1);
        setOffset(edge ? dx * 0.3 : dx, false);
      } else if (g.type === "dismiss") {
        const k = Math.min(1, Math.abs(dy) / (H() * 0.6));
        imgs[1].style.transition = "none";
        imgs[1].style.transform = `translate3d(${dx * 0.4}px,${dy}px,0) scale(${1 - k * 0.25})`;
        bg.style.opacity = String(1 - k * 0.85);
        root.classList.add("dragging-down");
      }
    });
    function endPointer(e) {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.delete(e.pointerId);
      if (!g) return;
      if (g.type === "pinch") {
        if (pts.size === 1) { // continua spostando con il dito rimasto
          const q = [...pts.values()][0];
          g = { type: "pan", x0: q.x, y0: q.y, tx0: z.tx, ty0: z.ty, lx: q.x, ly: q.y, lt: performance.now(), vx: 0, vy: 0 };
          return;
        }
        if (z.s < 1) resetZoom(true); else { clampZoom(false); applyZoom(true); }
        g = null; return;
      }
      if (pts.size) return;
      const dx = p.x - g.x0, dy = p.y - g.y0, type = g.type, vx = g.vx, vy = g.vy;
      g = null;
      if (e.type === "pointercancel") { setOffset(0, true); snapBack(); return; }
      if (type === "pending") return tap(p);
      if (type === "pan") { clampZoom(false); applyZoom(true); return; }
      if (type === "swipe") {
        const n = items().length;
        if ((dx < -W() * 0.22 || vx < -0.5) && idx < n - 1) return go(1);
        if ((dx > W() * 0.22 || vx > 0.5) && idx > 0) return go(-1);
        return setOffset(0, true);
      }
      if (type === "dismiss") {
        if (Math.abs(dy) > 110 || Math.abs(vy) > 0.6) return close();
        snapBack();
      }
    }
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);

    function snapBack() {
      root.classList.remove("dragging-down");
      imgs[1].style.transition = `transform .25s ${EASE}`; imgs[1].style.transform = "";
      bg.style.transition = "opacity .25s"; bg.style.opacity = "1";
    }
    function tap(p) {
      const now = performance.now();
      if (lastTap && now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) {
        clearTimeout(tapTimer); lastTap = null;
        if (z.s > 1.01) resetZoom(true);
        else { zoomAt(p.x, p.y, 2.5); clampZoom(false); applyZoom(true); }
        return;
      }
      lastTap = { t: now, x: p.x, y: p.y };
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { root.classList.toggle("bare"); }, 300);
    }
    function go(delta) {
      const target = -delta * (W() + 16);
      setOffset(target, !reduce());
      const done = () => { idx += delta; render(); };
      if (reduce()) done(); else setTimeout(done, 300);
    }

    // ---------- apertura e chiusura ----------
    function tileTransform(it, img) {
      const r = api.tileRect(it);
      if (!r || r.bottom < 0 || r.top > innerHeight || r.width < 2) return null;
      const s = stage.getBoundingClientRect(), d = contained(img);
      const sc = r.width / d.w;
      const tx = (r.left + r.width / 2) - (s.left + W() / 2), ty = (r.top + r.height / 2) - (s.top + H() / 2);
      return `translate3d(${tx}px,${ty}px,0) scale(${sc})`;
    }
    function open(it) {
      const list = items();
      const i = list.indexOf(it);
      if (i < 0 || isOpen) return;
      idx = i; mode = "fixed"; isOpen = true; closing = false;
      setMode("fixed", true);
      root.classList.remove("bare", "zoomed", "dragging-down", "closing");
      root.hidden = false;
      document.documentElement.classList.add("viewer-open");
      render();
      try { history.pushState({ listlabViewer: 1 }, ""); pushed = true; } catch (_) { pushed = false; }
      const img = imgs[1];
      if (reduce()) { bg.style.transition = "none"; bg.style.opacity = "1"; root.classList.add("shown"); return; }
      const t = tileTransform(it, img);
      img.style.transition = "none"; img.style.transform = t || "scale(.92)";
      if (!t) img.style.opacity = "0";
      bg.style.transition = "none"; bg.style.opacity = "0";
      root.classList.remove("shown");
      if (it.el) it.el.classList.add("viewing");
      void img.offsetWidth;
      img.style.transition = `transform .34s ${EASE}, opacity .2s`; img.style.transform = ""; img.style.opacity = "";
      bg.style.transition = "opacity .3s"; bg.style.opacity = "1";
      root.classList.add("shown");
      setTimeout(() => { if (it.el) it.el.classList.remove("viewing"); }, 360);
    }
    function close(opts) {
      if (!isOpen || closing) return;
      closing = true;
      const fromHistory = opts && opts.fromHistory;
      if (pushed && !fromHistory) { pushed = false; ignorePop = true; try { history.back(); } catch (_) {} }
      pushed = false;
      const it = cur(), img = imgs[1];
      const finish = () => {
        root.hidden = true; isOpen = false; closing = false;
        root.classList.remove("shown", "closing", "dragging-down", "zoomed", "bare");
        document.documentElement.classList.remove("viewer-open");
        imgs.forEach(i => { i.style.transform = ""; i.style.opacity = ""; i.style.transition = ""; });
        bg.style.opacity = ""; z.s = 1; z.tx = z.ty = 0;
        if (it && it.el) it.el.classList.remove("viewing");
        api.onClose && api.onClose(it);
      };
      if (reduce() || !it) return finish();
      if (it.el && api.tileRect(it)) { try { it.el.scrollIntoView({ block: "nearest" }); } catch (_) {} }
      const t = it ? tileTransform(it, img) : null;
      root.classList.add("closing");
      img.style.transition = `transform .3s ${EASE}, opacity .25s`;
      if (t) { img.style.transform = t; if (it.el) it.el.classList.add("viewing"); }
      else { img.style.transform = "scale(.9)"; img.style.opacity = "0"; }
      bg.style.transition = "opacity .28s"; bg.style.opacity = "0";
      setTimeout(finish, 310);
    }
    window.addEventListener("popstate", () => {
      if (ignorePop) { ignorePop = false; return; }
      if (isOpen) { pushed = false; close({ fromHistory: true }); }
    });
    document.addEventListener("keydown", e => {
      if (!isOpen) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" && idx < items().length - 1) go(1);
      else if (e.key === "ArrowLeft" && idx > 0) go(-1);
    });

    // ---------- pulsanti ----------
    function setMode(m, silent) {
      mode = m;
      [...$("vMode").children].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === m)));
      if (!silent) render();
    }
    $("vMode").addEventListener("click", e => { const b = e.target.closest("button"); if (b && b.dataset.v !== mode) setMode(b.dataset.v); });
    $("vClose").addEventListener("click", () => close());
    $("vRotate").addEventListener("click", () => {
      const it = cur(); if (!it) return;
      const b = $("vRotate").firstElementChild;
      b.classList.remove("spin"); void b.offsetWidth; b.classList.add("spin");
      api.rotate(it); stage.classList.add("busy");
    });
    $("vDelete").addEventListener("click", () => {
      const del = $("vDelete"), it = cur(); if (!it) return;
      if (del.dataset.sure !== "1") {
        del.dataset.sure = "1"; del.lastChild.textContent = " Tocca di nuovo";
        setTimeout(() => { if (del.dataset.sure === "1") { del.dataset.sure = ""; del.lastChild.textContent = " Elimina"; } }, 2500);
        return;
      }
      api.remove(it);
      if (!items().length) { closing = false; close(); return; }
      render();
    });

    // alternativa gratuita: app ChatGPT (condividi originale + prompt) e importazione del risultato
    const vmsg = t => { const m = $("vMsg"); m.textContent = t || ""; clearTimeout(m._h); if (t) m._h = setTimeout(() => { m.textContent = ""; }, 7000); };
    $("vChatgpt").addEventListener("click", async () => {
      const it = cur(); if (!it || !api.chatgpt) return;
      vmsg("Preparo la foto originale…");
      try { vmsg(await api.chatgpt(it)); } catch (e) { vmsg("Non riuscito: " + (e.message || e)); }
    });
    $("vImport").addEventListener("click", async () => {
      const it = cur(); if (!it || !api.importResult) return;
      try { const t = await api.importResult(it); if (t) { vmsg(t); render(); } } catch (e) { vmsg("Importazione non riuscita: " + (e.message || e)); }
    });

    // chiamata da app.js quando una foto è stata rielaborata (es. dopo Ruota)
    function refreshItem(it) {
      if (!isOpen) return;
      const list = items(), i = list.indexOf(it);
      if (i < 0 || Math.abs(i - idx) > 1) return;
      if (i === idx) stage.classList.toggle("busy", api.isWorking(it));
      setImg(imgs[1 + (i - idx)], it);
    }

    return { open, close, refreshItem, get isOpen() { return isOpen; } };
  };
})();
