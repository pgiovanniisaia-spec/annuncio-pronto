// Modifica delle foto con il modello di immagini di OpenAI (endpoint /v1/images/edits).
// La chiave OpenAI la inserisce l'utente in Impostazioni (localStorage): MAI nel codice o nei commit.
// Le chiamate fetch passano dal lato nativo (CapacitorHttp), quindi niente problemi CORS sul telefono;
// il FormData con la foto viene inviato come multipart dal ponte nativo.
(function () {
  "use strict";

  const AVAILABLE = true;
  const ENDPOINT = "https://api.openai.com/v1/images/edits";
  // modello attuale per primo; se l'API non lo conosce si prova il successivo
  const FALLBACK_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"];

  // Regola obbligatoria in ogni prompt: il capo deve restare identico.
  const RULE = "Keep the garment exactly as in the photo: same color, texture, pattern, shape, collar, buttons, pockets, labels, wrinkles and any defects. Only replace the background and lighting. No added accessories, text, logos or people.";

  const MODES = {
    // copertina del servizio guidato: cappotto appeso, set da studio
    "coat-cover": "Professional e-commerce product photo of the coat hanging on its hanger. Replace the wall and surroundings with a photo studio set: a soft, seamless transition between wall and floor with a barely visible horizon line, light grey or warm white backdrop, soft natural diffused light coming from one side, and a light, realistic shadow of the coat on the backdrop. The hanger may stay. Keep the full coat visible, centered, not cropped.",
    // fronte e retro in piano: via il disordine, fondo neutro
    "flat-clean": "Product photo of the coat laid flat, seen from directly above. Remove all clutter around the coat (objects, bedding patterns, furniture, floor details) and replace the surroundings with a plain, uniform, light neutral background with soft even lighting and a very subtle natural shadow. Keep the full coat visible, not cropped.",
    // opzioni della scheda AI
    "studio-white": "Replace the background with a clean seamless white photo studio backdrop with a soft natural shadow.",
    "neutral": "Replace the background with a plain, evenly lit light grey neutral backdrop.",
    "ghost-mannequin": "Show the garment as if worn by an invisible ghost mannequin on a clean white background, keeping its real fabric, colors and details.",
    "custom": ""
  };

  function buildPrompt(mode, extra) {
    const base = MODES[mode] != null ? MODES[mode] : "";
    return [base, extra && extra.trim(), RULE].filter(Boolean).join(" ");
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

  /**
   * Modifica una foto con l'AI.
   * @param {object} o
   * @param {Blob}   o.image    foto di partenza (JPEG o PNG)
   * @param {string} o.mode     una delle chiavi di MODES
   * @param {string} [o.prompt] istruzione libera (mode "custom") o aggiunta al prompt
   * @param {string} o.apiKey   chiave OpenAI dell'utente
   * @param {string} [o.model]  es. "gpt-image-2"
   * @param {string} [o.quality] "low" | "medium" | "high"
   * @param {string} [o.size]   es. "1024x1536" (verticale)
   * @returns {Promise<Blob>}   la foto modificata
   */
  async function editImage(o) {
    if (!o || !o.apiKey) { const e = new Error("Manca la chiave OpenAI: aggiungila in Impostazioni."); e.code = "nokey"; throw e; }
    const prompt = buildPrompt(o.mode, o.prompt);
    const models = [o.model || FALLBACK_MODELS[0], ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
    let last = null;
    for (const model of models) {
      const fd = new FormData();
      fd.append("model", model);
      fd.append("image", o.image, (o.image.type || "").includes("png") ? "photo.png" : "photo.jpg");
      fd.append("prompt", prompt);
      fd.append("size", o.size || "1024x1536");
      fd.append("quality", o.quality || "medium");
      fd.append("n", "1");
      const res = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: "Bearer " + o.apiKey }, body: fd });
      if (res.ok) {
        const j = await res.json();
        const d = j && j.data && j.data[0];
        if (d && d.b64_json) return b64ToBlob(d.b64_json, "image/png");
        if (d && d.url) { const r = await fetch(d.url); return await r.blob(); }
        throw new Error("Risposta di OpenAI senza immagine.");
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

  window.AIImages = { AVAILABLE, MODES, RULE, buildPrompt, editImage, errorText };
})();
