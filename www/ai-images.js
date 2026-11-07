// Modifica delle foto con il modello di immagini di OpenAI (POST /v1/images/edits).
// La chiave OpenAI la inserisce l'utente in Impostazioni (localStorage): MAI nel codice o nei commit.
// Le chiamate fetch passano dal lato nativo (CapacitorHttp); il FormData con le foto viene inviato
// come multipart dal ponte nativo.
//
// Qualità (verificato sulla documentazione OpenAI, novembre 2026):
//  • modello: gpt-image-2.5-sunburst (il più recente, ottimizzato per qualità e fedeltà al soggetto;
//    è anche il predefinito per le modifiche). Ripiego: 2.5-flare, gpt-image-2, gpt-image-1.5.
//  • i modelli 2.x elaborano SEMPRE le foto in ingresso ad alta fedeltà e non accettano input_fidelity:
//    lo inviamo ("high") solo ai modelli gpt-image-1.x che lo prevedono.
//  • input: la foto ORIGINALE a piena risoluzione (solo orientamento corretto), JPEG qualità 95.
//  • output: PNG (senza perdita), dimensione verticale 1024x1536; il risultato NON va ritoccato.
(function () {
  "use strict";

  const AVAILABLE = true;
  const ENDPOINT = "https://api.openai.com/v1/images/edits";
  const DEFAULT_MODEL = "gpt-image-2.5-sunburst";
  const FALLBACK_MODELS = ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1.5"];
  const MAX_SIDE = 4096;   // lato massimo inviato (le foto dei telefoni restano a piena risoluzione)

  // Regola obbligatoria: il capo deve restare identico.
  const RULE = "Keep the garment exactly as in the photo: same color, texture, pattern, shape, collar, buttons, pockets, cuffs, length, labels, wrinkles and any defects. Only replace the background and lighting. Do not add text, logos, people or accessories.";
  const REF_NOTE = "Image 1 is the garment to photograph. Image 2 is only a style reference for setting, hanging, framing and lighting: do not copy its garment.";

  // scena reale (muro, gruccia, luce naturale), non ritaglio su bianco
  const COVER = "A realistic smartphone photo of this exact coat hanging on a slim black hanger from a small metal hook on a plain white painted wall. Soft natural daylight from a window on one side, gentle realistic shadow of the coat on the wall, slight wall texture. Full coat visible, centered, straight-on, eye level, with some space above the hook and below the hem. High detail on the wool texture. Keep the garment exactly as in the photo: same color, texture, pattern, shape, collar, buttons, pockets, cuffs, length, labels, wrinkles and any defects. Do not add text, logos, people or accessories.";

  const MODES = {
    // copertina del servizio guidato Cappotto (testo esatto richiesto)
    "coat-cover": COVER,
    // scheda AI: stessa scena per qualunque capo (predefinita)
    "wall-hanging": COVER.replace("this exact coat", "this exact garment").replace("High detail on the wool texture.", "High detail on the fabric texture.").replace("below the hem", "below the garment"),
    // fronte e retro in piano: via il disordine, fondo neutro
    "flat-clean": "A realistic top-down smartphone photo of this exact coat laid flat. Remove all clutter around it (objects, bedding patterns, furniture) and place it on a plain, uniform, light neutral surface with soft even daylight and a very subtle natural shadow. Full coat visible, not cropped. High detail on the fabric texture.",
    // scelte secondarie della scheda AI
    "studio-white": "Pure white e-commerce background (#FFFFFF), evenly lit, with a very soft contact shadow. Full garment visible and centered.",
    "neutral": "Plain, evenly lit light grey neutral backdrop with soft natural light and a subtle realistic shadow.",
    "ghost-mannequin": "Show the garment as if worn by an invisible ghost mannequin on a clean light background, keeping its real fabric, colors and details.",
    "custom": ""
  };

  // costo stimato in dollari (fonte: pagine prezzi OpenAI per le immagini 1024x1536;
  // l'immagine in ingresso costa a parte e OpenAI non dà una formula: stimiamo ~0,02 $ a foto)
  const OUT_COST = { low: 0.01, medium: 0.05, high: 0.20 };
  const IN_COST = 0.02;
  function estimateCost(o) {
    const n = Math.max(1, (o && o.n) || 1), q = (o && o.quality) || "high", imgs = Math.max(1, (o && o.images) || 1);
    return (OUT_COST[q] != null ? OUT_COST[q] : OUT_COST.high) * n + IN_COST * imgs;
  }
  const formatCost = d => "≈ " + d.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";

  function buildPrompt(mode, extra, hasRef) {
    const base = MODES[mode] != null ? MODES[mode] : "";
    const parts = [hasRef ? REF_NOTE : "", base, extra && extra.trim()];
    if (!/Keep the garment exactly as in the photo/.test(base)) parts.push(RULE);
    return parts.filter(Boolean).join(" ");
  }

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
   * Modifica una foto con l'AI.
   * @param {object} o
   * @param {Blob}   o.image      foto del capo (meglio l'originale a piena risoluzione: vedi fullQuality)
   * @param {Blob}   [o.reference] foto di riferimento dello stile (seconda immagine)
   * @param {string} o.mode       una delle chiavi di MODES
   * @param {string} [o.prompt]   istruzione libera (mode "custom") o aggiunta al prompt
   * @param {string} o.apiKey     chiave OpenAI dell'utente
   * @param {string} [o.model]    predefinito gpt-image-2.5-sunburst
   * @param {string} [o.quality]  "low" (bozza) | "medium" | "high" (predefinita)
   * @param {string} [o.size]     "1024x1536" (verticale) o "1024x1024"
   * @param {number} [o.n]        1 o 2 varianti
   * @returns {Promise<Blob[]>}   le foto generate (PNG), da usare così come sono
   */
  async function editImage(o) {
    if (!o || !o.apiKey) { const e = new Error("Manca la chiave OpenAI: aggiungila in Impostazioni."); e.code = "nokey"; throw e; }
    const hasRef = !!o.reference;
    const prompt = buildPrompt(o.mode, o.prompt, hasRef);
    const models = [o.model || DEFAULT_MODEL, ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
    const images = hasRef ? [o.image, o.reference] : [o.image];
    let last = null;
    for (const model of models) {
      const fd = new FormData();
      fd.append("model", model);
      images.forEach((b, i) => fd.append(images.length > 1 ? "image[]" : "image", b, (i ? "reference." : "garment.") + extOf(b)));
      fd.append("prompt", prompt);
      fd.append("size", o.size || "1024x1536");
      fd.append("quality", o.quality || "high");
      fd.append("output_format", "png");
      fd.append("n", String(Math.max(1, Math.min(2, o.n || 1))));
      if (/^gpt-image-1/.test(model)) fd.append("input_fidelity", "high");   // i modelli 2.x lo rifiutano (sempre alta fedeltà)
      const res = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: "Bearer " + o.apiKey }, body: fd });
      if (res.ok) {
        const j = await res.json();
        const out = [];
        for (const d of (j && j.data) || []) {
          if (d.b64_json) out.push(b64ToBlob(d.b64_json, "image/png"));
          else if (d.url) { const r = await fetch(d.url); out.push(await r.blob()); }
        }
        if (!out.length) throw new Error("Risposta di OpenAI senza immagine.");
        out.model = model;
        return out;
      }
      last = await errorFrom(res);
      // modello sconosciuto o non abilitato → prova il successivo; altri errori si fermano qui
      const modelProblem = (res.status === 404 || res.status === 400 || res.status === 403) && /model/i.test(last.apiMessage || "");
      if (!modelProblem) break;
    }
    throw last || new Error("Modifica non riuscita.");
  }

  function errorText(e) {
    if (!e) return "Modifica con AI non riuscita.";
    if (e.code === "nokey") return e.message;
    if (e.status === 401) return "Chiave OpenAI non valida: controllala in Impostazioni.";
    if (e.status === 429) return "OpenAI: limite raggiunto o credito esaurito. Riprova più tardi.";
    if (e.status === 400 && /safety|moderation/i.test(e.apiMessage || "")) return "OpenAI ha rifiutato la foto (filtro di sicurezza).";
    if (e.status >= 500) return "OpenAI è occupato: riprova tra poco.";
    if (e.status) return "OpenAI: " + (e.apiMessage || "errore " + e.status);
    return "Nessuna connessione con OpenAI.";
  }

  window.AIImages = { AVAILABLE, DEFAULT_MODEL, MODES, RULE, REF_NOTE, COVER, buildPrompt, editImage, errorText, fullQuality, estimateCost, formatCost };
})();
