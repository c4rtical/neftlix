# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Episodes without a title, still or plot ("Show S01 E07") are completed from TMDB when a free key is set (Settings, or `TMDB_API_KEY`). A series is touched only when its numbering provably matches TMDB's: per season when every episode number fits the TMDB season, or as one flat absolute list when the count equals TMDB's total; provider titles already present are cross-checked and the series is left alone on disagreement. Provider data is never overwritten. TMDB responses are cached in the database for a week.
- With a TMDB key set, a paced background pass fetches and completes the episodes of every series after each sync (favourites, watchlist and started series first), so a series is already whole when first opened. Progress in Settings; it resumes on restart and waits while a sync runs.
- Discreet categories: a small built-in list of category names is treated as discreet. These categories are now browsable like any other in Film, Serie and Live TV (they used to be left out of every listing, and the provider rows flagged the same way were skipped at import), but their titles leave no trace: playback position is not recorded, so they never appear in "Continua a guardare" nor offer "Riprendi", and a search that only finds such titles is not kept in "Ricerche recenti". Resume points saved before this rule are removed at startup and after each sync. The explicit "Segna come visto" still works.

### Changed
- Database: `category.hidden` is renamed to `category.discreet` (automatic migration).

### Fixed
- Episode titles like "Show S01 E7" (space between season and episode) are no longer shown verbatim; they become "Episodio 7".

## [0.4.0] - 2026-09-10

### Added
- Desktop app: "Apri dalla TV" in Settings. The bundled server listens on the LAN so a TV browser, tablet or phone on the same network can open `Neftlix`&nbsp;at the shown address; other devices enter a 6-digit PIN once (cookie), five wrong PINs lock the address for 30 s, changing the PIN signs every device out. The app window itself is never challenged. Addresses and a QR code are shown in the panel; the state survives restarts.
- Server: `createApp({ lan })` option behind the feature (PIN page, `POST /api/lan/login`), independent from `NEFTLIX_PASSWORD`.

### Fixed
- Server close now drops keep-alive connections, so re-binding never serves a request on a closed database.

## [0.3.0] - 2026-09-10

### Added
- Custom player controls replacing Chromium's native bar: progress with buffer and hover time, ±10 s, volume slider with remembered level and mute, audio/subtitle track menu when the stream exposes them, next episode, channel up/down on live TV, fullscreen; all reachable by keyboard and remote (`data-focus`). Seek and play/pause show a short on-screen feedback.
- Global player shortcuts: `M` mute, `N` next episode, `F` fullscreen, alongside the existing Space/Enter and arrows.

### Fixed
- Space/Enter toggled play twice after clicking a native control; the keys are now intercepted before the video element.
- Volume slider unreachable with the remote; touch tap on the video shows/hides the controls instead of toggling playback.

## [0.2.0] - 2026-09-09

### Added
- Desktop app (Electron) for Windows and macOS: runs the bundled server on 127.0.0.1 and opens it in a window; builds published on GitHub Releases from `v*` tags.
- Profiles: "Who's watching?" screen, up to 5 profiles with separate progress, favourites and watchlist; avatar in the navigation to switch; existing data migrates to a "Principale" profile.
- Server test suite (`npm test`, `node:test`) covering migration and profile isolation.
- "Esci dal profilo" (sign out of the profile on this device) in Settings and on the profile picker.
- Sport fixtures: ESPN's public scoreboard as a keyless fallback when TheSportsDB is rate-limited or empty (Serie A, Coppa Italia, Champions, Europa League, Premier, Liga, Bundesliga, Ligue 1).
- "Log out" from the provider account (Settings and profile picker): the password is removed from the server, the login page comes back with host and username pre-filled, and catalogue, profiles and progress stay.
- In-app updates for the desktop app (Windows one-click, macOS guided download).

### Changed
- README: real screenshots (home, movies, series, sport, profiles), "Support the project" section with crypto addresses and a GitHub Sponsor button; the Italian README was dropped in favour of a single English one.

### Fixed
- Sport fixtures: TheSportsDB requests are paced and retried on rate limit; a persistent limit is shown as an error instead of an empty calendar.
- Bodiless POST/DELETE calls (remove favourite, remove from watchlist, clear progress, sync now, disconnect provider) failed with HTTP 400 because the client always sent a JSON content-type; the header is now sent only with a body.

## [0.1.0] - 2026-09-09

First usable version.

### Added
- Xtream Codes login, full catalogue sync into a local SQLite cache, movie deduplication across categories, automatic fallback over dead sources.
- Home with resume, new episodes of followed series, watchlist, favourites, recent additions, top rated, rotating genre rows.
- Movies and series browsing with per-category search and sorting; series → seasons → episodes with plot and thumbnails.
- Player with resume, progress saving, auto "watched", next episode, keyboard and remote shortcuts.
- Favourites and watchlist; search with history.
- Live TV with every provider channel, XMLTV guide (now / next), channel up/down; HLS playback through a signed proxy.
- Sport section with sport channels and official football fixtures (football-data.org or TheSportsDB) matched to the broadcasting channel; live matches strip on the home page.
- Responsive layout (phone → TV), D-pad spatial navigation, PWA manifest, optional password, Docker image.
