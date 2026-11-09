// Interfaccia del "doppio lavoro" Regista (Claude) + Fotografo (OpenAI).
// Fasi: 🎬 Analizzo il capo → Sintesi (Procedi / Correggi / Annulla) → 📷 Scatto → 🎬 Controllo → esito.
// REGOLE: nessuna chiamata a OpenAI prima di «Procedi»; 1 immagine per scatto; dopo un controllo
// negativo nessuno scatto automatico: «Riprova con correzione» chiede di nuovo conferma.
// Uso: const flow = createDirectorFlow({ director, confirm: () => bool, toast });
//      const r = await flow.run({ original, reference, lavoro, info, title });
//      r = { choice: "ai"|"orig"|null, blob, brief, report, prompt, shots, costs }
(function () {
  "use strict";

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = d => "≈ " + (d || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
  const money3 = d => (d || 0).toLocaleString("it-IT", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " $";
  const STEPS = [["brief", "🎬", "Regista", "Analizzo il capo…"], ["synth", "📝", "Sintesi", "Decidi tu"], ["shoot", "📷", "Fotografo", "Scatto…"], ["check", "🎬", "Regista", "Controllo…"], ["result", "✅", "Esito", ""]];

  window.createDirectorFlow = function createDirectorFlow(opts) {
    const D = opts.director;
    let root = null;

    function ensure() {
      if (root) return root;
      root = document.createElement("div");
      root.id = "director"; root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true");
      root.innerHTML = `<header class="d-head"><button type="button" class="g-x" data-d="close" aria-label="Annulla">✕</button>
          <div class="g-ttl"><small>Regista + Fotografo</small><strong id="dTitle"></strong></div></header>
        <ol class="d-time" id="dTime"></ol>
        <div class="d-body" id="dBody"></div>
        <footer class="d-foot" id="dFoot"></footer>`;
      document.body.append(root);
      return root;
    }
    const $d = id => document.getElementById(id);

    function run(job) {
      ensure();
      const st = { stage: "brief", brief: null, prompt: "", report: null, result: null, shots: [], costs: { claude: 0, openai: 0, est: false }, error: "", correcting: false, retry: false };
      const urls = [];
      const url = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
      const origUrl = url(job.original), refUrl = job.reference ? url(job.reference) : null;
      let resultUrl = null;
      $d("dTitle").textContent = job.title || "Copertina con AI";
      root.hidden = false; document.documentElement.classList.add("director-open");

      return new Promise(resolve => {
        const finish = (choice) => {
          root.hidden = true; document.documentElement.classList.remove("director-open");
          root.onclick = null;
          resolve({ choice, blob: choice === "ai" ? st.result : null, brief: st.brief, report: st.report, prompt: st.prompt, shots: st.shots, costs: st.costs });
          setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 2000);
        };

        // ---------- cronologia ----------
        function timeline() {
          const order = STEPS.map(s => s[0]), cur = order.indexOf(st.stage === "summary" ? "result" : st.stage === "retry" ? "synth" : st.stage);
          $d("dTime").innerHTML = STEPS.map((s, i) => {
            const state = i < cur ? "done" : i === cur ? (st.error ? "fail" : "on") : "";
            const busy = i === cur && !st.error && ["brief", "shoot", "check"].includes(st.stage);
            const sub = s[0] === "result" && st.report ? (st.report.approvata ? "Approvata" : "Da rivedere") : s[3];
            return `<li class="${state}${busy ? " busy" : ""}"><span class="d-ico">${s[1]}</span><span><b>${s[2]}</b><small>${esc(i === cur || i < cur ? sub : "")}</small></span></li>`;
          }).join("");
        }
        function render() {
          timeline();
          const B = $d("dBody"), F = $d("dFoot");
          if (st.error) {
            B.innerHTML = `<div class="d-err"><strong>Qualcosa non è andato</strong><p>${esc(st.error)}</p></div>`;
            F.innerHTML = `<button type="button" class="btn" data-d="close">Chiudi</button><button type="button" class="btn primary" data-d="again">Riprova</button>`;
            return;
          }
          if (st.stage === "brief" || st.stage === "shoot" || st.stage === "check") {
            const t = { brief: ["🎬", "Il regista studia il capo", "Analizzo colore, materiale, chiusure, tasche e dettagli, poi preparo le istruzioni per il fotografo."],
              shoot: ["📷", "Il fotografo scatta", "Un solo scatto, dalla foto originale a piena qualità."],
              check: ["🎬", "Il regista controlla", "Confronto il risultato con l'originale, voce per voce."] }[st.stage];
            B.innerHTML = `<div class="d-wait"><span class="d-big">${t[0]}</span><h3>${t[1]}</h3><p>${t[2]}</p><div class="d-bar"><i></i></div></div>`;
            F.innerHTML = `<button type="button" class="btn" data-d="close">Annulla</button>`;
            return;
          }
          if (st.stage === "synth") return renderSynth(B, F);
          if (st.stage === "result") return renderResult(B, F);
          if (st.stage === "retry") return renderRetry(B, F);
          if (st.stage === "summary") return renderSummary(B, F);
        }
        const est = () => D.estimate(!!job.reference);
        function costBox(e, label) {
          return `<div class="d-cost"><div><span>Regista (Claude)</span><b>${money(e.claude)}</b></div><div><span>Fotografo (OpenAI), 1 scatto</span><b>${money(e.openai)}</b></div>
            <div class="tot"><span>${label || "Costo stimato"}</span><b>${money(e.total)}</b></div></div>`;
        }
        function renderSynth(B, F) {
          const b = st.brief;
          B.innerHTML = `<h3 class="d-h">Sintesi del lavoro</h3>
            <div class="d-thumbs"><figure><img src="${origUrl}" alt=""><figcaption>Originale</figcaption></figure>
              ${refUrl ? `<figure><img src="${refUrl}" alt=""><figcaption>Foto modello</figcaption></figure>` : `<figure class="none"><span>Nessuna foto modello</span></figure>`}</div>
            <section class="d-sec"><h4>Cosa ho visto</h4><p>${esc(b.visto)}</p></section>
            <section class="d-sec"><h4>Cosa farà il fotografo</h4><ul>${b.sintesi.map(x => `<li>${esc(x)}</li>`).join("")}</ul></section>
            <section class="d-sec"><h4>Controllerò</h4><div class="d-chips">${b.checklist.map(x => `<span>${esc(x)}</span>`).join("")}</div></section>
            ${costBox(est())}
            <p class="hint">Massimo 1 scatto: nessun'altra foto senza la tua conferma.</p>
            ${st.correcting ? `<section class="d-sec d-fix"><h4>Cosa cambiare?</h4>
                <textarea id="dFix" placeholder="Es. gruccia di legno, più spazio sopra"></textarea>
                <div class="d-row"><button type="button" class="btn" data-d="fixcancel">Annulla correzione</button><button type="button" class="btn primary" data-d="fixsend">Aggiorna la sintesi</button></div>
                <span class="hint">Il regista aggiorna brief e prompt. Nessun costo OpenAI.</span></section>` : ""}
            <details class="d-tech"><summary>Dettagli tecnici</summary><pre id="dPrompt">${esc(st.prompt)}</pre></details>`;
          F.innerHTML = st.correcting ? "" : `<button type="button" class="btn" data-d="close">Annulla</button><button type="button" class="btn" data-d="fix">Correggi</button><button type="button" class="btn primary" data-d="go">Procedi</button>`;
          if (st.correcting) setTimeout(() => { const t = $d("dFix"); if (t) t.focus(); }, 50);
        }
        function checksHtml(r) {
          return `<ul class="d-checks">${r.controlli.map(c => `<li class="${c.ok ? "ok" : "ko"}"><span>${c.ok ? "✓" : "✗"}</span>${esc(c.voce)}</li>`).join("")}</ul>
            ${r.problemi.length ? `<div class="d-probs"><strong>Problemi</strong><ul>${r.problemi.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}`;
        }
        function spentBox() {
          return `<div class="d-cost"><div><span>Regista (Claude)</span><b>${money3(st.costs.claude)}</b></div><div><span>Fotografo (OpenAI), ${st.shots.length} ${st.shots.length === 1 ? "scatto" : "scatti"}</span><b>${money3(st.costs.openai)}${st.costs.est ? " (stima)" : ""}</b></div>
            <div class="tot"><span>Speso finora</span><b>${money3(st.costs.claude + st.costs.openai)}</b></div></div>`;
        }
        function renderResult(B, F) {
          const r = st.report;
          B.innerHTML = `<div class="d-res"><div class="d-img"><img id="dImg" src="${resultUrl}" alt="Risultato"><span class="g-tag r">AI</span>
              <button type="button" class="d-hold" data-d="toggleorig">Mostra originale</button></div>
            <div class="d-verdict ${r.approvata ? "ok" : "ko"}"><b>${r.approvata ? "Approvata dal regista" : "Il regista la boccia"}</b><span>Voto ${esc(r.voto)}/10</span></div>
            ${checksHtml(r)}
            ${spentBox()}</div>`;
          F.innerHTML = `<button type="button" class="btn" data-d="orig">Tieni l'originale</button><button type="button" class="btn" data-d="retry">Riprova con correzione</button><button type="button" class="btn primary" data-d="use">Usa questa</button>`;
        }
        function renderRetry(B, F) {
          const r = st.report, next = (r.prompt_corretto || "").trim() || st.prompt;
          const e = D.estimate(!!job.reference), one = { claude: e.claude / 2, openai: e.openai, total: e.claude / 2 + e.openai };
          B.innerHTML = `<h3 class="d-h">Nuovo scatto con correzione</h3>
            <section class="d-sec"><h4>Cosa cambierà</h4><ul>${(r.problemi.length ? r.problemi : ["Il regista ripete lo scatto con istruzioni più precise."]).map(x => `<li>${esc(x)}</li>`).join("")}</ul></section>
            ${costBox(one, "Costo di questo scatto")}
            <p class="hint">Sempre 1 foto. Parte solo se premi «Procedi».</p>
            <details class="d-tech"><summary>Dettagli tecnici</summary><pre id="dPrompt">${esc(next)}</pre></details>`;
          F.innerHTML = `<button type="button" class="btn" data-d="back">Indietro</button><button type="button" class="btn primary" data-d="go2">Procedi</button>`;
        }
        function renderSummary(B, F) {
          B.innerHTML = `<h3 class="d-h">Riepilogo</h3>
            <section class="d-sec"><h4>Scatti fatti: ${st.shots.length}</h4><ul class="d-shots">${st.shots.map((s, i) => `<li class="${s.approvata ? "ok" : "ko"}">Scatto ${i + 1}: ${s.approvata ? "✓ approvato" : "✗ bocciato"} · voto ${esc(s.voto)}/10</li>`).join("")}</ul></section>
            <section class="d-sec"><h4>Scelta</h4><p>${st.choice === "ai" ? "Usata la foto del fotografo come copertina (badge AI)." : "Tenuta la foto originale."}</p></section>
            <div class="d-cost"><div><span>Regista (Claude)</span><b>${money3(st.costs.claude)}</b></div><div><span>Fotografo (OpenAI)</span><b>${money3(st.costs.openai)}${st.costs.est ? " (stima)" : ""}</b></div>
              <div class="tot"><span>Costo reale</span><b>${money3(st.costs.claude + st.costs.openai)}</b></div></div>`;
          F.innerHTML = `<button type="button" class="btn primary" data-d="done">Fatto</button>`;
        }

        // ---------- passi ----------
        async function doBrief(correction) {
          st.stage = "brief"; st.error = ""; render();
          try {
            const r = await D.brief({ original: job.original, reference: job.reference, lavoro: job.lavoro, info: job.info, previous: correction ? st.brief : null, correction });
            st.costs.claude += r.cost; st.brief = r.brief; st.prompt = r.brief.prompt_fotografo;
            st.stage = "synth"; st.correcting = false; render();
            if (!opts.confirm()) {   // conferma disattivata in Impostazioni: la sintesi è solo una notifica
              if (opts.toast) opts.toast("Sintesi: " + (st.brief.sintesi[0] || st.brief.visto || "scatto in corso"));
              setTimeout(() => { if (st.stage === "synth" && !root.hidden) doShoot(st.prompt); }, 1200);
            }
          } catch (e) { st.error = e.message || "Errore del regista."; st.failed = () => doBrief(correction); render(); }
        }
        async function doShoot(prompt) {
          st.stage = "shoot"; st.error = ""; st.prompt = prompt; render();
          try {
            const r = await D.shoot({ original: job.original, reference: job.reference, prompt });
            st.costs.openai += r.cost; st.costs.est = st.costs.est || !!r.estimated;
            st.result = r.blob; resultUrl = url(r.blob);
          } catch (e) { st.error = e.message; st.failed = () => doShoot(prompt); render(); return; }
          await doCheck();
        }
        async function doCheck() {
          st.stage = "check"; st.error = ""; render();
          try {
            const r = await D.check({ original: job.original, result: st.result, prompt: st.prompt, brief: st.brief, lavoro: job.lavoro });
            st.costs.claude += r.cost; st.report = r.report;
            st.shots.push({ prompt: st.prompt, approvata: r.report.approvata, voto: r.report.voto });
            st.stage = "result"; render();      // nessuno scatto automatico, anche se bocciata
          } catch (e) { st.error = e.message; st.failed = () => doCheck(); render(); }
        }

        root.onclick = e => {
          const b = e.target.closest("[data-d]"); if (!b || b.disabled) return;
          const a = b.dataset.d;
          if (a === "close") return finish(null);
          if (a === "again" && st.failed) return st.failed();
          if (a === "fix") { st.correcting = true; return render(); }
          if (a === "fixcancel") { st.correcting = false; return render(); }
          if (a === "fixsend") { const t = ($d("dFix").value || "").trim(); if (!t) { $d("dFix").focus(); return; } return doBrief(t); }
          if (a === "go") return doShoot(st.prompt);
          if (a === "retry") { st.stage = "retry"; return render(); }
          if (a === "back") { st.stage = "result"; return render(); }
          if (a === "go2") return doShoot((st.report.prompt_corretto || "").trim() || st.prompt);
          if (a === "toggleorig") { const im = $d("dImg"), o = im.src === origUrl; im.src = o ? resultUrl : origUrl; b.textContent = o ? "Mostra originale" : "Mostra risultato"; return; }
          if (a === "use") { st.choice = "ai"; st.stage = "summary"; return render(); }
          if (a === "orig") { st.choice = "orig"; st.stage = "summary"; return render(); }
          if (a === "done") return finish(st.choice);
        };
        doBrief("");
      });
    }

    // scheda "Controllo regista" (consultabile dal visualizzatore)
    function showReport(rep, onRestore) {
      const w = document.createElement("div"); w.className = "ll-sheet";
      const r = rep.report || {};
      w.innerHTML = `<div class="ll-sheet-box d-report"><h3>Controllo regista</h3>
        ${rep.brief ? `<p><b>Cosa ho visto:</b> ${esc(rep.brief.visto)}</p>` : ""}
        <div class="d-verdict ${r.approvata ? "ok" : "ko"}"><b>${r.approvata ? "Approvata" : "Bocciata"}</b><span>Voto ${esc(r.voto)}/10</span></div>
        <ul class="d-checks">${(r.controlli || []).map(c => `<li class="${c.ok ? "ok" : "ko"}"><span>${c.ok ? "✓" : "✗"}</span>${esc(c.voce)}</li>`).join("")}</ul>
        ${(r.problemi || []).length ? `<div class="d-probs"><strong>Problemi</strong><ul>${r.problemi.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
        ${rep.costs ? `<p class="hint">Costo: Claude ${money3(rep.costs.claude)} · OpenAI ${money3(rep.costs.openai)} · ${rep.shots ? rep.shots.length : 1} scatti</p>` : ""}
        <details class="d-tech"><summary>Dettagli tecnici</summary><pre>${esc(rep.prompt || "")}</pre></details>
        <div class="ll-btns"><button type="button" class="btn" data-x="restore">Ripristina l'originale</button><button type="button" class="btn primary" data-x="close">Chiudi</button></div></div>`;
      document.body.append(w);
      w.addEventListener("click", e => {
        const b = e.target.closest("[data-x]"); if (!b) return;
        w.remove(); if (b.dataset.x === "restore" && onRestore) onRestore();
      });
    }
    return { run, showReport };
  };
})();
