# Annuncio Pronto — istruzioni per Claude Code

App Android (Capacitor 7) che sistema le foto per Vinted e scrive titolo, descrizione e hashtag con l'API di Anthropic. L'utente parla italiano: rispondi in italiano, con spiegazioni semplici (non è uno sviluppatore).

## Struttura
- `www/` — tutta l'app, HTML/CSS/JS puro, nessun bundler.
  - `index.html`, `style.css`, `app.js` — interfaccia e logica.
  - `enhance.js` — correzione foto (usata sia dalla pagina sia dal worker).
  - `worker.js` — Web Worker che applica `enhancePixels` senza bloccare lo schermo.
  - `errors.js` — riquadro errori in fondo allo schermo (caricato prima di `app.js`).
  - `vendor/jszip.min.js` — JSZip locale (niente CDN), caricato solo quando serve lo ZIP.
  - `logo.png` — logo della schermata di caricamento e delle Impostazioni.
- Interfaccia: due schede (Home, Impostazioni) con barra fissa in basso; foto riordinabili trascinandole (pressione lunga, Pointer Events); pulsante occhio per vedere l'originale.
- `plugins/gallery-saver/` — plugin Capacitor locale (Java) `GallerySaver.saveImage({data, folder, fileName, time})`: salva in `Pictures/AnnuncioPronto/<cartella>` via MediaStore, con date crescenti. Collegato in `package.json` come `file:plugins/gallery-saver`.
- `scripts/android-setup.mjs` — da eseguire dopo `npx cap sync android`: configura la splash di Android 12+ (sfondo bianco, `assets/android/splash_icon.png`).
- `signing/debug.keystore` — keystore di debug fisso usato dal workflow (password `android`).
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
5. `npx cap sync android` e poi `node scripts/android-setup.mjs`
6. Compila: `cd android && ./gradlew assembleDebug` (su Windows `gradlew.bat assembleDebug`)
7. L'APK è in `android/app/build/outputs/apk/debug/app-debug.apk`. Copialo in una cartella facile da trovare (es. la cartella del progetto come `AnnuncioPronto.apk`) e spiega all'utente come installarlo:
   - collegare il telefono via USB con "Debug USB" attivo ed eseguire `adb install -r AnnuncioPronto.apk`, oppure
   - mandarsi il file (Google Drive, Telegram, email) e aprirlo sul telefono, consentendo "Installa app sconosciute" quando Android lo chiede.

Se la versione 7 di Capacitor non è più l'ultima, va bene restare sulla 7; aggiorna solo se la compilazione lo richiede, e sempre tutti i pacchetti `@capacitor/*` insieme.

## Permessi Android
- Fotocamera e galleria passano dal selettore file della WebView: non servono permessi extra.
- «Salva nel telefono» usa il plugin `GallerySaver` (MediaStore, nessun permesso da Android 10; fino ad Android 9 chiede il permesso di scrittura). Se il plugin manca, ripiega su `Filesystem` in Documenti/AnnuncioPronto.
- `Filesystem` scrive nella cache per «Condividi tutte» e «Scarica ZIP».
- File sempre nell'ordine della griglia: `01-copertina.jpg`, `02.jpg`, … Cartella = titolo dell'annuncio, oppure «Annuncio AAAA-MM-GG HH.MM».

## Plugin senza bundler
`window.Capacitor` arriva dal ponte nativo: espone i plugin in `Capacitor.Plugins.Nome` e NON ha `registerPlugin` (che esiste solo importando `@capacitor/core` con un bundler). In `app.js` i plugin si prendono con `plugin("Nome")`, che restituisce `null` se mancano: un plugin assente non deve mai fermare l'app.

## Firma dell'APK
Il workflow mette in `~/.android/debug.keystore` il secret `DEBUG_KEYSTORE_BASE64` se esiste, altrimenti `signing/debug.keystore` (password `android`, alias `androiddebugkey`): tutte le build hanno la stessa firma e si installano sopra le precedenti. Non cambiare questo keystore, o l'utente dovrà disinstallare l'app.

## Splash
`@capacitor/splash-screen`: splash nativa bianca col logo, nascosta da `app.js` appena la pagina è pronta (massimo 1,5 s, `capacitor.config.json`). Poi la splash in pagina (`#splash`) anima il logo e si dissolve. Le icone si generano con `npm run icons` (splash bianca).

## Prova nel browser
`npm run serve` e apri http://localhost:8080 — la sistemazione foto funziona; condividi/salva scaricano i file.

## Regole
- Non inserire mai una chiave API nel codice o nei commit. L'utente la inserisce in Impostazioni dentro l'app (salvata in `localStorage` sul telefono).
- Modelli usati: `claude-haiku-5-5` (Veloce) e `claude-sonnet-5-5` (Più accurato). Se l'API risponde 404 sul modello, cerca il nome corrente su docs.claude.com e aggiornalo in `www/index.html`.
- Mantieni l'app senza bundler, a meno che l'utente non chieda funzioni che lo richiedono.
- Dopo ogni modifica a `www/`, ricorda `npx cap sync android` prima di ricompilare.

## Idee per i prossimi passi (se l'utente le chiede)
- Rimozione completa dello sfondo sul telefono (modello di segmentazione, es. MediaPipe o ONNX Runtime Web incluso nell'app).
- APK firmato per release (`assembleRelease` con keystore) o pubblicazione sul Play Store.
