# Caddy 2 + systemd, built off the VPS, served from one origin under path prefixes

One Caddy process terminates TLS for `susanin.konev.hk` and serves three trees from that single origin: `/learn/*` for the learner SPA, `/admin/*` for the admin SPA, `/api/*` reverse-proxied to one Node process under systemd, which also receives the Telegram webhook. Both SPAs are built as static artifacts on the developer's machine and rsynced, so nothing compiles on the VPS; SQLite lives at `/var/lib/susanin/…`, outside the deploy directory, and a deploy never touches it.

Chosen over Piku, which is already installed, because Piku keys static roots by URL prefix only and never by host (two SPAs at different roots would have to be proxied through Node), because its deploy model installs and builds on the server (two Vite builds on ~600 MB of free RAM is where the OOM killer lands, and Piku imposes no per-process memory cap), and because its acme.sh path silently writes a self-signed certificate and then marks issuance done, leaving a production-only instance serving a broken certificate. Given up: `git push` as the whole deploy, and Piku's `$DATA_ROOT`.

Consequences: no CORS and no cross-site cookies; both SPAs must be built with a non-root base path (`/learn`, `/admin`); the `/admin` shell is public, so admin authorization is enforced on every `/api/admin/*` route.
