# Annuncio Pronto — istruzioni per Claude Code

App Android (Capacitor 7) che sistema le foto per Vinted e scrive titolo, descrizione e hashtag con l'API di Anthropic. L'utente parla italiano: rispondi in italiano, con spiegazioni semplici (non è uno sviluppatore).

## Struttura
- `www/` — tutta l'app, HTML/CSS/JS puro, nessun bundler.
  - `index.html`, `style.css`, `app.js` — interfaccia e logica.
  - `enhance.js` — correzione foto (usata sia dalla pagina sia dal worker).
  - `worker.js` — Web Worker che applica `enhancePixels` senza bloccare lo schermo.
- `capacitor.config.json` — appId `it.annunciopronto.app`, `CapacitorHttp` attivo (le chiamate `fetch` all'API passano dal lato nativo, niente problemi CORS).
- `assets/icon.png` — icona sorgente 1024×1024 per `@capacitor/assets`.
- La cartella `android/` NON è inclusa: va generata (vedi sotto).

## Obiettivo principale: produrre l'APK installabile
1. Verifica i prerequisiti e, se mancano, spiega all'utente come installarli (non installare software di sistema senza chiedere):
   - Node.js 20 o più recente (`node -v`)
   - JDK 21 (`java -version`); Android Studio include un JDK: su Windows/macOS puoi usare quello impostando `JAVA_HOME`.
   - Android SDK (si installa con Android Studio); imposta `ANDROID_HOME` (o crea `android/local.properties` con `sdk.dir=...`).
2. `npm install`
3. `npx cap add android` (solo la prima volta)
4. `npm run icons` (genera le icone dell'app da `assets/icon.png`)
5. `npx cap sync android`
6. Compila: `cd android && ./gradlew assembleDebug` (su Windows `gradlew.bat assembleDebug`)
7. L'APK è in `android/app/build/outputs/apk/debug/app-debug.apk`. Copialo in una cartella facile da trovare (es. la cartella del progetto come `AnnuncioPronto.apk`) e spiega all'utente come installarlo:
   - collegare il telefono via USB con "Debug USB" attivo ed eseguire `adb install -r AnnuncioPronto.apk`, oppure
   - mandarsi il file (Google Drive, Telegram, email) e aprirlo sul telefono, consentendo "Installa app sconosciute" quando Android lo chiede.

Se la versione 7 di Capacitor non è più l'ultima, va bene restare sulla 7; aggiorna solo se la compilazione lo richiede, e sempre tutti i pacchetti `@capacitor/*` insieme.

## Permessi Android
- Fotocamera e galleria passano dal selettore file della WebView: non servono permessi extra.
- `Filesystem` scrive in Documenti/AnnuncioPronto e nella cache per la condivisione. Se su qualche versione di Android il salvataggio fallisce, la soluzione preferita è salvare in `Pictures/AnnuncioPronto` tramite MediaStore (plugin nativo piccolo o `@capacitor-community/media`), così le foto compaiono nella Galleria.

## Prova nel browser
`npm run serve` e apri http://localhost:8080 — la sistemazione foto funziona; condividi/salva scaricano i file.

## Regole
- Non inserire mai una chiave API nel codice o nei commit. L'utente la inserisce in Impostazioni dentro l'app (salvata in `localStorage` sul telefono).
- Modelli usati: `claude-haiku-5-5` (Veloce) e `claude-sonnet-5-5` (Più accurato). Se l'API risponde 404 sul modello, cerca il nome corrente su docs.claude.com e aggiornalo in `www/index.html`.
- Mantieni l'app senza bundler, a meno che l'utente non chieda funzioni che lo richiedono.
- Dopo ogni modifica a `www/`, ricorda `npx cap sync android` prima di ricompilare.

## Idee per i prossimi passi (se l'utente le chiede)
- Rimozione completa dello sfondo sul telefono (modello di segmentazione, es. MediaPipe o ONNX Runtime Web incluso nell'app).
- Salvataggio diretto nella Galleria.
- Storico degli annunci creati.
- APK firmato per release (`assembleRelease` con keystore) o pubblicazione sul Play Store.
