// "Doppio lavoro": REGISTA (Claude) + FOTOGRAFO (OpenAI).
// Il codice orchestra soltanto: il regista scrive analisi, sintesi, prompt e checklist; il fotografo
// esegue il prompt così com'è; il regista controlla il risultato. Le istruzioni del regista sono in
// director-prompt.js. Nessuno scatto parte senza conferma dell'utente (lo gestisce director-ui.js).
(function () {
  "use strict";

  // prezzi Claude (dollari per token) dalla pagina prezzi Anthropic: Sonnet 5.5 2/10 $ per milione,
  // Haiku 5.5 0,10/0,50 $ per milione
  const CLAUDE_PRICE = {
    "claude-sonnet-5-5": { in: 2e-6, out: 10e-6 },
    "claude-haiku-5-5": { in: 0.1e-6, out: 0.5e-6 }
  };
  const priceOf = m => CLAUDE_PRICE[m] || (/haiku/.test(m) ? CLAUDE_PRICE["claude-haiku-5-5"] : CLAUDE_PRICE["claude-sonnet-5-5"]);
  // stima prima dell'invio: ~5.000 token in ingresso (istruzioni + 2 foto a 1024 px) e ~1.200 in uscita
  const CLAUDE_EST = { in: 5000, out: 1200 };

  async function toJpeg1024(blob, maxSide) {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const k = Math.min(1, (maxSide || 1024) / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c.toDataURL("image/jpeg", 0.88).split(",")[1];
  }
  function parseJson(text) {
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a < 0 || b < a) { const e = new Error("Il regista ha risposto in un formato non leggibile."); e.code = "json"; throw e; }
    return JSON.parse(text.slice(a, b + 1));
  }

  window.createDirector = function createDirector(cfg) {
    const P = window.LLDirectorPrompt, AI = window.AIImages;

    async function claude(images, prompt, maxTokens) {
      const key = cfg.claudeKey(), model = cfg.directorModel();
      if (!key) { const e = new Error("Per il regista serve la chiave Claude: aggiungila in Impostazioni."); e.code = "nokey"; throw e; }
      const content = images.map(data => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
      content.push({ type: "text", text: prompt });
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: P.SYSTEM, messages: [{ role: "user", content }] })
      });
      if (!res.ok) {
        let msg = ""; try { msg = ((await res.json()).error || {}).message || ""; } catch (_) {}
        const e = new Error(res.status === 401 ? "Chiave Claude non valida: controllala in Impostazioni." : res.status === 429 ? "Claude: troppe richieste, riprova tra poco." : "Regista non raggiungibile" + (msg ? ": " + msg : ` (errore ${res.status})`));
        e.status = res.status; throw e;
      }
      const data = await res.json();
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      const u = data.usage || {}, pr = priceOf(model);
      const cost = (u.input_tokens || 0) * pr.in + (u.output_tokens || 0) * pr.out;
      return { json: parseJson(text), cost, usage: u, model };
    }

    // ---- brief (anche dopo una correzione dell'utente) ----
    async function brief(o) {
      const imgs = [await toJpeg1024(o.original)];
      if (o.reference) imgs.push(await toJpeg1024(o.reference));
      const text = P.briefRequest({ lavoro: o.lavoro, hasRef: !!o.reference, info: o.info || {}, previous: o.previous || null, correction: o.correction || "" });
      const r = await claude(imgs, text, 2500);
      const b = r.json;
      if (!b || typeof b.prompt_fotografo !== "string" || !b.prompt_fotografo.trim()) { const e = new Error("Il regista non ha scritto il prompt per il fotografo."); e.code = "json"; throw e; }
      b.sintesi = Array.isArray(b.sintesi) ? b.sintesi : [];
      b.checklist = Array.isArray(b.checklist) ? b.checklist : [];
      b.analisi = b.analisi || {};
      return { brief: b, cost: r.cost };
    }
    // ---- uno scatto del fotografo: il prompt va a OpenAI così com'è ----
    async function shoot(o) {
      try {
        return await AI.editImage({ image: o.original, reference: o.reference || null, prompt: o.prompt,
          apiKey: cfg.openaiKey(), model: cfg.imgModel(), quality: cfg.imgQuality(), size: cfg.imgSize() });
      } catch (e) { throw new Error(AI.errorText(e)); }
    }
    // ---- controllo del regista ----
    async function check(o) {
      const imgs = [await toJpeg1024(o.original), await toJpeg1024(o.result)];
      const r = await claude(imgs, P.checkRequest({ lavoro: o.lavoro, prompt: o.prompt, checklist: o.brief.checklist, analisi: o.brief.analisi }), 2500);
      const c = r.json || {};
      c.controlli = Array.isArray(c.controlli) ? c.controlli : [];
      c.problemi = Array.isArray(c.problemi) ? c.problemi : [];
      c.approvata = !!c.approvata;
      return { report: c, cost: r.cost };
    }
    // ---- costo stimato di UNO scatto (Claude: brief + controllo; OpenAI: 1 immagine) ----
    function estimate(hasRef) {
      const pr = priceOf(cfg.directorModel());
      const claudeOne = CLAUDE_EST.in * pr.in + CLAUDE_EST.out * pr.out;
      const openai = AI.estimateCost({ quality: cfg.imgQuality(), images: hasRef ? 2 : 1 });
      return { claude: claudeOne * 2, openai, total: claudeOne * 2 + openai };
    }
    return { brief, shoot, check, estimate };
  };
})();
