# App LG webOS ("guscio") — design

Data: 2026-09-10. Stato: approvato in chat. Fase 1 del percorso TV (fase 0: "Apri dalla TV"; fase successiva: modalità autonoma senza PC, spec separata).

## Obiettivo

Chi ha una TV LG (webOS 22 o più recente) deve usare Neftlix col telecomando a frecce, senza il puntatore del browser della TV. L'app installata sulla TV è un guscio sottile: trova il Mac che esegue l'app desktop con "Apri dalla TV" attivo e carica da lì l'interfaccia Neftlix, la stessa che oggi si apre nel browser. Il Mac resta il cervello (catalogo, guida, profili, progressi) e deve restare acceso.

Destinatario: solo l'autore, installazione dal Mac via Developer Mode. Fuori scope: LG Content Store, Samsung/Tizen, Android TV/Fire TV, scoperta mDNS, interfaccia impacchettata nell'app, modalità autonoma, pulsante "Installa sulla TV" nell'app desktop.

## Perché un guscio

L'interfaccia web ha già la navigazione a fuoco (`web/src/spatial.ts`); nel browser della TV non arriva mai perché il browser consuma le frecce per muovere il puntatore. Un'app webOS riceve i tasti del telecomando direttamente. Servire l'interfaccia dal Mac invece di impacchettarla evita CORS, reinstallazioni a ogni aggiornamento e versioni fuori sincrono tra UI e server.

## Componenti

### 1. App webOS (`tv/webos/`)

- `appinfo.json`: `id` `tv.neftlix.app`, `type` `web`, `main` `index.html`, `title` Neftlix, `vendor` Neftlix, `version` copiata dal `package.json` principale durante l'impacchettamento, `icon` 80×80 e `largeIcon` 130×130 generati dal logo (`web/public/logo.svg`), `bgColor` `#0b0b0f`, `resolution` `1920x1080`.
- `index.html` + `launcher.js`: lanciatore in HTML e JavaScript puro (ES2019, nessuna build). Stile scuro coerente con il sito e l'app; testo grande, leggibile a 3 metri.
- `discovery.js`: modulo puro (senza DOM né webOS) con la logica testabile: `subnetOf(ip)` → i 254 host della /24; `probeAll(hosts, probe, { concurrency: 64, timeoutMs: 1500 })`; `pickServer(saved, found)`. Importato dal lanciatore e dai test con `node:test`.
- `webOSTV.js` (libreria LG, copiata nel pacchetto) per `luna://com.webos.service.connectionmanager/getStatus` → IP della TV e per `webOS.platformBack()`.

Flusso all'avvio:

1. Legge da `localStorage` l'ultimo indirizzo funzionante (`neftlix.server`, es. `http://192.168.1.8:6338`). Se c'è, chiama `GET <server>/api/lan/ping` con timeout 1,5 s. Risposta valida (`app === "neftlix"`) → `location.replace(server + '/')`. Fine.
2. Altrimenti mostra "Cerco Neftlix sulla rete…", chiede l'IP della TV a webOS, ricava la /24 e interroga `http://<host>:6338/api/lan/ping` per tutti i 254 host, 64 in parallelo, timeout 1,5 s ciascuno. Se webOS non fornisce l'IP, prova in ordine `192.168.1.0/24`, `192.168.0.0/24`, `10.0.0.0/24`.
3. Un solo Mac trovato → salva e carica. Più di uno → lista con nome del computer e versione, scelta col telecomando (frecce + OK). Nessuno → schermata "Non trovo il Mac": ricorda di attivare "Apri dalla TV", pulsante **Riprova** e campo per digitare l'indirizzo (`IP:porta`, tastiera a schermo di webOS), che viene verificato con lo stesso ping prima di essere salvato.
4. Il PIN non è gestito dal lanciatore: alla prima navigazione il server mostra la sua pagina PIN (già navigabile col telecomando); il cookie `neftlix_lan` resta nello storage dell'app. Cambiare PIN sul Mac fa ricomparire la pagina PIN.

Errori dopo il lancio: se il Mac diventa irraggiungibile mentre l'interfaccia è caricata, la TV mostra l'errore di pagina di webOS; alla riapertura dell'app il lanciatore riparte dal punto 1 e, fallito il ping, dal punto 2.

### 2. Interfaccia web (`web/`)

- **Indietro webOS.** `spatial.ts` e i gestori del player (`Player.tsx`, `PlayerControls.tsx`) trattano `keyCode === 461` come Backspace/Escape. Sulla home (nessuna pagina da chiudere) l'azione Indietro chiude l'app: `window.close()` se l'user agent contiene `Web0S`; negli altri browser nessun effetto, come oggi.
- **Barra di avanzamento.** In `PlayerControls.tsx` la barra gestisce solo Sinistra/Destra (±10 s); Su/Giù non vengono più fermati e la navigazione a fuoco li usa per uscire dalla barra verso gli altri controlli. Il salto di ±60 s con Su/Giù resta disponibile quando il fuoco è fuori dalla barra (comportamento già esistente in `Player.tsx`).
- **Fuoco visibile.** Verifica del contorno di fuoco su card, pulsanti del player e pagina PIN a 1080p; ritocchi in `styles.css` solo se necessario.
- **Video.** Nessuna modifica prevista: HLS via hls.js sul motore di webOS 22+. Se un flusso del provider non parte sulla TV, il primo tentativo è la riproduzione nativa (`<video src>` diretto) prima di qualunque altra soluzione; è una decisione da prendere solo con l'evidenza della prova.

### 3. Server (`server/`)

- `GET /api/lan/ping` → `{ "app": "neftlix", "name": "<hostname>", "version": "<versione>" }`. È l'unica rotta esente dal PIN (`lan.ts` la lascia passare prima del controllo cookie). Risponde anche quando la modalità LAN è spenta, ma in quel caso il server non è raggiungibile dalla rete, quindi non cambia nulla.
- Nessun'altra API cambia.

### 4. App desktop (`desktop/`)

- Con "Apri dalla TV" attivo il server ascolta su `0.0.0.0:6338` (costante `LAN_PORT`, "NEFT" sulla tastiera del telefono) invece della porta appiccicosa; l'URL della finestra Electron diventa `http://127.0.0.1:6338`. Spegnendo la modalità LAN si torna a `127.0.0.1` sulla porta appiccicosa salvata in `port.json`, come oggi.
- Se 6338 è occupata, `setLanEnabled(true)` fallisce, l'interruttore torna su Non attivo e il pannello mostra il motivo ("porta 6338 occupata da un altro programma"). Nessun ripiego su porta casuale: la scansione della TV dipende dalla porta fissa.
- Il pannello Impostazioni mostra gli indirizzi con la porta 6338 e una riga "App TV LG: si installa dal Mac, vedi tv/webos/README.md".

### 5. Strumenti (`tv/webos/`, root)

- `@webos-tools/cli` come `devDependency` del root (workspace `tv` non necessario: nessun codice da compilare).
- `npm run tv:package`: script Node (`tv/webos/scripts/package.mjs`) che copia `appinfo.json` con la versione corrente e le icone generate in una cartella di staging e chiama `ares-package` → `tv/webos/dist/tv.neftlix.app_<versione>_all.ipk`. La cartella `dist/` è in `.gitignore`.
- `npm run tv:install -- <ip-tv>`: `ares-setup-device` (nome `lg`, la passphrase della Developer Mode viene chiesta alla prima esecuzione), `ares-install`, `ares-launch`. Con `--launch-only` lancia soltanto.
- `tv/webos/README.md`: prerequisiti sulla TV (app Developer Mode dal Content Store, accesso con account LG, attivazione, rinnovo ogni 50 giorni), i due comandi, la checklist di verifica.

## Sicurezza

Il modello resta quello di "Apri dalla TV": chi è in rete deve conoscere il PIN. L'unica informazione visibile senza PIN è la risposta di `/api/lan/ping` (nome del computer e versione), necessaria alla scoperta e priva di dati del provider o dell'utente.

## Test

- `tv/webos/test/discovery.test.mjs` (`node:test`): `subnetOf` su IP validi e non validi; `probeAll` rispetta concorrenza e timeout, ignora risposte non Neftlix, restituisce i trovati in ordine di IP; `pickServer` preferisce l'indirizzo salvato se risponde.
- `server/test`: `/api/lan/ping` risponde 200 senza cookie con `app: "neftlix"`; `/api/status` senza cookie resta 401.
- `desktop/test`: `startServer` con `lanPort` usa 6338; con la porta occupata rifiuta senza ripiego casuale.
- `npm run check`, `npm test`, `npm run build` verdi; il pacchetto `.ipk` si genera.
- Sulla TV (manuale, in `tv/webos/README.md`): installazione e avvio; scoperta del Mac; pagina PIN; profilo; frecce su home, righe e card; dettaglio e Indietro; film: controlli, entrata e uscita dalla barra, Indietro chiude il player; canale live; Indietro dalla home chiude l'app; riapertura con indirizzo ricordato; Mac spento → errore, riaperto con IP diverso → nuova scoperta; "Apri dalla TV" spento → "Non trovo il Mac".

## Piano di massima

1. Server: `/api/lan/ping` + test.
2. Desktop: `LAN_PORT`, errore porta occupata, testo del pannello + test.
3. Web: Indietro 461, chiusura app sulla home, barra Su/Giù + verifica fuoco.
4. `tv/webos/`: appinfo, lanciatore, `discovery.js` + test, icone, script package/install, README.
5. Prova sulla TV con la checklist; ritocchi (video nativo solo se necessario).
6. README principale (sezione "Watch on your TV"), CHANGELOG.
