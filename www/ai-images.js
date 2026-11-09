// FOTOGRAFO: modifica delle foto con il modello di immagini di OpenAI (POST /v1/images/edits).
// Esegue SOLO il prompt scritto dal regista (director.js): l'app non aggiunge testo e non ha prompt fissi.
// La chiave OpenAI la inserisce l'utente in Impostazioni (localStorage): MAI nel codice o nei commit.
// Le chiamate fetch passano dal lato nativo (CapacitorHttp); il FormData viene inviato come multipart.
//
// Parametri verificati sulla documentazione OpenAI (novembre 2026):
//  • modello gpt-image-2.6-sunburst (uscito il 4/11/2026: il "base model" per modifiche precise);
//    ripiego 2.6-flare, 2.5-sunburst, gpt-image-2.
//  • i modelli 2.x elaborano SEMPRE le immagini in ingresso ad alta fedeltà: input_fidelity va omesso
//    (lo inviamo solo ai gpt-image-1.x che lo accettano); "complexity" omesso = high.
//  • quality "high" (Bozza = "low"), size 1024x1536, output_format png, n = 1 (uno scatto alla volta).
//  • la risposta contiene "usage" (token di ingresso/uscita): serve a calcolare il costo reale.
(function () {
  "use strict";

  const AVAILABLE = true;
  const ENDPOINT = "https://api.openai.com/v1/images/edits";
  const DEFAULT_MODEL = "gpt-image-2.6-sunburst";
  const FALLBACK_MODELS = ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare", "gpt-image-2.5-sunburst", "gpt-image-2"];
  const MAX_SIDE = 4096;   // lato massimo inviato (le foto dei telefoni restano a piena risoluzione)

  // prezzi (dollari per token) dalla pagina prezzi OpenAI per GPT Image 2.x: ingresso immagine 8 $/M,
  // ingresso testo 5 $/M, uscita immagine 30 $/M
  const PRICE = { imageIn: 8e-6, textIn: 5e-6, out: 30e-6 };
  // stima PRIMA dell'invio (1024x1536): uscita ≈ 0,20 $ in Alta; ≈ 0,02 $ per ogni immagine inviata
  const OUT_COST = { low: 0.01, medium: 0.05, high: 0.20 };
  const IN_COST = 0.02;
  function estimateCost(o) {
    const q = (o && o.quality) || "high", imgs = Math.max(1, (o && o.images) || 1);
    return (OUT_COST[q] != null ? OUT_COST[q] : OUT_COST.high) + IN_COST * imgs;
  }
  function costFromUsage(u) {
    if (!u) return null;
    const det = u.input_tokens_details || {};
    const img = det.image_tokens != null ? det.image_tokens : (u.input_tokens || 0);
    const txt = det.text_tokens != null ? det.text_tokens : 0;
    return img * PRICE.imageIn + txt * PRICE.textIn + (u.output_tokens || 0) * PRICE.out;
  }
  const formatCost = d => "≈ " + (d || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";

  // foto originale a piena risoluzione: solo orientamento corretto (EXIF) e lato max MAX_SIDE, JPEG 95
  async function fullQuality(blob, rot) {
    let bmp;
    try { bmp = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
    catch (_) {
      bmp = await new Promise((res, rej) => { const im = new Image(), u = URL.createObjectURL(blob); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("decode")); }; im.src = u; });
    }
    const w0 = bmp.width, h0 = bmp.height, k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const w = Math.round(w0 * k), h = Math.round(h0 * k), r = (((rot || 0) % 360) + 360) % 360;
    const c = document.createElement("canvas");
    c.width = r % 180 ? h : w; c.height = r % 180 ? w : h;
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high";
    x.translate(c.width / 2, c.height / 2); x.rotate(r * Math.PI / 180);
    x.drawImage(bmp, -w / 2, -h / 2, w, h);
    if (bmp.close) bmp.close();
    const out = await new Promise(res => c.toBlob(res, "image/jpeg", 0.95));
    out.width = c.width; out.height = c.height;
    return out;
  }

  function b64ToBlob(b64, type) {
    const bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: type || "image/png" });
  }
  async function errorFrom(res) {
    let msg = "";
    try { const j = await res.json(); msg = (j && j.error && j.error.message) || ""; } catch (_) {}
    const e = new Error(msg || ("HTTP " + res.status));
    e.status = res.status; e.apiMessage = msg;
    return e;
  }
  const extOf = b => /png/.test(b.type || "") ? "png" : /webp/.test(b.type || "") ? "webp" : "jpg";

  /**
   * Uno scatto del fotografo.
   * @param {object} o
   * @param {Blob}   o.image      foto originale del capo (piena risoluzione: vedi fullQuality)
   * @param {Blob}   [o.reference] foto modello di stile (seconda immagine)
   * @param {string} o.prompt     prompt scritto dal regista, inviato COSÌ COM'È
   * @param {string} o.apiKey     chiave OpenAI dell'utente
   * @param {string} [o.model]    predefinito gpt-image-2.6-sunburst
   * @param {string} [o.quality]  "high" (predefinita) | "medium" | "low" (bozza)
   * @param {string} [o.size]     "1024x1536" (verticale) o "1024x1024"
   * @returns {Promise<{blob:Blob, model:string, usage:object|null, cost:number}>}
   */
  async function editImage(o) {
    if (!o || !o.apiKey) { const e = new Error("Manca la chiave OpenAI: aggiungila in Impostazioni."); e.code = "nokey"; throw e; }
    if (!o.prompt || !o.prompt.trim()) throw new Error("Manca il prompt del regista.");
    const models = [o.model || DEFAULT_MODEL, ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
    const images = o.reference ? [o.image, o.reference] : [o.image];
    let last = null;
    for (const model of models) {
      const fd = new FormData();
      fd.append("model", model);
      images.forEach((b, i) => fd.append(images.length > 1 ? "image[]" : "image", b, (i ? "reference." : "garment.") + extOf(b)));
      fd.append("prompt", o.prompt);
      fd.append("size", o.size || "1024x1536");
      fd.append("quality", o.quality || "high");
      fd.append("output_format", "png");
      fd.append("n", "1");
      if (/^gpt-image-1/.test(model)) fd.append("input_fidelity", "high");
      const res = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: "Bearer " + o.apiKey }, body: fd });
      if (res.ok) {
        const j = await res.json();
        const d = j && j.data && j.data[0];
        let blob = null;
        if (d && d.b64_json) blob = b64ToBlob(d.b64_json, "image/png");
        else if (d && d.url) blob = await (await fetch(d.url)).blob();
        if (!blob) throw new Error("Risposta di OpenAI senza immagine.");
        const usage = (j && j.usage) || null;
        const real = costFromUsage(usage);
        return { blob, model, usage, cost: real != null ? real : estimateCost({ quality: o.quality, images: images.length }), estimated: real == null };
      }
      last = await errorFrom(res);
      const modelProblem = (res.status === 404 || res.status === 400 || res.status === 403) && /model/i.test(last.apiMessage || "");
      if (!modelProblem) break;
    }
    throw last || new Error("Scatto non riuscito.");
  }

  function errorText(e) {
    if (!e) return "Scatto non riuscito.";
    if (e.code === "nokey") return e.message;
    if (e.status === 401) return "Chiave OpenAI non valida: controllala in Impostazioni.";
    if (e.status === 429) return "OpenAI: limite raggiunto o credito esaurito. Riprova più tardi.";
    if (e.status === 400 && /safety|moderation/i.test(e.apiMessage || "")) return "OpenAI ha rifiutato la foto (filtro di sicurezza).";
    if (e.status >= 500) return "OpenAI è occupato: riprova tra poco.";
    if (e.status) return "OpenAI: " + (e.apiMessage || "errore " + e.status);
    return e.message || "Nessuna connessione con OpenAI.";
  }

  window.AIImages = { AVAILABLE, DEFAULT_MODEL, editImage, errorText, fullQuality, estimateCost, costFromUsage, formatCost };
})();
