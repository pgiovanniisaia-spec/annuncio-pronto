// Scheda "AI": lo studio dove si applicano le sistemazioni alle foto selezionate.
// app.js lo crea con createStudio(api); i risultati tornano nella griglia di Home (stesse foto, stesso ordine).
(function () {
  "use strict";

  window.createStudio = function createStudio(api) {
    const $ = id => document.getElementById(id);
    const strip = $("aiStrip"), sel = new Set(), thumbs = new Map();
    const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    let busy = false;

    function status(msg, err) { const s = $("aiStatus"); s.textContent = msg || ""; s.classList.toggle("err", !!err); }
    const selected = () => api.items().filter(it => sel.has(it.id));

    function makeThumb(it) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sthumb"; b.setAttribute("role", "option");
      const cv = document.createElement("canvas"); cv.width = 120; cv.height = 160;
      const n = document.createElement("span"); n.className = "snum";
      const ck = document.createElement("span"); ck.className = "scheck"; ck.innerHTML = CHECK;
      const ed = document.createElement("span"); ed.className = "sedit"; ed.textContent = "✦";
      const ring = document.createElement("i"); ring.className = "ring"; ring.setAttribute("aria-hidden", "true");
      b.append(cv, ring, n, ck, ed);
      b.addEventListener("click", () => {
        if (sel.has(it.id)) sel.delete(it.id); else sel.add(it.id);
        sync();
      });
      return { el: b, cv, n, drawn: "" };
    }
    function draw(t, it) {
      const src = api.thumbSource(it);
      if (!src) return;
      const key = (it.ver || 0) + ":" + src.width + "x" + src.height + ":" + (it.orig ? 1 : 0);
      if (t.drawn === key) return;
      t.drawn = key;
      const c = t.cv, h = Math.round(120 * src.height / src.width);
      if (c.height !== h) c.height = h;
      c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    }

    // ridisegna la striscia: chiamata da app.js quando le foto cambiano
    function sync() {
      const list = api.items();
      const ids = new Set(list.map(i => i.id));
      [...sel].forEach(id => { if (!ids.has(id)) sel.delete(id); });
      for (const [id, t] of thumbs) if (!ids.has(id)) { t.el.remove(); thumbs.delete(id); }
      list.forEach((it, i) => {
        let t = thumbs.get(it.id);
        if (!t) { t = makeThumb(it); thumbs.set(it.id, t); }
        if (strip.children[i] !== t.el) strip.insertBefore(t.el, strip.children[i] || null);
        draw(t, it);
        t.n.textContent = i === 0 ? "Copertina" : String(i + 1);
        const on = sel.has(it.id);
        t.el.classList.toggle("on", on);
        t.el.setAttribute("aria-selected", String(on));
        t.el.setAttribute("aria-label", `Foto ${i + 1}${on ? ", selezionata" : ""}`);
        t.el.classList.toggle("working", api.isWorking(it));
        t.el.classList.toggle("edited", !!(it.edits && it.edits.size));
        t.el.title = api.editLabel(it) || "";
      });
      const empty = !list.length;
      $("aiEmpty").hidden = !empty; strip.hidden = empty; $("aiSelTools").hidden = empty;
      $("aiSelCount").textContent = empty ? "" : sel.size ? `${sel.size} di ${list.length} selezionate` : `${list.length} foto`;
      ["aiAuto", "aiCrop", "aiTiltApply", "aiTiltReset"].forEach(id => { $(id).disabled = busy || !sel.size; });
      if (window.AIImages && window.AIImages.AVAILABLE) $("aiEditGo").disabled = busy || !sel.size;
      previewTilt();
    }

    // anteprima del raddrizzamento sulle miniature selezionate, mentre si muove il cursore
    function previewTilt() {
      const v = Number($("aiTilt").value) || 0;
      $("aiTiltVal").textContent = (v > 0 ? "+" : "") + v.toLocaleString("it-IT") + "°";
      for (const [id, t] of thumbs) {
        const it = api.items().find(x => x.id === id);
        const d = sel.has(id) && it ? v - (it.tilt || 0) : 0;
        const k = api.coverScale(d, t.cv.width, t.cv.height);
        t.cv.style.transform = d ? `rotate(${d}deg) scale(${k})` : "";
      }
    }
    $("aiTilt").addEventListener("input", previewTilt);

    async function run(label, fn) {
      const list = selected();
      if (!list.length) { status("Seleziona almeno una foto nella striscia qui sopra.", true); return; }
      busy = true; sync(); status(`${label}…`);
      try {
        const msg = await fn(list);
        status(msg || `Fatto: ${list.length} ${list.length === 1 ? "foto aggiornata" : "foto aggiornate"}. Le trovi in Home.`);
      } catch (e) {
        status(e && e.message ? e.message : "Operazione non riuscita.", true);
      } finally { busy = false; sync(); }
    }

    $("aiAll").addEventListener("click", () => { api.items().forEach(it => sel.add(it.id)); sync(); });
    $("aiNone").addEventListener("click", () => { sel.clear(); sync(); });
    $("aiAuto").addEventListener("click", () => run("Sistemazione automatica in corso", api.applyAuto));
    $("aiCrop").addEventListener("click", () => run("Claude cerca il capo nelle foto", api.applyCrop));
    $("aiTiltApply").addEventListener("click", () => {
      const v = Number($("aiTilt").value) || 0;
      run("Raddrizzo le foto", list => api.applyTilt(list, v));
    });
    $("aiTiltReset").addEventListener("click", () => {
      $("aiTilt").value = "0"; previewTilt();
      run("Tolgo il raddrizzamento", list => api.applyTilt(list, 0));
    });

    // sezione OpenAI: attiva quando ai-images.js è disponibile
    const ready = !!(window.AIImages && window.AIImages.AVAILABLE);
    document.querySelectorAll('#aiEditModes input, #aiEditPrompt, #aiEditGo').forEach(el => { el.disabled = !ready; });
    const soon = document.querySelector(".soon");
    if (ready && soon) { soon.classList.remove("soon"); soon.removeAttribute("aria-disabled"); const pill = soon.querySelector(".pill"); if (pill) pill.textContent = "OpenAI"; }
    $("aiEditGo").addEventListener("click", () => {
      const r = document.querySelector('input[name="aiEdit"]:checked');
      const mode = r ? r.value : "studio-white", extra = $("aiEditPrompt").value;
      if (mode === "custom" && !extra.trim()) { status("Scrivi l'istruzione libera nel riquadro qui sopra.", true); return; }
      const useRef = $("aiUseRef").checked && hasRef, n = $("aiVariants").checked ? 2 : 1;
      run("L'AI sta modificando le foto (può volerci un minuto)", list => api.applyAiEdit(list, mode, extra, { useRef, n }));
    });
    // foto di riferimento stile (salvata sul telefono, riusata per tutte le copertine)
    let hasRef = false;
    if (window.LLStyleRef) {
      window.LLStyleRef.mount($("aiRefBox"));
      const onRef = b => { hasRef = !!b; $("aiUseRef").closest("label").hidden = !b; updateCost(); };
      window.LLStyleRef.get().then(onRef); window.LLStyleRef.onChange(onRef);
    }
    $("aiVariants").checked = !!(api.variants && api.variants());
    $("aiVariants").addEventListener("change", () => { if (api.setVariants) api.setVariants($("aiVariants").checked); updateCost(); });
    $("aiUseRef").addEventListener("change", updateCost);
    function updateCost() {
      if (!api.costText) return;
      $("aiCost").textContent = api.costText($("aiVariants").checked ? 2 : 1, $("aiUseRef").checked && hasRef);
    }
    updateCost();

    return { sync, updateCost: () => updateCost() };
  };
})();
