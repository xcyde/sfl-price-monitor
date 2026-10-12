# SFL Price Monitor — project guide for AI assistants

Read this before touching the code. It is the source of truth for what the project is,
how it is built and which decisions are already made. If you change architecture or
conventions, update this file in the same task.

## What this is

A backend for monitoring in-game market prices of **Sunflower Land** (a browser P2E game).
A cron job pulls prices every 15 minutes, stores them as a time series in PostgreSQL,
and exposes them through a REST API. A second cron job snapshots market prices of boosted
NFTs every 12 hours to build history for the future signals engine. A Telegram bot is a client of that API.

It is a **resume project**: the goal is to demonstrate Mid-level Node.js/TypeScript
backend skills — external API integration, time-series data, background jobs, REST API,
authentication, containerized deployment. Coherence matters more than feature count:
every component must have a real consumer or an honest, documented reason to exist.

## Status and roadmap

Done:
- Price fetching (cron) + persistence + migrations
- REST API (Fastify) + Swagger
- JWT auth (bot-secret login, access + refresh with rotation and reuse detection)
- Unit tests (native `node:test`)
- Telegram bot as an authenticated API client, running as a separate process
- Deployment artifacts: Dockerfile, docker-compose (`api` + `bot`), `docker-compose.local.yml`,
  shared edge Caddy template in `deploy/`, Swagger gate
- Deployment hardening: bot gets only its own env, the edge Caddy blocks `/api/auth/login`
  externally, `.env.example` uses a direct (non-pooled) Neon endpoint
- Deployment runbook: `docs/deploy-hetzner.md` (Hetzner Cloud VPS + shared edge Caddy +
  Neon + Dynu, including server hardening and cloud firewall)
- NFT price history collection: boosted NFTs only, full snapshot every 12 h (00:05/12:05 UTC)
  plus catch-up on api start, idempotent writes. No consumer yet by design — history
  collection for the signals engine; API endpoint and bot command later
- Production deployed (2026-10-10) at `https://sfl-price-monitor.ddnsfree.com` by following
  the runbook: the server holds a git clone in `~/sfl-price-monitor` and builds the image
  itself (`build: .`). Temporary until CI/CD builds images into GHCR and the server only pulls.

Next:
- CI/CD (GitHub Actions: lint, build, test, deploy)
- Resume polish (README, badges)

Later (separate big iteration):
- **Signals engine**: algorithmic buy/sell recommendations based on price dynamics,
  history and game events. Design not started. It is the user-scoped feature that
  fully justifies the auth layer.

## Architecture

```
Telegram ──long-polling── bot (grammy) ──HTTP + JWT──▶ api (Fastify)
                                                        ├─ node-cron: fetch prices every 15 min
                                                        ├─ node-cron: NFT snapshot 00:05/12:05 UTC + catch-up on boot
                                                        ├─ migrations on boot
                                                        └─ PostgreSQL (Neon)
Browser ──HTTPS──▶ edge Caddy (shared, /opt/edge) ──docker network "edge"──▶ sfl-api:3000 (api)
```

- Two processes from one repo and one Docker image: `api` (`src/index.ts`) and
  `bot` (`src/bot.ts`), started with different commands.
- The bot has no database access. It logs in via `POST /api/auth/login` with the
  shared bot secret and calls protected API routes with a Bearer token.
- Hosting: paid Hetzner Cloud VPS (x86, CX line, 2 vCPU / 4 GB, Ubuntu 24.04) shared by
  several of the user's projects; docker-compose; Neon as managed PostgreSQL.
- The server runs one shared **edge Caddy** (`/opt/edge`), the only container publishing
  80/443; it imports one site file per project from `/opt/edge/sites/*.caddy`.
  This project's compose publishes no ports: `api` joins the external network `edge`
  with the alias `sfl-api`; `bot` stays in the project network only.
- Deploy artifacts (outside `src/`): `Dockerfile`, `docker-compose.yml` (prod),
  `docker-compose.local.yml` (local overlay), `deploy/edge/` (server-wide edge template),
  `deploy/caddy/sfl.caddy.example` (this project's site file), `docs/deploy-hetzner.md`.

## Repository map

```
src/
  index.ts              api entrypoint: Fastify, JWT, Swagger (gated), routes, cron, migrations
  bot.ts                bot entrypoint: grammy long-polling only, no DB/Fastify imports
  config/env.ts         zod-validated env for api (parseEnv + env)
  config/botEnv.ts      zod-validated env for bot (parseBotEnv)
  db/index.ts           postgres.js client
  db/migrate.ts         runs pending src/db/migrations/*.sql on boot
  db/migrations/        plain SQL migrations, numbered
  api/routes/auth.ts    /api/auth/login, /refresh, /me
  api/routes/prices.ts  /api/prices/latest, /history, /aggregate (all protected)
  api/schemas.ts        zod request/response schemas
  jobs/priceFetcher.ts  cron schedule + runPriceFetch
  jobs/nftFetcher.ts    NFT job (DI factory), catch-up decision, 12 h UTC cron
  modules/prices/       SFL API fetcher, prices repository
  modules/nfts/         NFT fetcher (zod parsing, boost filter), NFT snapshot repository
  modules/auth/         authService (DI factory), refresh token repositories
  modules/users/        users repository
  modules/bot/          apiClient (HTTP + token cache), handlers, formatPrices, createBot
  types/                Fastify and @fastify/jwt type augmentation
  interfaces/           SFL API response, PriceEntry and NftEntry types
deploy/
  edge/                 shared edge Caddy for the whole server (compose, Caddyfile, .env.example)
  caddy/                this project's site file for the edge (sfl.caddy.example)
docs/deploy-hetzner.md  server setup + deploy runbook
```

## Data model (actual migrations)

- `items(id serial, name unique)` and `price_records(id, item_id → items, price numeric(10,6), fetched_at)`,
  index `(item_id, fetched_at DESC)`
- `users(id serial, telegram_id bigint unique, telegram_username, created_at)`
- `refresh_tokens(id, user_id → users unique, token_hash, expires_at)` — one active session per user
- `used_refresh_tokens(id, user_id, token_hash unique, used_at)` — journal for reuse detection
- `nfts(id serial, collection, external_id, name NULL, boost_text NULL, created_at)`,
  `UNIQUE (collection, external_id)` — NFT catalog; the source key is the pair, not `name`.
  `name` and `boost_text` are overwritten on every snapshot.
- `nft_price_records(id, nft_id → nfts, floor numeric(24,8), last_sale_price numeric(24,8),
  supply integer, fetched_at)`, `UNIQUE (nft_id, fetched_at)` — also serves as the index for
  per-NFT history; separate index on `(fetched_at)` for the latest-snapshot lookup.
  `numeric(24,8)` because the source has placeholder prices up to 14 integer digits.
- `migrations` — applied migration names

Primary keys are `serial` integers, not UUIDs. There is **no** `resources`, `alerts` or
`price_signals` table; migration `002_create_auth_and_alerts.sql` is misnamed and only
creates `users` and `refresh_tokens`. Never edit an applied migration — add a new file.

## API

- `POST /api/auth/login` — header `x-bot-secret`, body `{ telegramId, username }`,
  returns access + refresh tokens. Bot-only (machine-to-machine).
- `POST /api/auth/refresh` — rotates the refresh token.
- `GET /api/auth/me` — protected.
- `GET /api/prices/latest?item=`, `/history?item=&from=&to=&limit=`,
  `/aggregate?item=&period=1h|24h|7d` — protected by one `onRequest` hook on the plugin.
- `GET /health` — liveness, hidden from Swagger.
- Swagger UI at `/docs` when `ENABLE_SWAGGER=true`.

## Auth model

- Access token: stateless JWT via `@fastify/jwt`, TTL `JWT_ACCESS_TTL` (15m).
- Refresh token: opaque random 32 bytes, stored as SHA-256 hash, TTL 30 days,
  rotated on every refresh. Reusing a rotated token revokes the user's session.
- The bot holds the master secret, so it re-logs in when the access token expires and
  does not use refresh. Refresh rotation is designed for a future untrusted client
  (web/mobile) and is covered by unit tests.

## Conventions

- Node 24, ESM (`"type": "module"`), `NodeNext`. Relative imports use the `.ts`
  extension; `tsc` rewrites them to `.js` in `dist/`.
- TypeScript runs natively on Node 24 (`node src/index.ts`). Do not add `tsx`.
- Raw SQL through `postgres.js` tagged templates. No ORM, no query builder.
  `postgres.js` parses `sslmode` from `DATABASE_URL` itself — do not add manual SSL option handling.
- zod for env and request/response schemas (`fastify-type-provider-zod`).
- Business logic in DI factories (`createAuthService`, `createApiClient`) so it is
  testable without a database or network.
- New fetchers take the URL as a parameter and keep parsing in a pure function
  (`parseNftsResponse`), so they are testable without `env` or network.
  `pricesFetcher` still reads `env` directly.
- Tests: only `node:test` + `node:assert/strict`, no third-party test libraries.
  Mock with `t.mock.method()` (auto-restored), fakes via DI. No real DB in unit tests.
- Code identifiers in English, self-documenting code, comments only for non-obvious logic.

## Commands

```bash
npm run build                 # tsc → dist/
npm test                      # node --test over src/**/*.test.ts
node src/index.ts             # api (needs DATABASE_URL etc. in .env)
node src/bot.ts               # bot (needs a running api)
docker compose -f docker-compose.yml -f docker-compose.local.yml config        # validate local variant
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build    # db + api on 127.0.0.1:3000 + bot
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d db      # only local Postgres, for `node src/index.ts`
docker compose -f docker-compose.yml -f docker-compose.local.yml exec db psql -U sfl -d sfl   # local SQL shell
docker compose -f docker-compose.yml -f docker-compose.local.yml down -v       # drop local data
docker compose config         # prod variant; fails locally without the external `edge` network — expected
docker compose up -d --build  # prod, on the server (needs `edge` network + running edge Caddy)

# on the server, in /opt/edge — apply changes in sites/*.caddy without downtime
docker compose exec -w /etc/caddy caddy caddy reload --config /etc/caddy/Caddyfile
```

## Environment

api (`src/config/env.ts`): `DATABASE_URL`, `PRICES_API_URL`, `NFTS_API_URL`, `PORT` (3000), `JWT_SECRET` (≥32),
`JWT_ACCESS_TTL` (15m), `REFRESH_TOKEN_TTL_DAYS` (30), `BOT_INTERNAL_SECRET` (≥16), `ENABLE_SWAGGER` (false).

bot (`src/config/botEnv.ts`): `TELEGRAM_BOT_TOKEN`, `BOT_INTERNAL_SECRET`, `API_BASE_URL`
(`http://127.0.0.1:3000` locally, `http://api:<PORT>` in compose).

Edge (server-wide, not this project): `ACME_EMAIL` in `/opt/edge/.env` (compose fails fast
if unset). The domain lives in the site file `/opt/edge/sites/sfl.caddy`, not in env.
`PORT` in this project's `.env` must match the port in `reverse_proxy sfl-api:3000`.
See `.env.example` and `deploy/edge/.env.example`.

## Decisions already made — do not relitigate

- **No threshold alerts** (`above`/`below` + threshold). The product vision is an
  algorithmic signals engine; threshold alerts would be throwaway schema.
- **Bot is a separate process/container and an API client**, not an in-process module
  with DB access. Otherwise auth, REST and Swagger would have no consumer.
- **Future push notifications go through an outbox table** (api writes, bot sends),
  because the bot is a separate process.
- **One VM, two containers.** Not a single process, not two servers.
- **Always-on VM + long-polling.** Serverless was rejected: it kills both the
  long-polling bot and node-cron.
- **Paid Hetzner Cloud VPS, CX line (x86, 2 vCPU / 4 GB).** Oracle Always Free was
  dropped (account could not be created). Not CPX (prices rose sharply in June 2026),
  not CAX/ARM (x86 keeps third-party images and CI builds of other projects simple).
  The VPS is shared by several of the user's projects.
- **One shared edge Caddy per server** (`/opt/edge`), the only owner of ports 80/443.
  Projects never publish ports and never ship their own Caddy. The template lives in
  `deploy/edge/` until a second project appears, then moves to a dedicated infra repo.
- **Shared external docker network `edge` with unique, project-prefixed aliases**
  (`sfl-api`). Only the service the edge proxies to joins `edge`; everything else stays
  in the project network. Docker registers plain service names (`api`, `bot`) in every
  network a container joins, so two projects with an `api` on `edge` would make the name
  ambiguous — the edge must address projects only by their unique alias.
- **Local overlay is `docker-compose.local.yml`, passed with `-f`**, never
  `docker-compose.override.yml` (compose loads that automatically, which would break prod
  on the server). Locally the `edge` network is a regular project network and `api` is
  published on `127.0.0.1:${PORT}`; no local Caddy (it would not exercise TLS or the real
  edge anyway).
- **Local development never touches production.** The local overlay runs `db`
  (`postgres:18-alpine`, same major as Neon, volume `sfl-local-pgdata` mounted at
  `/var/lib/postgresql` as Postgres 18 images require, `127.0.0.1:5432`) and forces
  `api` onto it via `environment: DATABASE_URL`, which overrides `env_file`. A Neon branch
  (instant copy of production data) is created only on demand to test risky migrations on
  real data, then deleted. Locally a separate dev bot (`@sflpm_dev_bot`) and separate
  `JWT_SECRET` / `BOT_INTERNAL_SECRET` are used — a token signed with the production
  `JWT_SECRET` would be accepted by production.
- **Hetzner Cloud Firewall, not `ufw`**: inbound only 22/tcp, 80/tcp, 443/tcp, 443/udp.
  Docker's iptables rules bypass `ufw` for published ports.
- **Server access**: non-root sudo user, SSH keys only (`PermitRootLogin no`,
  `PasswordAuthentication no`), unattended-upgrades. See `docs/deploy-hetzner.md`.
- **Neon for PostgreSQL**, not a Postgres container on the VM (survives losing the VM,
  keeps the VPS stateless). Region AWS Europe Central 1 (Frankfurt), next to the server.
- **Dynu for DNS** (free hostname `sfl-price-monitor.ddnsfree.com`), not DuckDNS. The
  server IP is static, so no update client runs.
- **Swagger is public.** The only leak (the `x-bot-secret` header field in the login
  schema) has been removed.
- **`/api/auth/login` is blocked at the edge Caddy for external traffic** (`respond ... 404`
  in the site file `deploy/caddy/sfl.caddy.example`), on top of the bot-secret check in
  the route itself. Only the `bot` container reaches it, over the project network
  (`http://api:<PORT>`).
- **Native Node 24 TypeScript**, no `tsx`, no ORM, no third-party test libraries.
- **NFT history: only boosted NFTs** (`have_boost === 1`, predicate `isBoostedNft`). The filter
  runs on every fetch, so an NFT that later gets a boost joins the collection automatically.
  Records failing zod validation are skipped and counted, not fatal; a malformed top level
  (no `updatedAt`) fails the run.
- **NFT history: every 12 hours**, cron `'5 0,12 * * *'` with explicit `timezone: 'UTC'`;
  offset to :05 so it does not coincide with the price cron.
- **NFT history: full snapshot on every run**, not only changes (~240 rows × 2 per day);
  an even series keeps queries simple.
- **NFT history: idempotent writes.** `fetched_at` = source `updatedAt` (ms),
  `UNIQUE (nft_id, fetched_at)` + `ON CONFLICT DO NOTHING`. Catch-up next to the cron, a deploy
  during the cron or a stale source never create duplicates. An in-process `isRunning` flag
  also prevents overlapping runs.
- **NFT history: catch-up on api start** when there is no snapshot or the last one is ≥12 h old.
  It does not block server start; errors are logged.
- **NFT history consumer:** history collection for the signals engine; API endpoint and bot
  command later, once data has accumulated. The source (sfl.world) only serves the current
  snapshot, so history cannot be backfilled — that is why collection starts before CI/CD.

## Known debt and gotchas

- `tsc` does not copy `.sql` files: the Dockerfile copies `src/db/migrations` into `dist/db/`.
- `used_refresh_tokens` grows forever — needs a cleanup job.
- `price_records` likely contains duplicates: the 15-minute cron runs more often than the
  source updates, `fetched_at` = source `updatedAt`, and there is no unique key. Fix: a
  migration that removes duplicates and adds `UNIQUE (item_id, fetched_at)`, plus
  `ON CONFLICT DO NOTHING` in `savePrices` (same pattern as `nft_price_records`).
- The codebase still contains Russian comments — to be cleaned up (no-comments rule).
- `bot.start()` promise is not handled: an invalid token causes an unhandled rejection.
- `api` loads the whole `.env` via `env_file`, so it also receives `TELEGRAM_BOT_TOKEN`
  and other variables it does not need. Least privilege holds only for `bot`.
- Service name `api` is also registered in the shared `edge` network. Harmless while SFL is
  the only project; consider renaming services with a project prefix before adding another.
- The local `db` container is not Neon: no TLS, no pooler, no autosuspend. Behaviour that
  depends on them is verified only on the server.
- Host port `5432` must be free for the local `db`. If another Postgres holds it, Docker
  leaves `db` running but detached from the network (`Networks: {}`), its healthcheck still
  passes, and `api` fails with `getaddrinfo EAI_AGAIN db`. Check with
  `docker ps --format '{{.Names}}\t{{.Ports}}' | grep 5432`.
- `/opt/edge` on the server holds copies of `deploy/edge/`; repo changes there must be
  copied over by hand (until the edge moves to its own infra repo).

## Working rules for AI assistants

- Work in stages. Before each stage (and each file or group of related edits) briefly
  explain what and why, then wait for approval. Report after each stage and wait again.
- Do not run git commands that change state (add, commit, push, etc.). The user commits.
- The user verifies manually: give exact commands to run instead of claiming results.
- Do not trust the original idealized schema from early notes; trust the migrations.
- Update this file when architecture, conventions or decisions change.
