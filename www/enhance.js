// Correzione foto condivisa tra pagina e worker.
// Bilanciamento del bianco, livelli automatici, saturazione leggera,
// sfondo chiaro schiarito (facoltativo) e nitidezza leggera.
function enhancePixels(d, w, h, whiten) {
  const n = d.length / 4;
  const hist = new Uint32Array(256);
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < d.length; i += 4) { mr += d[i]; mg += d[i + 1]; mb += d[i + 2]; }
  mr /= n; mg /= n; mb /= n;
  const mgray = (mr + mg + mb) / 3;
  const gain = m => Math.min(1.18, Math.max(0.86, 1 + (mgray / Math.max(m, 1) - 1) * 0.5));
  const gr = gain(mr), gg = gain(mg), gb = gain(mb);

  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] * gr + 0.587 * d[i + 1] * gg + 0.114 * d[i + 2] * gb;
    hist[Math.min(255, l | 0)]++;
  }
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.005) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.005) { hi = v; break; } }
  lo = Math.min(lo, 40); hi = Math.max(hi, 200);
  const span = Math.max(40, hi - lo);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.min(1, Math.max(0, (v - lo) / span));
    lut[v] = Math.round(255 * Math.pow(t, 0.93));
  }

  for (let i = 0; i < d.length; i += 4) {
    let r = lut[Math.min(255, d[i] * gr) | 0];
    let g = lut[Math.min(255, d[i + 1] * gg) | 0];
    let b = lut[Math.min(255, d[i + 2] * gb) | 0];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * 1.08; g = l + (g - l) * 1.08; b = l + (b - l) * 1.08;
    if (whiten) {
      const ch = Math.max(r, g, b) - Math.min(r, g, b);
      if (l > 185 && ch < 30) {
        const t = Math.min(1, (l - 185) / 45);
        const s = t * t * (3 - 2 * t) * (1 - ch / 30) * 0.9;
        r += (255 - r) * s; g += (255 - g) * s; b += (255 - b) * s;
      }
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }

  const src = new Uint8ClampedArray(d), amt = 0.28, row = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * row + x * 4;
      for (let c = 0; c < 3; c++) {
        const v = src[i + c];
        d[i + c] = v + amt * (4 * v - src[i - 4 + c] - src[i + 4 + c] - src[i - row + c] - src[i + row + c]);
      }
    }
  }
}
