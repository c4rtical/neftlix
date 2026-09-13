# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.5.4] - 2026-09-13

### Added
- "Random" on every series page, next to Preferiti and Da guardare: plays an episode drawn at random from all its seasons. The Rick and Morty portal stays as the easter egg.

## [0.5.3] - 2026-09-13

### Added
- Preferiti and Da guardare are split into "Film" and "Serie TV", each under its own heading with a count; a kind with no titles is not shown. Click the heading to fold the group away and back; what is folded is remembered per list, so a long list of films no longer has to be scrolled past to reach the series.

## [0.5.2] - 2026-09-13

### Added
- Rows get ‹ › arrows on hover, for anyone with a mouse and no trackpad: each scrolls by one page, hides at its end of the row, and neither shows when everything fits. Mouse only: they do not exist on touch screens and never take the focus, so keyboard and remote navigation are unchanged.

## [0.5.1] - 2026-09-13

### Fixed
- Windows: the in-app update never offered the download. electron-updater found the new version, but the state it produced lacked the installer name, and the Settings panel shows "Scarica" only when it knows the file; the check button looked like it did nothing. The installer name and the release page now travel with the state, and the panel offers the download whenever electron-updater drives the update. Anyone on 0.4.0 or 0.5.0 installs this version by hand once; from here on the button works.
- Desktop: updater covered by tests (a stand-in electron-updater fires the events); sources import `.ts` files, rewritten to `.js` at build time, so tests load them directly.

## [0.5.0] - 2026-09-13

### Added
- Episodes without a title, still or plot ("Show S01 E07") are completed from TMDB when a free key is set (Settings, or `TMDB_API_KEY`). A series is touched only when its numbering provably matches TMDB's: per season when every episode number fits the TMDB season, or as one flat absolute list when the count equals TMDB's total; provider titles already present are cross-checked and the series is left alone on disagreement. Provider data is never overwritten. TMDB responses are cached in the database for a week.
- With a TMDB key set, a paced background pass fetches and completes the episodes of every series after each sync (favourites, watchlist and started series first), so a series is already whole when first opened. Progress in Settings; it resumes on restart and waits while a sync runs.
- "Random" in Film and Serie TV, at the end of the sort chips: opens the detail page of a title drawn at random from the selected category, or from the whole catalogue with "Tutti", discreet categories excluded in that case (`GET /api/random?kind=movie|series&category=`).
- "Random" in Preferiti and Da guardare: plays something from the list right away; a series goes through one of its episodes drawn at random (`GET /api/favorites/random?tab=`).
- Easter egg: on Rick and Morty a portal floats beside the episode list and drops you into a random episode.
- "Motori e tennis", a third tab in Sport next to "Partite": every Formula 1 and MotoGP session of the week (practice, qualifying, sprint, race) and the main tennis tournaments (Slams, Masters 1000 and WTA 1000, Finals, team cups), matched to the channel that broadcasts them through the TV guide (`GET /api/live/events`). Motorsport comes from ESPN (F1, with TheSportsDB as fallback) and TheSportsDB (MotoGP), tennis from ESPN, all without a key: the football-data.org key covers football only. Sessions live now or about to start join the "Sport adesso" strip on the home page. Tennis is shown per tournament, since the guide names the tournament and not the match.
- Discreet categories: a small built-in list of category names is treated as discreet. These categories are now browsable like any other in Film, Serie and Live TV (they used to be left out of every listing, and the provider rows flagged the same way were skipped at import), but their titles leave no trace: playback position is not recorded, so they never appear in "Continua a guardare" nor offer "Riprendi", and a search that only finds such titles is not kept in "Ricerche recenti". Resume points saved before this rule are removed at startup and after each sync. The explicit "Segna come visto" still works.

### Changed
- Database: `category.hidden` is renamed to `category.discreet` (automatic migration).
- Channel buttons on a match no longer repeat the same channel under provider group suffixes ("Skynet", "STAR", "locale") or country prefixes.

### Fixed
- Plots, cast and titles that the provider ships with literal unicode escapes ("laziale u00e8 in luna", with or without the backslash) are decoded at import; rows already stored are repaired at startup.
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
