# Susanin

Susanin drills the facts of a fixed Hong Kong Island coach tour. The repository
now holds the **foundation** (issue #3), the **single-section run** (issue #4), the
**multi-section runs** (issue #5), the **full section list** (issue #6) and the
**admin app** (issue #7): a real API over SQLite, Telegram onboarding that
remembers accounts, a signed session cookie for the Mini App, the B-layout learner
home reading from the database, topic cards that write a complete card atomically,
and a no-pagination admin dashboard behind Telegram OIDC sign-in. Content editing,
group assignment and the people list arrive in later tickets.

## What works

- `/start` from an unknown account asks for the invite code; a wrong code is
  rejected; 20 failures per account per hour are refused.
- The configured code creates the account; an account that has onboarded skips
  the code on `/start`, even after a restart.
- A–E group buttons follow the code. A group must be chosen before the single
  **Open Susanin** button appears.
- The Mini App exchanges Telegram `initData` for a signed session cookie and
  reads the account, its group and the group's five sections from `GET /api/home`.
- The home layout is the B layout from the prototype: the Telegram first name
  (one line; half size above 15 characters), overall percentage, **Learn new**,
  **Repeat gaps**, the five in-scope stops with bars and percentages, and the
  pinned **All 25 sections** footer.
- Tapping a home stop opens a single-section run: one card per authored topic,
  the direction-aware side label, six facts with Remember, Forgot and a separate
  reveal control, Next and Back. A complete card is written atomically; a partial
  card asks before it is discarded.
- **Learn new** walks every topic of every group section in number order and
  continues into the next section without stopping. **Repeat gaps** walks the same
  cards but only the sections where an Unlearned field remains. Both keep one
  **Card N of N** header and one continuous run bar; Back crosses section
  boundaries, and exhausting a run returns home to a green, dismissible
  run-finished note under the overall progress bar. Repeat with no gaps stays home
  with a nothing-to-repeat message.
- **All 25 sections** opens the full list without pagination or a "My five" tab.
  Every row shows its number, name, progress bar and counts, marks whether it is
  in the learner's group, and starts the same single-section run when tapped. A
  section with no authored content says so and cannot be trained.
- Content is seeded placeholder data with an A–E section mapping until the
  Brief/Syllabus importer (issue #8) and content editing exist. Every field text
  is explicitly a placeholder; no source material is copied.
- The admin shell at `/admin/` is public and exposes no data until sign-in. A
  Telegram OIDC login with PKCE verifies the `id_token` against Telegram's JWKS
  and sets the same signed session cookie as the Mini App.
- Every `/api/admin/*` data route checks `ADMIN_IDS` (or the stored admin flag)
  on the request itself, so a signed-in non-admin gets 403 even on a direct call.
- The dashboard lists all 25 sections in one table with topic count, authored /
  not-applicable / empty field counts, and a status that marks a section with no
  authored content.

## Architecture

```
apps/learn      SvelteKit learner Mini App (static, base /learn)
apps/admin      SvelteKit desktop admin app (static, base /admin)
apps/api        Hono API over SQLite (Drizzle migrations), session and bot routes
apps/bot        Telegram bot: onboarding and the Open Susanin button
packages/shared Domain types shared by every package
```

In production Caddy serves `/learn`, `/admin` and `/api` from one origin
(ADR 0004). In development the learn dev server (port 5173) and the admin dev
server (port 5174) each proxy `/api` to `http://localhost:3000`.

## Prerequisites

- Node.js 22.17 or newer and pnpm 11.
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- Telegram `api_id` and `api_hash` from [my.telegram.org](https://my.telegram.org)
  for the local Bot API server.
- The [`telegram-bot-api`](https://github.com/tdlib/telegram-bot-api) binary.
- Optional for a phone: an HTTPS tunnel (for example
  [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)).

## 1. Configure

```sh
pnpm install
cp .env.example .env
```

Fill in `.env`:

- `TELEGRAM_BOT_TOKEN` — the BotFather token.
- `INVITE_CODE` — the shared secret.
- `SESSION_SECRET` — a long random string that signs the session cookie.
- `BOT_API_SECRET` — a shared secret between the bot and the API.
- `TELEGRAM_API_BASE` — leave at `http://localhost:8081` for local Bot API mode.
- `WEBAPP_URL` — the Mini App URL.
- `ADMIN_IDS` — comma-separated Telegram ids that may open the admin dashboard.
- `TELEGRAM_OIDC_CLIENT_ID` / `TELEGRAM_OIDC_CLIENT_SECRET` — from
  BotFather → your bot → **Login Widget**; leave both blank to disable admin
  login.
- `ADMIN_OIDC_REDIRECT_URI` — must exactly match one of the Allowed URLs
  registered in BotFather.
- `ADMIN_APP_URL` — where the API sends the browser after login.

For a phone inside Telegram, Telegram requires HTTPS, so expose the dev server
through a tunnel and use the tunnel URL:

```sh
cloudflared tunnel --url http://localhost:5173
# then, for example:
# WEBAPP_URL=https://random-words.trycloudflare.com/learn/
```

## 2. Start the local Bot API server

In a separate terminal:

```sh
telegram-bot-api \
  --api-id="$TELEGRAM_API_ID" \
  --api-hash="$TELEGRAM_API_HASH" \
  --local \
  --http-port=8081
```

The bot only needs `TELEGRAM_API_BASE`; the token path is added automatically.
Stop any other process that polls the same bot token, because Telegram allows one
`getUpdates` consumer at a time.

## 3. Start the API

```sh
pnpm api
```

This applies the committed Drizzle migrations to `DATABASE_FILE` (by default
`apps/api/data/susanin.db`), seeds the 25 placeholder sections and the A–E
mapping, and listens on `API_PORT`.

## 4. Serve the Mini App

```sh
pnpm dev
```

Open the app from Telegram using the bot's **Open Susanin** button. The Mini App
must be opened inside Telegram because the home requires a signed-in account.

For a plain-browser layout check, set `DEV_AUTH=true` in `.env` and restart the
API. The API then seeds a demo account (Telegram id `DEV_TELEGRAM_ID`, group B)
and <http://localhost:5173/learn/> signs in as that account through
`POST /api/dev/session`. **Leave `DEV_AUTH=false` anywhere real**; it exists only
for local design checks.

## 5. Serve the admin app

```sh
pnpm admin
```

Open <http://localhost:5174/admin/>. The shell loads for anyone but shows no data
until **Sign in with Telegram** completes the OIDC flow and the callback sets the
session cookie. A signed-in account without admin rights sees a refusal; the
data routes return 403 to it directly as well.

The login uses PKCE. The API builds the authorization URL, stores the verifier
in a short-lived signed cookie, exchanges the code server-side, verifies the
`id_token` against Telegram's JWKS (issuer, audience, expiry) and only then sets
the shared session cookie. Register the redirect URI in BotFather before trying
it against Telegram.

## 6. Start the bot

In another terminal:

```sh
pnpm bot
```

Then, in Telegram:

1. Send `/start` to the bot.
2. Send the invite code from `.env`.
3. Pick A, B, C, D, or E.
4. Tap the single **Open Susanin** button.

An account that has already onboarded skips the code on `/start`. It can still
change group from the same message. Account membership and group survive bot
restarts because they live in SQLite.

## Data model

The schema is created once for the whole domain (`apps/api/src/db/schema.ts`),
with committed migrations in `apps/api/drizzle/`:

- accounts (Telegram id, display name, group, admin flag)
- groups A–E and group→section assignment with a unique section constraint
- sections, topics, and exactly six fields per topic (database triggers keep the
  six-field invariant)
- field states keyed by account/topic/field with `graded_at`; absence means
  Untouched, and a whole topic's verdicts are written in one transaction

Progress counts only authored fields that are not marked not applicable.
Learned, Unlearned and Untouched are counted; percentages are derived.

## Importing the Brief and Syllabus

The one-time importer turns extracted text into sections, topics and sides. The
copyrighted PDFs stay out of the repository: extract them locally to
`_local/brief.txt` and `_local/syllabus.txt`, then run:

```sh
pnpm --filter @susanin/api import:content
# or with explicit paths and database:
pnpm --filter @susanin/api import:content \
  --brief _local/brief.txt --syllabus _local/syllabus.txt --db ./data/susanin.db
```

The extracted text must keep one heading per line:

- A Brief section starts with `Section NN – Title`. Every isolated heading line
  below it is a topic in document order; prose lines stay ignored.
- `Introduction`, `Background`, `Appendix` and the other back-matter headings
  end the content, so nothing after them becomes a topic.
- A Syllabus section uses the same heading. Each following row keeps the three
  columns, separated by tabs or pipes, in left / supplementary / right order.
  An `item | side` row is also accepted.
- Names are compared after case, punctuation, diacritics and simple plural forms
  are normalised. Only an exact-after-normalisation match receives a side; near
  matches are reported as ambiguous and never applied.
- Syllabus-only items are appended to the end of their section with all six
  fields marked not applicable. Brief topics start with six empty fields.
- The importer refuses to run when any field state exists. `--reset` deletes the
  content and every learner verdict first; group assignments survive.

The printed review report lists matched, unmatched, appended and ambiguous
items, so every gap can be fixed by hand in the admin editor.

## Tests

```sh
pnpm test
```

The API tests boot the Hono app in-process against a fresh in-memory SQLite
database per test. They cover onboarding over HTTP, the invite-code failure
limit, persistent membership, `initData` validation, session rejection, the
group-required rule, the home payload, the full 25-section list, single-section
cards, atomic whole-topic writes, multi-section run construction for Learn new and
Repeat gaps, the admin OIDC round trip, dashboard counts and non-admin rejection,
and the importer against short committed text fixtures (section and topic order,
side matching, appended Syllabus-only topics, and the refusal to overwrite
existing progress).
The OIDC unit tests verify a signed `id_token` against a local test JWKS and
reject a wrong issuer, wrong audience, expiry and a bad signature. They assert
observable behaviour, not private helpers or SQL shapes.

## Deliberately fake in this build

- Content comes from `apps/api/src/db/seed.ts`, shaped like the future importer
  output. The 25 section names and every field text are placeholders.
- The dashboard is read-only. Group assignment, the people list and the content
  editor are later tickets.
- The Brief/Syllabus importer is a CLI; it has not been run against the real
  documents in this build.
- There is no deployment in this build.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm api` | Run the Hono API (applies migrations and seeds content) |
| `pnpm dev` | Vite dev server for the learner app |
| `pnpm admin` | Vite dev server for the admin app |
| `pnpm build` | Static build of both apps (bases `/learn` and `/admin`) |
| `pnpm build:learn` | Build only the learner app |
| `pnpm build:admin` | Build only the admin app |
| `pnpm preview` | Preview the static build |
| `pnpm bot` | Run the Telegram bot (loads the root `.env`) |
| `pnpm --filter @susanin/api import:content` | Build content from extracted Brief/Syllabus text |
| `pnpm typecheck` | Type-check every workspace package |
| `pnpm test` | Run the API test suite |
