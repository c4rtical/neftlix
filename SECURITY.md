# Security

## Threat model

Neftlix is meant to run on your own machine or home network. It stores your IPTV provider's credentials in a local SQLite database and proxies streams on their behalf. Anyone who can reach the server can therefore watch through your provider account.

- By default the server listens on all interfaces without authentication. Keep it inside your home network, or set `NEFTLIX_PASSWORD` to require a password on every request.
- Do not expose the port to the internet without the password **and** HTTPS (a reverse proxy such as Caddy or nginx).
- The `data/` folder contains your credentials. Back it up as you would a password.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's private vulnerability reporting on this repository ("Security" tab → "Report a vulnerability"). You will get an acknowledgement within a few days.

Include steps to reproduce and the impact you see. Credit is given in the release notes if you want it.
