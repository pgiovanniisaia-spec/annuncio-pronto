// Fotocamera guidata del servizio guidato.
//  1) @capacitor-community/camera-preview (CameraPreview): anteprima dietro la pagina, con sopra
//     sagoma tratteggiata, bolla (verde quando il telefono è dritto) e avviso di luce scarsa;
//  2) se non parte: fotocamera di sistema (@capacitor/camera);
//  3) nel browser: selettore file con capture="environment".
// Uso: const cam = createGuidedCamera({ plugin, haptic }); const shot = await cam.open({ title, shape, level });
// shot = { blob, sensorTilt } oppure null se annullato.
(function () {
  "use strict";

  window.createGuidedCamera = function createGuidedCamera(opts) {
    const plugin = opts.plugin, haptic = opts.haptic || (() => {});
    const SHAPES = (window.LL_PRESETS && window.LL_PRESETS.SHAPES) || {};
    let previewBroken = false;

    const b64ToBlob = (b64, type) => {
      const bin = atob(b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return new Blob([u], { type: type || "image/jpeg" });
    };
    const stripPrefix = s => String(s || "").replace(/^data:[^,]*,/, "");

    // ---------- inclinazione dal sensore (gravità) ----------
    // vertical: telefono in piedi (copertina appesa); flat: telefono parallelo al pavimento (foto dall'alto)
    function levelFrom(g, level) {
      const ax = g.x || 0, ay = g.y || 0, az = g.z || 0, deg = r => r * 180 / Math.PI;
      if (level === "flat") return { x: deg(Math.atan2(ax, Math.abs(az) || 1e-6)), y: deg(Math.atan2(ay, Math.abs(az) || 1e-6)) };
      return { x: deg(Math.atan2(ax, Math.abs(ay) || 1e-6)), y: deg(Math.atan2(az, Math.abs(ay) || 1e-6)) };
    }

    // ---------- interfaccia sopra l'anteprima ----------
    function buildUI(o) {
      const el = document.createElement("div");
      el.id = "gcam"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Fotocamera guidata");
      el.innerHTML = `
        <div class="gc-top">
          <button type="button" class="vbtn round" data-act="cancel" aria-label="Annulla">✕</button>
          <div class="gc-title"><strong></strong><span></span></div>
        </div>
        <svg class="gc-shape" viewBox="0 0 100 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <g fill="none" stroke-linecap="round" stroke-linejoin="round">${SHAPES[o.shape] || SHAPES.detail || ""}</g></svg>
        <div class="gc-level" aria-live="polite"><span class="gc-bubble"><i></i></span><b>Raddrizza il telefono</b></div>
        <div class="gc-light" hidden>Luce scarsa: avvicinati a una finestra</div>
        <div class="gc-bottom">
          <button type="button" class="vbtn" data-act="gallery">Galleria</button>
          <button type="button" class="gc-shutter" data-act="shoot" aria-label="Scatta"><span></span></button>
          <span class="gc-spacer"></span>
        </div>`;
      el.querySelector(".gc-title strong").textContent = o.title || "Scatta la foto";
      el.querySelector(".gc-title span").textContent = o.hint || (o.level === "flat" ? "Telefono parallelo al piano, cappotto dentro la sagoma" : "Telefono dritto, cappotto dentro la sagoma");
      return el;
    }

    // ---------- fallback: fotocamera di sistema o selettore file ----------
    function pickFile(capture) {
      return new Promise(res => {
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = "image/*";
        if (capture) inp.setAttribute("capture", "environment");
        inp.style.cssText = "position:fixed;left:-9999px;opacity:0";
        let done = false;
        inp.onchange = () => { done = true; const f = inp.files && inp.files[0]; inp.remove(); res(f ? { blob: f, sensorTilt: null } : null); };
        // se l'utente annulla il selettore, al ritorno della pagina restituiamo null
        const onFocus = () => setTimeout(() => { if (!done) { inp.remove(); res(null); } window.removeEventListener("focus", onFocus); }, 900);
        window.addEventListener("focus", onFocus);
        document.body.append(inp); inp.click();
      });
    }
    async function systemCamera() {
      const Camera = plugin("Camera");
      if (!Camera) return pickFile(true);
      try {
        const r = await Camera.getPhoto({ source: "CAMERA", resultType: "base64", quality: 90, correctOrientation: true, saveToGallery: false, width: 2400 });
        if (!r || !r.base64String) return null;
        return { blob: b64ToBlob(r.base64String, "image/" + (r.format || "jpeg")), sensorTilt: null };
      } catch (e) {
        if (/cancel/i.test(String(e && e.message))) return null;
        return pickFile(true);
      }
    }

    // ---------- fotocamera guidata ----------
    async function open(o) {
      o = o || {};
      const CP = !previewBroken && plugin("CameraPreview");
      if (!CP) return systemCamera();
      const ui = buildUI(o);
      document.body.append(ui);
      document.documentElement.classList.add("camera-on");
      try {
        await CP.start({ position: "rear", toBack: true, enableZoom: true, lockAndroidOrientation: true, disableExifHeaderStripping: false });
      } catch (e) {
        ui.remove(); document.documentElement.classList.remove("camera-on");
        if (/denied|permission/i.test(String(e && e.message))) { previewBroken = false; return systemCamera(); }
        previewBroken = true;            // il plugin non funziona su questo telefono: da ora fotocamera di sistema
        return systemCamera();
      }
      return new Promise(resolve => {
        let level = { x: 0, y: 0 }, wasOk = false, closed = false, lightTimer = 0, busy = false;
        const lv = ui.querySelector(".gc-level"), dot = ui.querySelector(".gc-bubble i"), lvText = lv.querySelector("b");
        const light = ui.querySelector(".gc-light");
        const onMotion = e => {
          const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
          level = levelFrom(g, o.level);
          const dev = Math.max(Math.abs(level.x), Math.abs(level.y)), ok = dev <= 3;
          const k = 2.2, cx = Math.max(-26, Math.min(26, level.x * k)), cy = Math.max(-26, Math.min(26, level.y * k));
          dot.style.transform = `translate(${cx}px,${cy}px)`;
          lv.classList.toggle("ok", ok);
          lvText.textContent = ok ? "Dritto ✓" : "Raddrizza il telefono";
          if (ok && !wasOk) haptic();
          wasOk = ok;
        };
        window.addEventListener("devicemotion", onMotion);
        // controllo della luce ogni ~1,5 s su un fotogramma piccolo
        const sampleLight = async () => {
          if (closed) return;
          try {
            const r = await CP.captureSample({ quality: 25 });
            const img = new Image();
            img.onload = () => {
              if (closed || !window.LLQuality) return;
              const c = document.createElement("canvas"); c.width = 64; c.height = 64;
              c.getContext("2d").drawImage(img, 0, 0, 64, 64);
              light.hidden = window.LLQuality.brightness(c) >= 70;
            };
            img.src = "data:image/jpeg;base64," + stripPrefix(r && r.value);
          } catch (_) {}
          lightTimer = setTimeout(sampleLight, 1500);
        };
        lightTimer = setTimeout(sampleLight, 700);
        // chiude la fotocamera; `then` (facoltativa) produce il risultato dopo la chiusura
        const finish = async (result, then) => {
          if (closed) return;
          closed = true; clearTimeout(lightTimer);
          window.removeEventListener("devicemotion", onMotion);
          try { await CP.stop(); } catch (_) {}
          ui.remove(); document.documentElement.classList.remove("camera-on");
          resolve(then ? await then() : result);
        };
        ui.addEventListener("click", async e => {
          const b = e.target.closest("[data-act]"); if (!b || busy) return;
          const act = b.dataset.act;
          if (act === "cancel") return finish(null);
          if (act === "gallery") return finish(null, () => pickFile(false));
          if (act === "shoot") {
            busy = true; ui.classList.add("flash"); haptic();
            const tiltNow = Math.max(Math.abs(level.x), Math.abs(level.y));
            try {
              const r = await CP.capture({ quality: 90 });
              await finish({ blob: b64ToBlob(stripPrefix(r && r.value), "image/jpeg"), sensorTilt: wasOk ? 0 : tiltNow });
            } catch (_) { busy = false; ui.classList.remove("flash"); }
          }
        });
      });
    }

    return { open, pickFile };
  };
})();
