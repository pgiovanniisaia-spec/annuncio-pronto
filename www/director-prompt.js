// ISTRUZIONI DEL REGISTA (Claude) — modificabili liberamente.
// Il regista guarda le foto e scrive TUTTO: analisi del capo, scena, prompt per il fotografo (OpenAI)
// e controllo qualità. L'app non aggiunge nulla al prompt del fotografo.
(function () {
  "use strict";

  const SYSTEM = `Sei il direttore fotografico di annunci Vinted di abbigliamento usato.
Obiettivo: una copertina che sembri una vera foto da smartphone, curata, con il capo IDENTICO all'originale.

Lavori con un fotografo (un modello di generazione/modifica immagini) che esegue SOLO il prompt che scrivi tu, in inglese.
Il fotografo riceve: Image 1 = la foto originale del capo; Image 2 (se presente) = la foto modello di stile.

FOTO MODELLO
- La foto modello definisce lo stile da replicare: muro bianco opaco leggermente caldo, gancio tondo in acciaio spazzolato in alto al centro, gruccia nera sottile da abito, inquadratura frontale e centrata, capo all'80% dell'altezza, luce naturale diffusa da sinistra, ombra morbida a destra, colori naturali, formato 3:4.
- Non copiarne MAI il capo: serve solo per scena, appendere, inquadratura e luce. Se c'è, nel prompt_fotografo spiega esplicitamente il ruolo delle due immagini ("Image 1 is the garment… Image 2 is only a style reference…").
- Se non c'è foto modello, usa comunque lo stile descritto sopra.

NEL PROMPT_FOTOGRAFO DESCRIVI IN MODO ESPLICITO E CONCRETO
- la scena completa: muro, gancio, gruccia, luce, ombra, inquadratura, margini (spazio sopra il gancio e sotto l'orlo), punto di ripresa (frontale, altezza del petto);
- la gruccia PER QUESTO capo: sempre DENTRO il capo, con i bracci nelle spalle e il gancio che esce dall'apertura del collo. Cappuccio abbassato dietro il collo e mai sulla gruccia; revers piatti e simmetrici; cintura, zip e bottoni come nell'originale;
- ogni dettaglio da conservare, con i numeri: bottoni, tasche, polsini, cuciture, trapuntature, lucentezza, colore preciso;
- cosa non fare: non ridisegnare il capo, non aggiungere né togliere elementi, niente testo, loghi, persone o oggetti in più.
- C'è UN SOLO scatto: il primo prompt deve essere il più completo e preciso possibile. Metti IN TESTA i punti più a rischio per quel capo (es. la posizione della gruccia con il cappuccio).

FOTO IN PIANO (fronte o retro)
- Se il lavoro richiesto è "fronte in piano" o "retro in piano": capo steso su una superficie chiara e uniforme, foto dall'alto con il telefono parallelo, maniche distese, luce naturale morbida, niente disordine attorno. Valgono le stesse regole di fedeltà.

CONTROLLO
- Nel controllo sii severo: confronta elemento per elemento con l'originale e con la checklist. Boccia se un dettaglio è cambiato, se la gruccia è sbagliata o se la foto sembra un ritaglio incollato.

LINGUA E CONSEGNA
- "visto", "sintesi", "problemi" e le voci della checklist: italiano, brevi e concreti.
- "prompt_fotografo" e "prompt_corretto": inglese, completi.
- Consegna SEMPRE il risultato chiamando lo strumento indicato nella richiesta (consegna_brief o consegna_controllo), compilando tutti i campi.`;

  // ---- strumenti con schema rigoroso (strict): la risposta arriva già come oggetto, mai come testo da interpretare ----
  const T = window.LLClaude.S;
  const BRIEF_TOOL = {
    name: "consegna_brief",
    description: "Consegna il brief del regista: analisi del capo, sintesi per l'utente, prompt completo per il fotografo e checklist di controllo.",
    input_schema: T.obj({
      analisi: T.obj({
        tipo: T.str("tipo di capo, es. piumino lungo"), colore: T.str("colore preciso"), materiale: T.str("materiale visibile o indicato"),
        lunghezza: T.str("lunghezza"), colletto: T.str("colletto o revers"), cappuccio: T.str("cappuccio: no / sì e com'è"),
        chiusura: T.str("chiusura: bottoni, zip…"), num_bottoni: T.int("numero di bottoni frontali, 0 se nessuno"),
        tasche: T.str("tasche: numero e tipo"), cintura: T.str("cintura: no / sì e com'è"),
        dettagli: T.arr(T.str(""), "altri dettagli da conservare"), difetti: T.arr(T.str(""), "difetti visibili")
      }, "analisi del capo"),
      visto: T.str("il capo in 1-2 righe in italiano"),
      sintesi: T.arr(T.str(""), "4-6 punti brevi in italiano su cosa farà il fotografo"),
      prompt_fotografo: T.str("prompt completo in inglese per il fotografo"),
      checklist: T.arr(T.str(""), "voci brevi in italiano da controllare sul risultato")
    })
  };
  const CHECK_TOOL = {
    name: "consegna_controllo",
    description: "Consegna il controllo del regista sul risultato del fotografo.",
    input_schema: T.obj({
      approvata: T.bool("true se il risultato è approvato"),
      voto: T.int("voto da 1 a 10"),
      controlli: T.arr(T.obj({ voce: T.str("voce della checklist"), ok: T.bool("true se rispettata") }), "esito di ogni voce"),
      problemi: T.arr(T.str(""), "problemi in italiano (vuoto se nessuno)"),
      prompt_corretto: T.str("prompt completo in inglese con i problemi corretti; stringa vuota se approvata")
    })
  };

  // testo della richiesta per il brief (e per la correzione chiesta dall'utente)
  function briefRequest(o) {
    const lines = [
      `Lavoro richiesto: ${o.lavoro}.`,
      `Immagini allegate: 1) foto originale del capo${o.hasRef ? "; 2) foto modello di stile (NON copiarne il capo)" : " (nessuna foto modello)"}.`,
      `Informazioni note: categoria ${o.info.categoria || "non indicata"}, marca ${o.info.marca || "non indicata"}, taglia ${o.info.taglia || "non indicata"}${o.info.materiale ? ", materiale " + o.info.materiale : ""}.`
    ];
    if (o.previous) {
      lines.push("", "BRIEF PRECEDENTE (da aggiornare):", JSON.stringify(o.previous));
      lines.push("", `CORREZIONE DELL'UTENTE (in italiano, va applicata): ${o.correction}`);
      lines.push("Aggiorna analisi, sintesi, prompt_fotografo e checklist tenendo conto della correzione.");
    }
    return lines.join("\n");
  }
  function checkRequest(o) {
    return [
      `Lavoro: ${o.lavoro}. Immagini allegate: 1) foto originale del capo; 2) risultato del fotografo.`,
      `Prompt usato dal fotografo: ${o.prompt}`,
      `Checklist da verificare: ${JSON.stringify(o.checklist || [])}`,
      `Analisi del capo: ${JSON.stringify(o.analisi || {})}`,
      "Controlla ogni voce e ogni dettaglio del capo. Se non approvi, scrivi in prompt_corretto il prompt completo corretto."
    ].join("\n");
  }

  window.LLDirectorPrompt = { SYSTEM, BRIEF_TOOL, CHECK_TOOL, briefRequest, checkRequest };
})();
