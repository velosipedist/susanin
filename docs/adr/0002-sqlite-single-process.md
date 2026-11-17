# One process and a SQLite file on the existing VPS

The whole product — both SPA builds, the JSON API, the Telegram webhook, and all state — runs as a single process on the VPS that already exists (1 GB RAM, ~400 MB used by other things), with SQLite as the only datastore. Five to twenty learners and one or two admins produce a trivial write rate; Postgres, Redis, or a job queue would cost more RAM and attention than they buy.

Consequences: writes serialize behind one writer, a deploy restarts the API, and the database file must live outside the deployed checkout and be backed up by copying the file.
