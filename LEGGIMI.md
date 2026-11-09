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

## Servizio guidato: un cappotto in pochi tocchi
1. In Home tocca **Nuovo annuncio guidato** e scegli **Cappotto**.
2. Segui la scaletta. Per ogni passo puoi usare **Scatta** o **Scegli dalla galleria**:
   - **Copertina**: cappotto su una gruccia, appeso a una porta o a un gancio, contro un muro chiaro, con la luce di una finestra di lato. Tieni il telefono dritto, all'altezza del petto, a 1,5–2 m.
   - **Fronte** e **Retro**: cappotto steso sul letto o sul pavimento, foto dall'alto con il telefono parallelo al piano.
   - Nella fotocamera fai combaciare il cappotto con la **sagoma tratteggiata** e aspetta che la **bolla diventi verde**. Se compare «Luce scarsa», avvicinati alla finestra.
   - Se una foto è mossa, scura, storta o il cappotto è tagliato, l'app chiede «Rifai lo scatto?».
3. Con **+ Aggiungi dettaglio** fotografa le etichette (marca, taglia e composizione) ed eventualmente fodera, bottoni, difetti e la foto con il metro. Se vuoi, scrivi le misure.
4. Tocca **Elabora e crea l'annuncio**. Il lavoro sulle foto principali è già partito in sottofondo:
   - la copertina diventa una foto da studio;
   - fronte e retro vengono raddrizzati, ritagliati e ripuliti dal disordine;
   - i dettagli restano foto vere.
5. Per ogni foto modificata con l'AI confronti **prima/dopo** e scegli **Usa questa**, **Rifai** o **Tieni l'originale**.
6. Marca, taglia e materiale vengono letti dalle etichette. Le foto vengono messe in ordine e titolo, descrizione e hashtag si scrivono da soli.
7. Nella schermata **Annuncio pronto** tocca **Copia testo**, **Salva foto in ordine** (vanno nella Galleria, in una cartella con il titolo) oppure **Condividi**.

Se chiudi l'app a metà, alla riapertura riprende da dove eri rimasto.

Servono due chiavi, da inserire in **Impostazioni**: quella di **Anthropic** (testo, etichette, controllo dell'inquadratura) e quella di **OpenAI** (copertina e pulizia dello sfondo). Senza la chiave OpenAI puoi usare «Solo sistemazione locale», che è gratuita.

## Copertina con AI: Regista + Fotografo
Nella scheda **AI** tocca **Crea copertina**.
1. 🎬 Il **regista** (Claude) studia il capo e la tua foto modello e prepara le istruzioni.
2. Ti mostra la **Sintesi del lavoro**: cosa ha visto, cosa farà il fotografo, cosa controllerà e il costo stimato.
   - **Procedi**: parte lo scatto (è l'unico pulsante che spende su OpenAI).
   - **Correggi**: scrivi cosa cambiare (es. «gruccia di legno», «più spazio sopra») e il regista aggiorna la sintesi, senza costi OpenAI.
   - **Annulla**: non succede nulla.
3. 📷 Il **fotografo** (OpenAI) fa **uno** scatto dalla foto originale.
4. 🎬 Il regista controlla il risultato voce per voce (✓/✗). Scegli **Usa questa**, **Riprova con correzione** (nuova conferma, sempre una sola foto) o **Tieni l'originale**.
5. Alla fine vedi il riepilogo con il costo reale, diviso tra Claude e OpenAI.

Se il regista risponde in modo incompleto, ListLab ripete da solo la richiesta (una volta). Se non funziona ancora, vedi «Il regista non ha risposto correttamente. Tocca Riprova»: non viene addebitato nessuno scatto OpenAI.

In **Impostazioni** trovi lo **Stile copertina** (carica una o più foto modello e scegli la predefinita), il modello del regista e «Chiedi conferma prima di ogni copertina».

Costo indicativo per copertina: circa **0,25 $** (regista circa 0,04 $ per brief e controllo, fotografo circa 0,21 $ per uno scatto in qualità Alta). Ogni «Riprova» aggiunge circa 0,23 $.

**Gratis con ChatGPT**: nel visualizzatore tocca «Modifica con l'app ChatGPT». La foto originale va a ChatGPT e il prompt preparato dal regista viene copiato: incollalo, salva il risultato e torna su ListLab con «Importa risultato».

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
