# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Profiles: "Who's watching?" screen, up to 5 profiles with separate progress, favourites and watchlist; avatar in the navigation to switch; existing data migrates to a "Principale" profile.
- Server test suite (`npm test`, `node:test`) covering migration and profile isolation.

### Fixed
- Sport fixtures: TheSportsDB requests are paced and retried on rate limit; a persistent limit is shown as an error instead of an empty calendar.

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
