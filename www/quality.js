// Controlli veloci sulle foto, tutti sul telefono (niente internet):
//   • luminosità media (foto troppo scura)
//   • nitidezza (varianza del Laplaciano: foto mossa o sfocata)
//   • inclinazione (direzione prevalente dei bordi rispetto a orizzontale/verticale)
// L'inclinazione stimata serve anche a raddrizzare fronte e retro.
(function () {
  "use strict";

  const LIMITS = { dark: 62, blur: 28, tilt: 6 };

  function gray(canvas, maxSide) {
    const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const w = Math.max(8, Math.round(canvas.width * k)), h = Math.max(8, Math.round(canvas.height * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
    // riduzione in due passaggi: toglie il rumore fine che altrimenti sembra "bordi" allineati ai pixel
    if (k < 0.5) {
      const m = document.createElement("canvas"); m.width = Math.round(canvas.width * k * 2); m.height = Math.round(canvas.height * k * 2);
      const mx = m.getContext("2d"); mx.imageSmoothingQuality = "high"; mx.drawImage(canvas, 0, 0, m.width, m.height);
      x.drawImage(m, 0, 0, w, h);
    } else x.drawImage(canvas, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return { g, w, h };
  }

  function brightness(canvas) {
    const { g } = gray(canvas, 96);
    let s = 0; for (let i = 0; i < g.length; i++) s += g[i];
    return s / g.length;
  }

  function sharpness(canvas) {
    const { g, w, h } = gray(canvas, 480);
    let n = 0, mean = 0, m2 = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      n++; const dl = l - mean; mean += dl / n; m2 += dl * (l - mean);
    }
    return n > 1 ? m2 / (n - 1) : 0;
  }

  // Angolo (gradi) di cui è ruotata l'immagine: positivo = ruotata in senso orario.
  // Per raddrizzare si ruota di -angolo. null se non c'è una direzione chiara.
  function tilt(canvas) {
    const { g, w, h } = gray(canvas, 320);
    const BIN = 0.5, RANGE = 20, nb = Math.round(2 * RANGE / BIN) + 1, hist = new Float32Array(nb);
    let total = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - 1] + g[i + w - 1]);
      const gy = (g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1]);
      const mag = Math.hypot(gx, gy);
      if (mag < 90) continue;
      // direzione del bordo riportata all'asse più vicino (0° = orizzontale o verticale)
      let a = Math.atan2(gy, gx) * 180 / Math.PI;
      a = ((a % 90) + 90) % 90; if (a > 45) a -= 90;
      const wgt = mag * mag;          // contano soprattutto i bordi netti (capo, righe, muro/pavimento)
      total += wgt;
      if (Math.abs(a) <= RANGE) hist[Math.round((a + RANGE) / BIN)] += wgt;
    }
    if (!total) return null;
    // smussa e trova il picco
    let best = -1, bi = 0;
    for (let i = 0; i < nb; i++) {
      const v = (hist[i - 1] || 0) * 0.5 + hist[i] + (hist[i + 1] || 0) * 0.5;
      if (v > best) { best = v; bi = i; }
    }
    if (best / total < 0.06) return null;
    // affinamento parabolico del picco (precisione sotto il mezzo grado)
    const sm = i => (hist[i - 1] || 0) * 0.5 + (hist[i] || 0) + (hist[i + 1] || 0) * 0.5;
    const l = sm(bi - 1), c = sm(bi), r = sm(bi + 1), den = l - 2 * c + r;
    const off = den ? Math.max(-1, Math.min(1, 0.5 * (l - r) / den)) : 0;
    return Math.round(((bi + off) * BIN - RANGE) * 10) / 10;
  }

  /**
   * @param {HTMLCanvasElement} canvas foto
   * @param {object} [o] { sensorTilt: deviazione in gradi letta dal sensore al momento dello scatto }
   * @returns {{brightness:number, sharpness:number, tilt:number|null, issues:{code:string,text:string}[]}}
   */
  function analyze(canvas, o) {
    const b = brightness(canvas), s = sharpness(canvas), t = tilt(canvas);
    const issues = [];
    if (s < LIMITS.blur) issues.push({ code: "blur", text: "La foto sembra mossa o sfocata." });
    if (b < LIMITS.dark) issues.push({ code: "dark", text: "La foto è troppo scura: avvicinati a una finestra." });
    const st = o && typeof o.sensorTilt === "number" ? o.sensorTilt : null;
    if ((st != null && Math.abs(st) > 8) || (t != null && Math.abs(t) > LIMITS.tilt))
      issues.push({ code: "tilt", text: `La foto è inclinata${t != null ? ` di circa ${Math.abs(Math.round(t))}°` : ""}: tieni il telefono dritto.` });
    return { brightness: Math.round(b), sharpness: Math.round(s), tilt: t, issues };
  }

  window.LLQuality = { analyze, brightness, sharpness, tilt, LIMITS };
})();
