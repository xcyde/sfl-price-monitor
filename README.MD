# Sunflower Land Price Monitor

Tracks in-game item prices from the Sunflower Land API, stores them as time-series data,
and exposes them over an authenticated REST API. A Telegram bot serves as the reference
client of that API.

## Architecture

### Design rationale

**The REST API is the product.** It has its own Swagger UI (`/docs`), JWT authentication,
and versioned endpoints. The bot is not a shortcut to the database — it is an authenticated
HTTP client that goes through the same public interface any future web or mobile client would.

**The bot is a separate process.** It runs its own event loop (grammy long-polling), has its
own minimal environment, and communicates with the API over HTTP. It does not import any
database or Fastify code. The boundary is enforced at the module level: `src/bot.ts` only
imports grammy and `src/modules/bot/`.

**JWT auth is designed for untrusted clients.** The full auth stack — access tokens,
rotating refresh tokens with reuse detection, per-user token revocation — is built and
covered by unit tests. Today only the bot uses it, and the bot takes a shortcut: it holds
the master `BOT_INTERNAL_SECRET`, so it re-authenticates directly via `POST /api/auth/login`
instead of rotating refresh tokens. Refresh rotation exists for the web/mobile client that
will arrive in the next iteration alongside personal price signals.

**Personal signals are the next iteration.** They are what justifies the auth model — a
signal (e.g. "notify me when Sunflower drops below X") is user-scoped data that must be
protected by a Bearer token. The cron engine already captures the time-series needed to
power signal evaluation.

### Planned delivery mechanism

Push notifications to the bot will go through an outbox table: the API writes a row, the
bot process polls or subscribes to it. This keeps the API and bot decoupled at the data
layer. Not yet implemented.

### Topology

```mermaid
graph TD
    subgraph VM["Single VM"]
        Caddy["Caddy\n(reverse proxy, TLS)"]
        subgraph api-container["Container: api"]
            API["Fastify REST API\nSwagger /docs\nCron price fetcher\nDB migrations on boot"]
        end
        subgraph bot-container["Container: bot"]
            Bot["grammy long-polling\nHTTP client → API"]
        end
        Postgres["PostgreSQL"]
    end

    User["Browser / curl"] -->|HTTPS| Caddy --> API
    Bot -->|"HTTP  http://api:3000"| API
    API --> Postgres
    Bot <-->|long-polling| TG["Telegram servers"]
    TG["Telegram servers"] <-->|messages| TGUser["Telegram user"]
```

> Both processes also run outside containers for local development (see "Running locally"
> below); the topology above is what `docker compose up` and production run.

### What is running vs what is designed

| Capability | Status |
|---|---|
| Time-series price storage (cron) | ✅ Running |
| REST API with Swagger | ✅ Running |
| JWT access tokens (bot auth flow) | ✅ Running |
| Refresh token rotation + reuse detection | ✅ Designed, unit-tested; not used by bot (by design) |
| Telegram bot via grammy long-polling | ✅ Running |
| Bot as authenticated API client | ✅ Running |
| Personal price signals | 🔲 Next iteration |
| Push delivery via outbox | 🔲 Planned |
| Docker-compose + Caddy | ✅ Running |

## Running locally

Requires Node 24 (see `.nvmrc`) and a running PostgreSQL instance.

```bash
cp .env.example .env
# fill in DATABASE_URL, JWT_SECRET, BOT_INTERNAL_SECRET, TELEGRAM_BOT_TOKEN
nvm use
```

**Terminal 1 — API** (Fastify, migrations, cron):
```bash
node src/index.ts
```

**Terminal 2 — Bot** (grammy long-polling, calls the API):
```bash
node src/bot.ts
```

The bot defaults to `API_BASE_URL=http://127.0.0.1:3000`. If the API is not running,
the bot starts normally and replies to commands with a "service unavailable" message.

Swagger UI is available at `http://localhost:3000/docs`.

## Running with Docker Compose

Runs all three services — `api`, `bot`, `caddy` — as containers, the same way
production runs.

```bash
cp .env.example .env
# for local testing without a real domain, set DOMAIN=:80 (HTTP on port 80, no TLS)
docker compose up --build
```

`DATABASE_URL` can point at a local Postgres or, as in production, at Neon —
see the comment in `.env.example` for why the direct (non-pooled) connection
string is required.

## Deployment

Production runs on an Oracle Cloud Always Free Ampere A1 VM with Neon as the
managed Postgres and Caddy handling automatic TLS via Let's Encrypt. Full
step-by-step runbook, including firewall setup and Always-Free-reclaim
recovery: [`docs/deploy-oracle.md`](docs/deploy-oracle.md).

`POST /api/auth/login` is blocked by Caddy from outside the compose network —
only the `bot` container can reach it, over `http://api:<PORT>`. `ENABLE_SWAGGER=true`
is intended for production (see "Swagger is intentionally public" above).

## Environment variables

### API process (`src/index.ts`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | — | Signing key, min 32 chars |
| `BOT_INTERNAL_SECRET` | ✅ | — | Shared secret for `POST /api/auth/login`, min 16 chars |
| `PORT` | | `3000` | HTTP port |
| `JWT_ACCESS_TTL` | | `15m` | Access token TTL |
| `REFRESH_TOKEN_TTL_DAYS` | | `30` | Refresh token TTL |
| `PRICES_API_URL` | | `https://sfl.world/api/v1/prices` | Upstream price source |

### Bot process (`src/bot.ts`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Token from @BotFather |
| `BOT_INTERNAL_SECRET` | ✅ | — | Must match the API's value |
| `API_BASE_URL` | | `http://127.0.0.1:3000` | API base URL; set to `http://api:3000` in compose |

## API

Full spec at `/docs` (Swagger UI) when the API is running.

**Swagger is intentionally public in production.** `POST /api/auth/login` is bot-only
and, behind Caddy, unreachable from outside the compose network in the first place
(see `Caddyfile`) — so there is no way to obtain a Bearer token through the public UI,
and protected routes cannot actually be invoked from it. The one field that used to leak
the bot's shared secret (`x-bot-secret` on the login route) has been removed from the
schema. Public docs with no working exploit path is a deliberate trade-off, not an
oversight.

Key endpoints:

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | `x-bot-secret` header | Register/login via Telegram identity; returns access + refresh tokens |
| `POST` | `/api/auth/refresh` | refresh token in body | Rotate refresh token; reuse detection revokes the session |
| `GET` | `/api/auth/me` | Bearer | Current user info |
| `GET` | `/api/prices/latest` | Bearer | Latest price per item |
| `GET` | `/api/prices/history` | Bearer | Price history for an item |
| `GET` | `/api/prices/aggregate` | Bearer | Min/max/avg over a period |

## Development

```bash
npm run build   # tsc
npm test        # node:test, requires Node 24
```

Tests use `node:test` + `node:assert/strict` with no external test framework.
Database-touching code is tested with real queries against a test DB (see `authService.test.ts`).
HTTP clients (API client, price fetcher) use injected fake `fetch`.
