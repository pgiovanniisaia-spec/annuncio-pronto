// Chiamate a Claude con risposta STRUTTURATA tramite tool use (niente più JSON.parse di testo libero).
//
// Formato verificato sulla guida ufficiale dell'API (novembre 2026):
//  • ogni risposta arriva come chiamata a uno strumento definito qui, con `strict: true`: l'input
//    (`content[].type === "tool_use"` → `input`) è già un oggetto valido secondo lo schema;
//  • Claude Sonnet 5.5 e Opus 5.5 RIFIUTANO tool_choice forzato ({type:"tool"} → errore 400), quindi si
//    usa tool_choice {type:"auto"} con disable_parallel_tool_use, si nomina lo strumento nella richiesta
//    e si controlla che la chiamata ci sia (altrimenti si ripete UNA volta);
//  • schema rigoroso: additionalProperties:false e tutti i campi in `required`, niente minimum/maxLength.
// Paracadute: stop_reason "max_tokens" → una ripetizione con più token e richiesta di concisione;
// tool_use mancante o campo obbligatorio vuoto → una ripetizione; infine parser tollerante del testo.
(function () {
  "use strict";

  const ENDPOINT = "https://api.anthropic.com/v1/messages";
  const PRICES = { "claude-sonnet-5-5": [2e-6, 10e-6], "claude-haiku-5-5": [0.1e-6, 0.5e-6] };
  const priceOf = m => PRICES[m] || (/haiku/.test(m) ? PRICES["claude-haiku-5-5"] : PRICES["claude-sonnet-5-5"]);

  // ---------- costruttori di schema rigoroso ----------
  const S = {
    str: d => ({ type: "string", description: d }),
    int: d => ({ type: "integer", description: d }),
    num: d => ({ type: "number", description: d }),
    bool: d => ({ type: "boolean", description: d }),
    arr: (items, d) => ({ type: "array", items, description: d }),
    // tutti i campi obbligatori e nessun campo in più, come richiede strict
    obj: (props, d) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false, ...(d ? { description: d } : {}) })
  };

  // ---------- parser tollerante (ultima rete) ----------
  function tolerantParse(text) {
    if (!text) return null;
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    let s = text.slice(a, b + 1);
    const tries = [
      x => x,
      x => x.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'"),
      x => x.replace(/,\s*([}\]])/g, "$1"),
      // virgolette non escapate dentro un valore stringa su una riga: "chiave": "testo "con" virgolette",
      x => x.split("\n").map(line => {
        const m = line.match(/^(\s*"[^"\\]+"\s*:\s*")(.*)("\s*,?\s*)$/);
        return m ? m[1] + m[2].replace(/\\?"/g, '\\"') + m[3] : line;
      }).join("\n"),
      // a capo e tabulazioni letterali dentro le stringhe
      x => x.replace(/"(?:[^"\\]|\\.)*"/gs, str => str.replace(/\n/g, "\\n").replace(/\t/g, "\\t"))
    ];
    for (let i = 0; i < tries.length; i++) {
      s = tries[i](s);
      try { return JSON.parse(s); } catch (_) {}
    }
    return null;
  }

  function friendly(status, msg) {
    if (status === 401 || status === 403) return "Chiave Claude non valida: controllala in Impostazioni.";
    if (status === 429) return "Claude: troppe richieste ravvicinate, riprova tra un minuto.";
    if (status === 529 || status >= 500) return "Claude è occupato: riprova tra poco.";
    if (status === 400) return "Richiesta rifiutata da Claude: controlla credito e modello su console.anthropic.com.";
    return "Claude non raggiungibile.";
  }

  /**
   * Una chiamata a Claude che deve "consegnare" il risultato con lo strumento indicato.
   * @param {object} o
   * @param {string}   o.key        chiave Anthropic
   * @param {string}   o.model      es. "claude-sonnet-5-5"
   * @param {string}   [o.system]   system prompt
   * @param {string[]} [o.images]   JPEG in base64
   * @param {string}   o.prompt     richiesta in testo
   * @param {object}   o.tool       { name, description, input_schema }
   * @param {number}   [o.maxTokens] predefinito 4000
   * @param {function} [o.validate] (input) => "" se va bene, altrimenti il problema (es. campo vuoto)
   * @param {string}   [o.what]     nome per i messaggi ("Il regista", "Claude")
   * @returns {Promise<{input:object, cost:number, attempts:number, repaired:boolean}>}
   *   Errore finale: e.code = "badresponse", e.raw = risposta grezza (per "Dettagli tecnici").
   */
  async function callTool(o) {
    const what = o.what || "Claude";
    if (!o.key) { const e = new Error("Serve la chiave Claude: aggiungila in Impostazioni."); e.code = "nokey"; throw e; }
    const tool = Object.assign({}, o.tool, { strict: true });
    const pr = priceOf(o.model);
    let maxTokens = Math.max(o.maxTokens || 4000, 1000), extra = "", cost = 0, attempts = 0;
    let retriedTokens = false, retriedMissing = false, lastRaw = "", lastProblem = "";

    while (attempts < 3) {
      attempts++;
      const content = (o.images || []).map(data => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
      content.push({ type: "text", text: `${o.prompt}\n\nConsegna il risultato chiamando lo strumento \`${tool.name}\` una sola volta, senza altro testo.${extra}` });
      const body = { model: o.model, max_tokens: maxTokens, tools: [tool], tool_choice: { type: "auto", disable_parallel_tool_use: true }, messages: [{ role: "user", content }] };
      if (o.system) body.system = o.system;
      let res;
      try {
        res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "x-api-key": o.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify(body) });
      } catch (_) { const e = new Error("Nessuna connessione con Claude."); e.code = "offline"; e.cost = cost; throw e; }
      if (!res.ok) {
        let msg = ""; try { msg = ((await res.json()).error || {}).message || ""; } catch (_) {}
        const e = new Error(friendly(res.status, msg)); e.status = res.status; e.code = "http"; e.raw = msg; e.cost = cost; throw e;
      }
      const data = await res.json();
      const u = data.usage || {};
      cost += (u.input_tokens || 0) * pr[0] + (u.output_tokens || 0) * pr[1];
      const blocks = data.content || [];
      const call = blocks.find(b => b.type === "tool_use" && b.name === tool.name);
      const text = blocks.filter(b => b.type === "text").map(b => b.text).join("");
      lastRaw = JSON.stringify({ stop_reason: data.stop_reason, content: blocks }, null, 2);

      if (data.stop_reason === "refusal") { const e = new Error(`${what} ha rifiutato la richiesta. Prova con un'altra foto.`); e.code = "refusal"; e.raw = lastRaw; e.cost = cost; throw e; }
      // risposta troncata: mai usarla; una ripetizione con più spazio e richiesta di concisione
      if (data.stop_reason === "max_tokens") {
        if (retriedTokens) { lastProblem = "risposta troncata"; break; }
        retriedTokens = true; maxTokens = Math.min(maxTokens * 2, 16000);
        extra = "\nLa risposta precedente era troppo lunga ed è stata troncata: sii più conciso, specialmente nei testi lunghi.";
        continue;
      }
      if (call && call.input && typeof call.input === "object") {
        const problem = o.validate ? o.validate(call.input) : "";
        if (!problem) return { input: call.input, cost, attempts, repaired: false };
        lastProblem = problem;
      } else lastProblem = "strumento non chiamato";
      // tool_use mancante o campo vuoto: una ripetizione automatica
      if (!retriedMissing) {
        retriedMissing = true;
        extra = `\nATTENZIONE: nella risposta precedente ${lastProblem}. Chiama lo strumento \`${tool.name}\` compilando TUTTI i campi.`;
        continue;
      }
      // ultima rete: testo libero riparato
      const parsed = tolerantParse(text);
      if (parsed && !(o.validate && o.validate(parsed))) return { input: parsed, cost, attempts, repaired: true };
      break;
    }
    const e = new Error(`${what} non ha risposto correttamente.`);
    e.code = "badresponse"; e.raw = lastRaw; e.problem = lastProblem; e.cost = cost;
    throw e;
  }

  // controlli comuni per validate()
  const need = (obj, fields) => {
    for (const f of fields) {
      const v = obj[f];
      if (v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length)) return `il campo "${f}" è vuoto`;
    }
    return "";
  };

  window.LLClaude = { callTool, S, need, tolerantParse, priceOf };
})();
