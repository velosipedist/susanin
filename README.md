# Susanin

Susanin drills the facts of a fixed Hong Kong Island coach tour. The repository
now holds the **foundation** (issue #3) and the **single-section run**
(issue #4): a real API over SQLite, Telegram onboarding that remembers accounts,
a signed session cookie for the Mini App, the B-layout learner home reading from
the database, and topic cards that write a complete card atomically. Multi-section
runs, the full section list and the admin app arrive in later tickets.

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
- Content is seeded placeholder data with an A–E section mapping until the
  Brief/Syllabus importer (issue #8) and the admin app exist. Every field text is
  explicitly a placeholder; no source material is copied.

## Architecture

```
apps/learn      SvelteKit learner Mini App (static, base /learn)
apps/api        Hono API over SQLite (Drizzle migrations), session and bot routes
apps/bot        Telegram bot: onboarding and the Open Susanin button
packages/shared Domain types shared by every package
```

In production Caddy serves `/learn`, `/admin` and `/api` from one origin
(ADR 0004). In development Vite proxies `/api` to `http://localhost:3000`.

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

## 5. Start the bot

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

## Tests

```sh
pnpm test
```

The API tests boot the Hono app in-process against a fresh in-memory SQLite
database per test. They cover onboarding over HTTP, the invite-code failure
limit, persistent membership, `initData` validation, session rejection, the
group-required rule and the home payload. They assert observable behaviour, not
private helpers or SQL shapes.

## Deliberately fake in this build

- Content comes from `apps/api/src/db/seed.ts`, shaped like the future importer
  output. The 25 section names and every field text are placeholders.
- **Learn new**, **Repeat gaps** and **All 25 sections** show an inline note
  saying they arrive in the next build. Multi-section runs are issue #5; the full
  list is issue #6.
- The admin app, group assignment and the importer are later tickets. `ADMIN_IDS`
  is parsed into the account's admin flag, but no admin routes exist yet.
- There is no deployment in this build.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm api` | Run the Hono API (applies migrations and seeds content) |
| `pnpm dev` | Vite dev server for the learner app |
| `pnpm build` | Static build (adapter-static, set up for `/learn`) |
| `pnpm preview` | Preview the static build |
| `pnpm bot` | Run the Telegram bot (loads the root `.env`) |
| `pnpm typecheck` | Type-check every workspace package |
| `pnpm test` | Run the API test suite |
