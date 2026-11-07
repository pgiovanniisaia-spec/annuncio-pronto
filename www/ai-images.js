// Modifica delle foto con un modello di immagini (OpenAI) — DA COMPLETARE nel prossimo aggiornamento.
//
// Oggi è disattivato: la scheda AI mostra le opzioni con l'etichetta "In arrivo".
// Per attivarlo:
//   1. aggiungere in Impostazioni un campo per la chiave OpenAI (salvata in localStorage,
//      MAI nel codice o nei commit), come per la chiave Anthropic;
//   2. completare editImage() qui sotto (chiamata all'endpoint di modifica immagini di OpenAI
//      con la foto e il prompt di MODES[mode] o quello libero) e restituire un Blob JPEG/PNG;
//   3. mettere AVAILABLE = true: studio.js abilita da solo la sezione e il pulsante "Genera".
// Le chiamate fetch passano dal lato nativo (CapacitorHttp), quindi niente problemi CORS sul telefono.
(function () {
  "use strict";

  const AVAILABLE = false;

  // Prompt di partenza per ogni opzione della scheda AI (in inglese: i modelli di immagini rendono meglio).
  const MODES = {
    "studio-white": "Replace the background with a clean seamless white photo studio backdrop with a soft natural shadow. Keep the product exactly as it is: same shape, colors, logos, texture and defects.",
    "neutral": "Replace the background with a plain, evenly lit light grey neutral backdrop. Keep the product exactly as it is.",
    "ghost-mannequin": "Show the garment as if worn by an invisible ghost mannequin, keeping the real fabric, colors, logos and defects unchanged, on a clean white background.",
    "custom": ""
  };

  /**
   * Modifica una foto con l'AI.
   * @param {object} o
   * @param {Blob}   o.image   foto di partenza (JPEG, 1200 px)
   * @param {string} o.mode    una delle chiavi di MODES
   * @param {string} [o.prompt] istruzione libera (per mode "custom") o aggiunta al prompt
   * @param {string} o.apiKey  chiave OpenAI dell'utente
   * @returns {Promise<Blob>}  la foto modificata
   */
  async function editImage(o) { // eslint-disable-line no-unused-vars
    // TODO: implementare la chiamata a OpenAI (vedi istruzioni in cima al file).
    throw new Error("La modifica con AI (OpenAI) arriverà nel prossimo aggiornamento.");
  }

  window.AIImages = { AVAILABLE, MODES, editImage };
})();
