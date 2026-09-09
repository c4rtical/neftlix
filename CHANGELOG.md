# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [SemVer](https://semver.org/).

## [Unreleased]

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
