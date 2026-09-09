# Neftlix

Client moderno, in stile Netflix, per i contenuti a cui hai già accesso tramite il tuo provider IPTV (protocollo Xtream Codes).

L'app non include contenuti, server, playlist o credenziali: inserisci i dati del tuo provider al primo avvio e restano solo sul tuo dispositivo.

## Requisiti

- Node.js 23.6 o superiore (usa `node:sqlite` e il supporto TypeScript nativo)
- Un browser moderno. Per i file `.mkv` serve Chrome/Chromium/Edge: Safari non li riproduce.

## Avvio

```bash
npm install
npm start
```

Poi apri http://localhost:8787 e inserisci host, username e password del provider. La prima sincronizzazione scarica tutto il catalogo (circa 45 MB) e richiede pochi secondi.

Per usarla da un altro dispositivo sulla stessa rete (TV, tablet, telefono) apri `http://<ip-del-mac>:8787` nel browser di quel dispositivo.

## Sviluppo

```bash
npm run dev          # server su :8787 con reload + Vite su :5173
npm run build        # compila il frontend in web/dist (servito dal server)
```

Variabili opzionali: `PORT` (default 8787), `NEFTLIX_DATA` (cartella dati, default `./data`), `LOG_LEVEL`.

## Struttura

- `server/` — Node + Fastify. Client Xtream, cache del catalogo in SQLite, deduplicazione dei film, proxy degli stream, stato utente (progressi, visti, preferiti).
- `web/` — React + Vite. Interfaccia navigabile con mouse, tastiera e telecomando (frecce, Invio, Esc).
- `docs/xtream-findings.md` — note sul comportamento reale delle API Xtream.
- `data/` — database locale (ignorato da git).

## Sport / TV live

La sezione **Sport** mostra i canali live del provider nelle categorie sportive (Sky Sport, DAZN, Calcio, Eurosport…). Il pulsante "Tutti i canali TV" apre l'intera lista dei canali live. Nel player: ↑/↓ cambiano canale, l'overlay mostra il programma in onda (EPG) quando il provider lo fornisce.

Ogni canale mostra il programma in onda e quello successivo (guida XMLTV del provider, aggiornata ogni 6 ore).

La tab **Partite** parte dal calendario ufficiale (data e ora di calcio d'inizio) e cerca nella guida TV dei canali sport il programma che inizia in quella finestra e nomina entrambe le squadre: così vengono linkate solo le dirette, mai le repliche. La Home mostra le partite delle prossime 48 ore. Sorgenti del calendario: senza chiave, i dati gratuiti di TheSportsDB (Serie A, Champions, Europa League, Premier, Liga, Bundesliga, Ligue 1); con una chiave gratuita di football-data.org (Impostazioni → Calendario partite) il calendario è più completo. Le partite di Serie A senza canale in guida mostrano un collegamento alla categoria DAZN, per cui il provider non fornisce EPG.

I canali vengono riprodotti in HLS tramite hls.js; il server riscrive le playlist e proxa i segmenti, così il browser non parla mai direttamente con il provider.

## Comandi da tastiera

Frecce: naviga · Invio: apri · Esc/Backspace: indietro.
Nel player: ←/→ ±10 s, ↑/↓ ±60 s (nei canali live: canale successivo/precedente), spazio play/pausa, N prossimo episodio, F schermo intero.

## Limiti attuali

- Solo protocollo Xtream Codes (niente M3U).
- Canali live: nessun catch-up/archivio, nessuna guida EPG completa (solo il programma in onda e i successivi).
- Riproduzione tramite `<video>` del browser: i file con audio AC3/DTS/E-AC3 possono risultare senza audio. Il rimedio (remux/transcodifica con ffmpeg) è previsto in una fase successiva.
- Un solo profilo e un solo provider.
