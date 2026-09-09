<p align="center">
  <img src="web/public/logo.svg" width="96" alt="Logo Neftlix" />
</p>

<h1 align="center">Neftlix</h1>

<p align="center">
  Un client moderno, in stile Netflix, per il provider IPTV che hai già.<br/>
  Film, serie, TV live e sport, con un'interfaccia degna del 2026.
</p>

<p align="center"><a href="README.md">🇬🇧 English</a></p>

> **Neftlix non fornisce alcun contenuto.** Non include canali, playlist, server o credenziali. Colleghi l'account Xtream Codes che già possiedi; ciò che guardi è responsabilità del tuo provider. Neftlix non è affiliato, sponsorizzato o collegato a Netflix, Inc.

## Perché

I player IPTV classici sono liste di canali con un campo di ricerca. Neftlix tratta il catalogo del tuo provider come un servizio di streaming: home personalizzata, "continua a guardare", serie con stagioni ed episodi, preferiti, lista "da guardare", partite di calcio abbinate al canale che le trasmette davvero.

## Funzionalità

- **Collega il tuo provider** con le credenziali Xtream Codes. Nulla esce dal tuo computer.
- **Home** costruita su ciò che fai: riprendi, nuovi episodi delle serie che segui, da guardare, preferiti, novità, righe di scoperta che cambiano ogni giorno.
- **Film e serie** con locandine, trama, cast, stagioni → episodi, ricerca e ordinamento per categoria.
- **Player** con ripresa della posizione, episodi segnati come visti in automatico, "prossimo episodio", scorciatoie da tastiera e telecomando.
- **TV live**: tutti i canali del provider, con il programma in onda (guida XMLTV) e cambio canale dal player.
- **Sport**: canali sportivi in un posto solo, più le **partite**: orari ufficiali dal calendario calcistico, abbinati al canale che trasmette la partita. Le dirette compaiono in Home. Niente repliche.
- **Catalogo intelligente**: duplicati tra categorie uniti, sorgenti morte saltate in automatico, codici TMDB e voti conservati anche quando il provider risponde male.
- **Ovunque**: layout responsive da telefono a TV, navigazione con le frecce, installabile come PWA.

## Avvio rapido

Serve [Node.js](https://nodejs.org) 23.6 o superiore. Consigliato Chrome/Chromium/Edge (Safari non riproduce i file `.mkv`).

```bash
git clone https://github.com/c4rtical/neftlix.git
cd neftlix
npm install
npm start
```

Apri <http://localhost:8787> e inserisci host, username e password del provider. La prima sincronizzazione scarica tutto il catalogo (circa 45 MB per 100 000 titoli) in pochi secondi.

Da altri dispositivi in rete (TV, tablet, telefono): `http://<ip-di-questo-computer>:8787`.

### Docker

```bash
docker run -d --name neftlix -p 8787:8787 -v neftlix-data:/data ghcr.io/c4rtical/neftlix
```

Oppure `docker compose up -d` con il [`docker-compose.yml`](docker-compose.yml) incluso.

### Configurazione

Tutte le variabili sono opzionali.

| Variabile | Default | Scopo |
|---|---|---|
| `PORT` | `8787` | Porta HTTP |
| `HOST` | `0.0.0.0` | Indirizzo di ascolto (`127.0.0.1` per solo locale) |
| `NEFTLIX_DATA` | `./data` | Cartella del database SQLite |
| `NEFTLIX_PASSWORD` | – | Se impostata, l'app chiede questa password (HTTP basic auth). Usala se esponi Neftlix fuori dalla rete di casa. |
| `FOOTBALL_DATA_KEY` | – | Chiave gratuita di [football-data.org](https://www.football-data.org/client/register) per un calendario partite più completo. Impostabile anche dalle Impostazioni. |
| `LOG_LEVEL` | `info` | Livello di log |

## Tastiera / telecomando

Frecce: naviga · Invio: apri · Esc/Backspace: indietro.
Nel player: ←/→ ±10 s, ↑/↓ ±60 s (nei canali live: canale successivo/precedente), spazio play/pausa, N prossimo episodio, F schermo intero.

## Come funziona

Il browser non parla mai con il provider: tutto passa dal server locale (Node + Fastify + SQLite), che tiene la cache del catalogo, lo stato utente e fa da proxy agli stream con lo User-Agent corretto. Le credenziali restano nel database locale.

- `server/` — Node 23 (TypeScript nativo, `node:sqlite`), Fastify.
- `web/` — React + Vite, CSS puro, navigazione spaziale per telecomandi, hls.js per la TV live.
- `docs/xtream-findings.md` — note sul comportamento reale dei pannelli Xtream.

## Roadmap

- [ ] Remux audio per i `.mkv` con tracce AC3/DTS (i browser non le decodificano)
- [ ] Aggiornamento automatico del catalogo
- [ ] Playlist M3U
- [ ] Profili / provider multipli
- [ ] Client Android TV nativo sulla stessa API

## Contribuire

Le segnalazioni con un esempio del JSON del tuo pannello sono la cosa più utile che puoi mandare: ogni pannello Xtream è un po' diverso. Vedi [CONTRIBUTING.md](CONTRIBUTING.md).

## Licenza

[MIT](LICENSE)
