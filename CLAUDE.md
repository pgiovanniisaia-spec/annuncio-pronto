# ListLab — istruzioni per Claude Code

ListLab (prima "Annuncio Pronto") è un'app Android (Capacitor 7) che sistema le foto per Vinted e scrive titolo, descrizione e hashtag con l'API di Anthropic. L'utente parla italiano: rispondi in italiano, con spiegazioni semplici (non è uno sviluppatore).

## Struttura
- `www/` — tutta l'app, HTML/CSS/JS puro, nessun bundler.
  - `index.html`, `style.css`, `app.js` — interfaccia e logica. Il nome dell'app è SOLO nella costante `APP_NAME` di `app.js` (gli elementi con `data-app-name` lo ricevono da lì; anche la cartella nella Galleria).
  - `viewer.js` — visualizzatore a schermo intero (`createViewer(api)`): zoom con due dita e doppio tocco, scorrimento tra le foto, Originale/Sistemata, Ruota, Elimina, chiusura con ✕, Esc, trascinamento in basso o tasto indietro (via `history.pushState`).
  - `studio.js` — scheda AI (`createStudio(api)`): striscia di foto selezionabili, Sistemazione automatica, Ritaglio intelligente (Claude), Raddrizza (±10°).
  - `ai-images.js` — modifica foto con OpenAI (`/v1/images/edits`, modello `gpt-image-2` con ripiego su `gpt-image-1.5`/`gpt-image-1`, multipart via CapacitorHttp). Ogni prompt termina con la regola obbligatoria `RULE` ("Keep the garment exactly as in the photo…"). Modalità: `coat-cover`, `flat-clean`, `studio-white`, `neutral`, `ghost-mannequin`, `custom`.
  - `presets.js` — preset del Servizio guidato (`window.LL_PRESETS`): per categoria passi (copertina/fronte/retro), dettagli facoltativi, ordine finale, disegni SVG, sagome della fotocamera, misure e regole per l'annuncio. "Cappotto" attivo; giacca/scarpe/altro `soon: true`.
  - `guided.js` — Servizio guidato (`createGuided(api)`): scelta categoria → scaletta → controlli dopo lo scatto → elaborazione in sottofondo (2 alla volta) → prima/dopo → lettura etichette (Claude) → ordine → annuncio (`writeListing` con regole del preset) → "Annuncio pronto". Stato in `localStorage` (`ll_guided_v1`), foto in IndexedDB (`listlab/blobs`, chiavi `<uid>:orig|prep|ai`); alla riapertura riprende da solo.
  - `guided-camera.js` — fotocamera guidata: `@capacitor-community/camera-preview` (dietro la pagina, `html.camera-on` rende trasparente lo sfondo) con sagoma, bolla (accelerometro) e avviso luce (`captureSample`); ripiego su `@capacitor/camera`, poi selettore file.
  - `quality.js` — controlli locali: luminosità, nitidezza (varianza del Laplaciano), inclinazione (istogramma delle direzioni dei bordi; serve anche a raddrizzare fronte e retro).
  - `enhance.js` — correzione foto (usata sia dalla pagina sia dal worker).
  - `worker.js` — Web Worker che applica `enhancePixels` senza bloccare lo schermo.
  - `errors.js` — riquadro errori in fondo allo schermo (caricato prima di `app.js`).
  - `vendor/jszip.min.js` — JSZip locale (niente CDN), caricato solo quando serve lo ZIP.
  - `logo.svg` — logo (splash in pagina, intestazioni, Impostazioni).
- Interfaccia: tre schede (AI · Home · Impostazioni) con barra fissa in basso; si parte su Home. Gesti sulla griglia: tocco breve → schermo intero; pressione lunga ferma → vibrazione (`@capacitor/haptics`) e schermo intero al rilascio; pressione lunga + trascinamento → riordino. Pulsante occhio per vedere l'originale.
- Grafica: sfondo verde salvia chiaro `#E8F3EC`, schede bianche, verde scuro `#23584A` per azioni e scheda attiva; tema scuro verde molto scuro (`#0E1A14`). Barre di sistema Android colorate da `scripts/android-setup.mjs`.
- Regole del Servizio guidato: i DETTAGLI (etichette, fodera, difetti, metro) non vanno MAI modificati con l'AI. Se la copertina è AI, la descrizione chiude con "Copertina con sfondo ritoccato, le altre foto mostrano il capo reale." Chiave OpenAI in Impostazioni (`ap_openai_key`), mai nel codice.
- Dettagli in Home: anche Materiale e (per Capispalla) misure spalle, ascella-ascella, lunghezza, manica; i campi letti dall'etichetta hanno la classe `auto` e il chip «letto dall'etichetta».
- `plugins/gallery-saver/` — plugin Capacitor locale (Java) `GallerySaver.saveImage({data, root, folder, fileName, time})`: salva in `Pictures/<root>/<cartella>` via MediaStore, con date crescenti. Collegato in `package.json` come `file:plugins/gallery-saver`.
- `scripts/android-setup.mjs` — da eseguire dopo `npx cap sync android`: nome sotto l'icona (da `appName`), colori delle barre di sistema, splash di Android 12+ (sfondo bianco, `assets/android/splash_icon.png`).
- Logo: beuta da laboratorio con la L e una scintilla (IA), chiara su verde scuro `#23584A` (proposta «I6», scelta dall'utente). Sorgente `assets/logo-mark.svg`; `npm run logo` (serve Playwright) rigenera `assets/icon.png`, `assets/icon-foreground.png`, `assets/icon-background.png`, `www/logo.svg` e `assets/android/splash_icon.png`.
- `signing/debug.keystore` — keystore di debug fisso usato dal workflow (password `android`).
- `capacitor.config.json` — appName `ListLab`, appId `it.annunciopronto.app` (NON cambiarlo: è l'identità dell'app su Android, cambiandolo ListLab si installerebbe come app nuova invece di aggiornare quella esistente), `CapacitorHttp` attivo (le chiamate `fetch` all'API passano dal lato nativo, niente problemi CORS).
- `assets/icon.png`, `icon-foreground.png`, `icon-background.png` — icone 1024×1024 per `@capacitor/assets` (il primo piano viene inserito con un margine del 16,7%).
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
7. L'APK è in `android/app/build/outputs/apk/debug/app-debug.apk`. Copialo in una cartella facile da trovare (es. la cartella del progetto come `ListLab.apk`) e spiega all'utente come installarlo:
   - collegare il telefono via USB con "Debug USB" attivo ed eseguire `adb install -r ListLab.apk`, oppure
   - mandarsi il file (Google Drive, Telegram, email) e aprirlo sul telefono, consentendo "Installa app sconosciute" quando Android lo chiede.

Se la versione 7 di Capacitor non è più l'ultima, va bene restare sulla 7; aggiorna solo se la compilazione lo richiede, e sempre tutti i pacchetti `@capacitor/*` insieme.

## Permessi Android
- Fotocamera e galleria passano dal selettore file della WebView: non servono permessi extra.
- «Salva nel telefono» usa il plugin `GallerySaver` (MediaStore, nessun permesso da Android 10; fino ad Android 9 chiede il permesso di scrittura) e salva in `Pictures/ListLab/<cartella>` (`root` = `APP_NAME`). Se il plugin manca, ripiega su `Filesystem` in Documenti/ListLab.
- `@capacitor/haptics` aggiunge il permesso VIBRATE (nessuna richiesta all'utente).
- Fotocamera guidata: `scripts/android-setup.mjs` aggiunge `android.permission.CAMERA` (e `uses-feature camera` non obbligatoria) al manifest; il permesso viene chiesto all'utente al primo uso. camera-preview resta alla 7.x (la 8 richiede Capacitor 8).
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
