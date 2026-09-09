# Contributing to Neftlix

Thanks for helping. A few ground rules keep the project useful and safe.

## What we accept

- Bug fixes, UX improvements, support for Xtream panel variants, performance work, docs, translations.
- Features from the roadmap in the README, or discussed first in an issue.

## What we don't accept

- Anything that adds content: provider URLs, playlists, M3U files, channel lists, credentials, "test accounts". Pull requests containing them are closed without review.
- Scrapers for third-party sites that forbid it in their terms of service.

## Reporting a bug

Every Xtream panel behaves slightly differently, so the most useful bug report includes:

1. What you expected and what happened.
2. Your browser and OS (and whether it's a TV, phone or desktop).
3. A **redacted** sample of the panel's JSON if the problem is about catalogue data: replace host, username and password with `X`. For example the output of `player_api.php?...&action=get_series_info&series_id=123` trimmed to one season.
4. Server log lines around the error (`LOG_LEVEL=debug npm start`).

Never paste real credentials, even in private.

## Development

```bash
npm install
npm run dev          # server on :8787 with reload, Vite on :5173
npm run check        # type-check server and web
npm run build        # production build of the web app
```

- Server: Node 23, TypeScript executed natively (erasable syntax only: no enums, no parameter properties).
- Web: React + Vite, plain CSS. Every interactive element must be reachable with the arrow keys (`data-focus`).
- Keep pull requests focused. One change, one PR.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`…).

## Code of conduct

Be kind, be specific, assume good faith. Harassment of any kind is not tolerated.

## Releasing

1. Move the `Unreleased` notes in `CHANGELOG.md` under a new version heading.
2. `npm version X.Y.Z --workspaces --include-workspace-root --no-git-tag-version` keeps every package in sync (the desktop build refuses to package on a mismatch).

   Bump `electronVersion` in `desktop/electron-builder.yml` whenever `electron` in `desktop/package.json` changes (the pin exists because electron-builder cannot resolve the hoisted range under npm workspaces).
3. Commit and `git push origin main`. No manual tag: the *Release* workflow sees the new version, creates `vX.Y.Z` itself, builds the macOS dmg and Windows installer and attaches them to a **draft** release. Pushes that don't change the version build nothing.
4. Review the draft on GitHub, paste the changelog, publish.

   Publishing the draft is what makes installed apps see the update.
