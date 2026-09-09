<p align="center">
  <img src="web/public/logo.svg" width="96" alt="Neftlix logo" />
</p>

<h1 align="center">Neftlix</h1>

<p align="center">
  A modern, Netflix-style client for the IPTV provider you already have.<br/>
  Movies, series, live TV and sport — with a UX that doesn't feel like 2009.
</p>

<p align="center">
  <a href="https://github.com/c4rtical/neftlix/actions/workflows/ci.yml"><img src="https://github.com/c4rtical/neftlix/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D23.6-brightgreen" alt="Node 23.6+" />
  <a href="#support-the-project"><img src="https://img.shields.io/badge/support-crypto-orange.svg" alt="Support the project" /></a>
</p>

> **Neftlix does not provide any content.** It ships with no channels, playlists, servers or credentials. You connect the Xtream Codes account you already own; what you watch is your provider's responsibility. Neftlix is not affiliated with, endorsed by, or connected to Netflix, Inc.

---

<!-- screenshots -->
<p align="center">
  <img src="docs/screenshots/home.png" width="800" alt="Home: continue watching, watchlist, recently added, discovery rows" />
</p>
<p align="center">
  <img src="docs/screenshots/movies.png" width="400" alt="Movies with categories, search and sorting" />
  <img src="docs/screenshots/series.png" width="400" alt="Series" />
</p>
<p align="center">
  <img src="docs/screenshots/sport.png" width="400" alt="Sport: this week's fixtures matched to the broadcasting channel" />
  <img src="docs/screenshots/profiles.png" width="400" alt="Who's watching? profile picker" />
</p>

## Why

Classic IPTV players are channel lists with a search box. Neftlix treats your provider's catalogue like a streaming service: a personalised home, "continue watching", series with seasons and episodes, favourites, a watchlist, football fixtures mapped to the channel that actually broadcasts them.

## Features

- **Connect your provider** with the Xtream Codes credentials you already have. Nothing leaves your machine. Log out whenever you want: host and username stay pre-filled, catalogue and progress stay put.
- **Profiles** — Netflix-style "Who's watching?": up to 5 profiles per installation, each with its own resume positions, favourites and watchlist. Every device remembers its last profile.
- **Home** built around what you do: resume, new episodes of the series you follow, watchlist, favourites, what's new, discovery rows that rotate daily.
- **Movies & series** with posters, plot, cast, seasons → episodes, per-category search and sorting.
- **Player** with resume position, episodes auto-marked as watched, "next episode", keyboard/remote shortcuts.
- **Live TV** — every channel of your provider, with the programme now on air (XMLTV guide) and channel up/down in the player.
- **Sport** — sport channels in one place, plus **fixtures**: official kick-off times from a football calendar, matched to the channel carrying the game. Live matches appear on the home page. No replays.
- **Smart catalogue** — duplicates across categories are merged, dead sources are skipped automatically, TMDB ids and ratings survive flaky provider responses.
- **Works everywhere** — responsive layout from phone to TV, D-pad navigation, installable as a PWA.

## Quick start

Requirements: [Node.js](https://nodejs.org) 23.6 or newer. Chrome/Chromium/Edge recommended (Safari cannot play `.mkv`).

```bash
git clone https://github.com/c4rtical/neftlix.git
cd neftlix
npm install
npm start
```

Open <http://localhost:8787>, enter your provider's host, username and password. The first sync downloads the whole catalogue (about 45 MB for 100k titles) and takes a few seconds.

Other devices on your network (TV, tablet, phone): open `http://<ip-of-this-machine>:8787`.

### Docker

```bash
docker run -d --name neftlix -p 8787:8787 -v neftlix-data:/data ghcr.io/c4rtical/neftlix
```

Or with Compose: `docker compose up -d` (see [`docker-compose.yml`](docker-compose.yml)).

### Configuration

All optional. Set as environment variables.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address (`127.0.0.1` to keep it local) |
| `NEFTLIX_DATA` | `./data` | Where the SQLite database lives |
| `NEFTLIX_PASSWORD` | – | If set, the whole app asks for this password (HTTP basic auth). Use it when exposing Neftlix beyond your home network. |
| `FOOTBALL_DATA_KEY` | – | Free [football-data.org](https://www.football-data.org/client/register) key for a richer fixtures calendar. Can also be set from Settings. |
| `LOG_LEVEL` | `info` | Fastify log level |

## Keyboard / remote

| Key | Action |
|---|---|
| Arrows | Move focus |
| Enter | Open / play |
| Esc, Backspace | Back |
| In the player: ← → | Seek ±10 s |
| In the player: ↑ ↓ | Seek ±60 s (live: next / previous channel) |
| Space | Play / pause |
| N | Next episode |
| F | Fullscreen |

## How it works

```
browser / TV ──HTTP──▶ Neftlix server (Node + Fastify + SQLite) ──▶ your Xtream provider
                          │
                          ├─ catalogue cache, dedup, search, home rows
                          ├─ progress, watched, favourites, watchlist
                          ├─ stream proxy (correct User-Agent, redirect handling, HLS rewrite)
                          └─ XMLTV guide + fixtures ↔ channel matching
```

The browser never talks to the provider directly. Credentials stay in the local database.

- `server/` — Node 23 (native TypeScript, `node:sqlite`), Fastify.
- `web/` — React + Vite, plain CSS, spatial navigation for remotes, hls.js for live TV.
- `docs/xtream-findings.md` — notes on how real Xtream panels behave.

## Roadmap

- [ ] Audio remux for `.mkv` files with AC3/DTS tracks (browsers cannot decode them)
- [ ] Automatic catalogue refresh
- [ ] M3U playlists
- [ ] Multiple providers
- [ ] Native Android TV client on the same API

See the [issues](https://github.com/c4rtical/neftlix/issues) for what is being worked on.

## Contributing

Bug reports with a sample of your panel's JSON are the most valuable thing you can send: every Xtream panel is slightly different. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Support the project

Neftlix is free and will stay free. If it replaced a paid app for you and you feel like buying me a coffee, crypto is the easiest way:

| Network | Address |
|---|---|
| Solana (SOL, USDC) | `SOLANA_ADDRESS_COMING_SOON` |
| EVM (Ethereum, Base, Arbitrum, Polygon, BNB — ETH, USDC, USDT) | `EVM_ADDRESS_COMING_SOON` |

Stars, bug reports and panel samples help just as much.

## License

[MIT](LICENSE)
