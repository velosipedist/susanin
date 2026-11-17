# Susanin

Susanin drills the facts of a fixed Hong Kong Island coach tour. This repository
currently contains the **local Telegram demo** (issue #2): a bot that onboards a
learner and the B-layout Mini App home, rendered from a fixture. There is no
database, no API, and no deployment yet.

## What the demo does

- `/start` from an unknown account asks for the invite code.
- A wrong code gets a clear rejection; the configured code proceeds.
- A–E group buttons follow the code. A group must be chosen before the single
  **Open Susanin** button appears.
- The group travels to the Mini App as `?group=A..E`, so the chosen group selects
  the five home stops.
- Home shows the Telegram first name (one line; half size above 15 characters),
  overall percentage, **Learn new**, **Repeat gaps**, the five in-scope stops
  with bars and percentages, and the pinned **All 25 sections** footer.
- Restarting the bot forgets every account and group: state is in memory only.

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
- `INVITE_CODE` — the demo's shared secret.
- `TELEGRAM_API_BASE` — leave at `http://localhost:8081` for local Bot API mode.
- `WEBAPP_URL` — the Mini App URL. The bot appends `?group=A..E`.

For a browser-only layout check, `http://localhost:5173/learn/` is fine. For a
phone inside Telegram, Telegram requires HTTPS, so expose the dev server through
a tunnel and use the tunnel URL:

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

## 3. Serve the Mini App

```sh
pnpm dev
```

Open <http://localhost:5173/learn/?group=B> in a phone-sized viewport (about
390 × 844). Add `&name=Mei-Ling` to preview a different heading in a browser; the
`name` parameter is only a fallback. Inside Telegram the first name comes from
`initData`.

The app is built with SvelteKit, `adapter-static`, and the `/learn` base path
from ADR 0001/0004. `pnpm build` and `pnpm preview` use the same base.

## 4. Start the bot

In another terminal:

```sh
pnpm bot
```

Then, in Telegram:

1. Send `/start` to the bot.
2. Send the invite code from `.env`.
3. Pick A, B, C, D, or E.
4. Tap the single **Open Susanin** button.

An account that has already completed onboarding in this process skips the code
on `/start`. It can still change group from the same message.

## Deliberately fake in this build

- Content comes from `apps/learn/src/lib/fixture.ts`, shaped like the future
  `GET /api/home` response (account plus five in-scope sections with
  learned/unlearned/untouched counts). The 25 section names are placeholders;
  the Brief/Syllabus importer replaces them in issue #8.
- **Learn new**, **Repeat gaps**, and **All 25 sections** show an inline note
  saying they arrive in the next build. Runs start in issues #4 and #5; the full
  list is issue #6.
- Invite attempts are unlimited; the 20-per-hour limit is issue #3.
- Nothing is persisted.

## Layout

```
apps/learn      SvelteKit learner Mini App (static, base /learn)
apps/bot        Telegram bot: onboarding and the Open Susanin button
packages/shared Group type shared by both
```

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Vite dev server for the learner app |
| `pnpm build` | Static build (adapter-static, set up for `/learn`) |
| `pnpm preview` | Preview the static build |
| `pnpm bot` | Run the Telegram bot (loads the root `.env`) |
| `pnpm typecheck` | Type-check every workspace package |
| `pnpm test` | Run tests; this walking-skeleton ticket adds none yet |
