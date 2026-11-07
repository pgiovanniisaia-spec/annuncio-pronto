# ListLab — come ottenere l'app sul telefono Android

ListLab è il nuovo nome di "Annuncio Pronto": si installa sopra la versione già presente, senza perdere chiave e storico.

## Cosa ti serve sul computer (una volta sola)
1. **Claude Code**, che hai già.
2. **Node.js**: scaricalo da nodejs.org (versione LTS).
3. **Android Studio**: scaricalo da developer.android.com/studio. Aprilo una volta e lascia che installi l'Android SDK.

## Creare l'app
1. Estrai questo zip in una cartella, per esempio `Documenti/annuncio-pronto`.
2. Apri il terminale in quella cartella e avvia `claude`.
3. Scrivi: **«Compila l'APK seguendo CLAUDE.md»**.
   Claude Code controlla cosa manca, ti guida e alla fine crea il file `ListLab.apk`.

## Installarla sul telefono
- Mandati il file `ListLab.apk`, per esempio con Google Drive, Telegram o una mail a te stesso.
- Aprilo dal telefono. Android ti chiede di consentire l'installazione da quella app: conferma.

## La chiave per le descrizioni
Le foto si sistemano anche senza internet. Per scrivere le descrizioni serve una chiave API di Anthropic:
1. Vai su console.anthropic.com, registrati e aggiungi un po' di credito (bastano 5 €).
2. Crea una chiave in "API Keys".
3. Nell'app tocca **Impostazioni** nella barra in basso, incollala e salva. Resta solo sul tuo telefono.

Costo indicativo: con "Veloce", meno di un centesimo per annuncio. Con "Più accurato", qualche centesimo.

## Come si usa
La barra in basso ha tre schede: **AI**, **Home** e **Impostazioni**. L'app si apre su Home.

1. In **Home** aggiungi o scatta fino a 20 foto: si sistemano subito.
   - **Tocca** una foto per vederla a schermo intero: zoom con due dita o doppio tocco, scorri a destra e sinistra, confronta «Originale / Sistemata», ruota o elimina. Chiudi con ✕, col tasto indietro o trascinando verso il basso.
   - **Tieni premuta** una foto: senti una piccola vibrazione. Se lasci, si apre grande; se invece la **trascini**, cambi l'ordine. La prima è sempre la copertina.
   - L'**occhio** mostra l'originale nella griglia, ↻ ruota, × toglie.
2. Nella scheda **AI** scegli una o più foto e applica:
   - **Sistemazione automatica** (luce, colori, sfondo chiaro);
   - **Ritaglio intelligente** (Claude trova il capo e lo centra; serve la chiave API);
   - **Raddrizza** (rotazione fine fino a ±10°).
   Le foto modificate tornano in Home con il segno ✦. «Modifica con AI (OpenAI)» arriva nel prossimo aggiornamento.
3. Scegli la categoria e inserisci marca, taglia e condizioni.
4. Tocca **Scrivi l'annuncio**. Le prime 5 foto vengono anche ritagliate meglio attorno al capo.
5. Le foto, sempre nell'ordine della griglia (01-copertina.jpg, 02.jpg…):
   - **Condividi tutte**: mandale direttamente a Vinted.
   - **Salva nel telefono**: finiscono nella Galleria, in Immagini › ListLab › (titolo dell'annuncio).
   - **Scarica ZIP**: un unico file da mandare dove vuoi.
6. Usa **Copia tutto** e incolla il testo nell'annuncio.

La chiave API si inserisce nella scheda **Impostazioni**.
