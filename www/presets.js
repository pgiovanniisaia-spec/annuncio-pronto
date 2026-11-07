// Preset del "Servizio guidato": uno per categoria. Per aggiungerne uno nuovo (giacca, scarpe…)
// copia il blocco "cappotto", cambia testi, passi e prompt, e togli `soon: true`.
// Campi di un passo:
//   id        identificativo (cover, front, back)            title / short  testi
//   ai        modalità di ai-images.js per l'elaborazione (null = solo sistemazione locale)
//   straighten  raddrizza da solo trovando l'angolo del capo     framing  controlla con Claude che il capo sia intero
//   level     "vertical" (telefono dritto in piedi) o "flat" (telefono parallelo al pavimento) per la bolla
//   shape     sagoma tratteggiata nella fotocamera ("hanging", "flat", "detail")
//   order     posizione nell'annuncio finale                  tips  consigli mostrati nella scaletta
(function () {
  "use strict";

  // ---- disegni della scaletta (SVG semplici, a linea) ----
  const S = (inner) => `<svg viewBox="0 0 120 90" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const COAT_HANG = `<path d="M60 18v-5a3 3 0 1 1 3 3"/><path d="M60 18 41 27h38z"/><path d="M47 27l-9 6-4 30 7 1 3-19 1 34h30l1-34 3 19 7-1-4-30-9-6"/><path d="M60 27v40M57 36h0M57 46h0M57 56h0"/>`;
  const COAT_FLAT = `<path d="M47 24l-15 8-12 22 7 4 13-15v34h40V43l13 15 7-4-12-22-15-8"/><path d="M53 24l7 10 7-10M60 34v40"/>`;
  const ILL = {
    cover: S(`<rect x="2" y="4" width="116" height="70" rx="3" stroke-dasharray="3 4" opacity=".45"/>
      <rect x="6" y="14" width="16" height="26" rx="1" opacity=".7"/><path d="M24 22l10 4M24 30l10 2M24 38l10 0" opacity=".6"/>
      <g transform="translate(8 0)">${COAT_HANG}</g><path d="M10 80h100" opacity=".6"/>
      <rect x="96" y="40" width="12" height="20" rx="2.5"/><path d="M92 50h-6" stroke-dasharray="2 3"/>`),
    front: S(`<rect x="8" y="10" width="104" height="72" rx="6" opacity=".45"/><g transform="translate(0 -4)">${COAT_FLAT}</g>
      <path d="M100 4v10m-4-4 4 4 4-4" opacity=".8"/>`),
    back: S(`<rect x="8" y="10" width="104" height="72" rx="6" opacity=".45"/><g transform="translate(0 -4)">${COAT_FLAT.replace("M53 24l7 10 7-10M60 34v40", "M53 24q7 4 14 0M60 30v44")}</g>
      <path d="M96 10a8 8 0 1 1-6 3m-1-5v6h6" opacity=".8"/>`),
    brand: S(`<rect x="28" y="20" width="64" height="44" rx="4"/><path d="M40 36h40M48 48h24" stroke-width="4"/><path d="M34 26h0M86 26h0M34 58h0M86 58h0"/>`),
    size: S(`<rect x="34" y="12" width="52" height="66" rx="4"/><path d="M46 28h28" stroke-width="5"/><path d="M44 42h32M44 52h26M44 62h30" opacity=".7"/>`),
    lining: S(`<path d="M36 14l-14 8-6 54h26l2-46 16-10 16 10 2 46h26l-6-54-14-8"/><path d="M44 30l4 46M76 30l-4 46M52 26l8 6 8-6" opacity=".6"/><path d="M50 40l20 30M58 38l14 22M48 52l14 22" opacity=".35"/>`),
    pockets: S(`<rect x="22" y="18" width="76" height="56" rx="5" opacity=".45"/><path d="M34 46h30v18H34zM34 46l15 6 15-6"/><circle cx="82" cy="30" r="6"/><circle cx="82" cy="50" r="6"/><circle cx="80" cy="30" r="1"/><circle cx="84" cy="30" r="1"/>`),
    defect: S(`<rect x="14" y="14" width="70" height="56" rx="5" opacity=".45"/><circle cx="62" cy="44" r="18"/><path d="M75 57l20 20" stroke-width="5"/><path d="M56 38l10 10M66 38l-10 10" opacity=".8"/>`),
    tape: S(`<path d="M8 50h88v16H8z"/><path d="M18 50v7M28 50v5M38 50v7M48 50v5M58 50v7M68 50v5M78 50v7M88 50v5"/><circle cx="100" cy="40" r="16"/><circle cx="100" cy="40" r="4"/><path d="M20 30l30-14 30 14" opacity=".45"/>`)
  };

  // ---- sagome tratteggiate della fotocamera (viewBox 100x150: si adattano allo schermo) ----
  const SHAPES = {
    hanging: `<path d="M50 9v-3a2.4 2.4 0 1 1 2.4 2.4"/><path d="M50 12 30 22h40z"/>
      <path d="M36 22l-10 6-5 52 8 1 4-32 1 76h32l1-76 4 32 8-1-5-52-10-6"/><path d="M50 22v105"/>`,
    flat: `<path d="M38 30 24 37 8 72l9 5 15-22v64h36V55l15 22 9-5-16-35-14-7"/><path d="M42 30l8 10 8-10M50 40v79"/>`,
    detail: `<rect x="14" y="40" width="72" height="70" rx="6"/>`
  };

  const RULE_NOTE = "Copertina con sfondo ritoccato, le altre foto mostrano il capo reale.";

  const PRESETS = {
    cappotto: {
      id: "cappotto",
      name: "Cappotto",
      icon: COAT_HANG,
      cat: "Capispalla",
      tipo: "Cappotto",
      steps: [
        { id: "cover", short: "Copertina", title: "Copertina – appeso al muro", ai: "coat-cover", framing: true, level: "vertical", shape: "hanging", order: 1,
          tips: ["Cappotto su una gruccia, appeso a un gancio o a una porta, contro un muro chiaro e libero.",
                 "Luce naturale da una finestra di lato, niente flash.",
                 "Cappotto intero nell'inquadratura: telefono all'altezza del petto, dritto, a 1,5–2 m."] },
        { id: "front", short: "Fronte", title: "Fronte in piano", ai: "flat-clean", straighten: true, framing: true, level: "flat", shape: "flat", order: 2,
          tips: ["Stendilo su un letto o un pavimento chiaro.",
                 "Maniche distese e abbottonato, senza pieghe grosse.",
                 "Foto dall'alto, con il telefono parallelo al piano (bolla verde)."] },
        { id: "back", short: "Retro", title: "Retro in piano", ai: "flat-clean", straighten: true, framing: true, level: "flat", shape: "flat", order: 3,
          tips: ["Stessa posizione della foto di fronte, con il cappotto girato.",
                 "Distendi bene spalle e maniche.",
                 "Telefono parallelo al piano, cappotto intero."] }
      ],
      // dettagli facoltativi ("Aggiungi dettaglio"): MAI modificati con l'AI
      details: [
        { type: "brand", title: "Etichetta della marca", order: 4, label: true, tips: ["Avvicinati finché la marca è nitida e leggibile."] },
        { type: "size", title: "Etichetta taglia e composizione", order: 5, label: true, tips: ["Inquadra taglia e percentuali dei tessuti (es. 80% lana)."] },
        { type: "lining", title: "Fodera", order: 6, tips: ["Apri il cappotto e mostra la fodera interna."] },
        { type: "pockets", title: "Tasche e bottoni", order: 6, tips: ["Un dettaglio ravvicinato di bottoni, tasche o cuciture."] },
        { type: "defect", title: "Difetto", order: 7, tips: ["Mostra bene eventuali segni, macchie o fili tirati: è più onesto e evita resi."] },
        { type: "tape", title: "Foto con il metro", order: 8, tips: ["Metro steso lungo la misura (es. spalle o lunghezza)."] }
      ],
      measures: [
        { id: "shoulders", label: "Spalle" }, { id: "pit", label: "Ascella-ascella" },
        { id: "length", label: "Lunghezza" }, { id: "sleeve", label: "Manica" }
      ],
      listing: {
        titleStyle: "Cappotto [Marca] [materiali principali] [taglia], es. «Cappotto Max Mara lana e cashmere IT52»",
        honestNote: RULE_NOTE
      }
    },
    // in arrivo: stessa struttura, da completare
    giacca: { id: "giacca", name: "Giacca", soon: true, icon: COAT_HANG },
    scarpe: { id: "scarpe", name: "Scarpe", soon: true, icon: `<path d="M24 60c10 0 16-12 22-20l10 6c4 2 10 4 18 6l20 4c4 1 6 4 6 8v4H18c0-6 2-8 6-8z"/><path d="M18 68h82"/>` },
    abbigliamento: { id: "abbigliamento", name: "Maglie e altro", soon: true, icon: `<path d="M44 20l-16 8-8 16 10 4 4-6v38h52V42l4 6 10-4-8-16-16-8q-16 10-32 0z"/>` }
  };

  window.LL_PRESETS = { PRESETS, ILL, SHAPES, ORDER: ["cappotto", "giacca", "scarpe", "abbigliamento"] };
})();
