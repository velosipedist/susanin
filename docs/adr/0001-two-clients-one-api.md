# Two clients over one API: a Telegram Mini App for learners, a separate web app for admins

Learners need a touch-first, gesture-driven card UI that Telegram chat messages cannot render. Content editing needs a keyboard, a wide table, and multi-minute sessions. So one repository holds two SPAs and one API process: the learner SPA runs as a Telegram Mini App, the admin SPA runs as an ordinary HTTPS website, and both are served from the same origin under different path prefixes against the same backend and database. Telegram identity is verified server-side for both, so there are no passwords.

The alternative — a single mini app with role-gated admin screens — was rejected because admin work would be confined to a phone viewport, and a bot-only design was rejected because editing content and reading stacked charts through chat messages is impractical.

Consequences: two build artifacts, one shared API and one shared domain model, a shared package so the clients cannot drift, and an admin static shell that is publicly fetchable — so every admin capability must be enforced on the API, never by hiding screens.
