# Deploying to Oracle Cloud Always Free

Target: one Oracle Cloud "Always Free" Ampere A1 VM running `api` + `bot` + `caddy`
via docker-compose, PostgreSQL managed by Neon, TLS via Caddy + Let's Encrypt,
domain via DuckDNS. See the root `CLAUDE.md` for why this topology was chosen.

## 1. Neon: create the database

1. Create a project at [neon.tech](https://neon.tech) (free tier).
2. In the project dashboard, copy the **direct** connection string — the one
   whose host does **not** contain `-pooler`. The api process is long-running
   and holds its connection open, so Neon's pgbouncer pooler is not needed;
   using the pooled string here just adds a hop for no benefit.
3. Confirm the string has `sslmode=require` (Neon includes it by default).

Keep this string — it goes into `.env` as `DATABASE_URL` in step 6.

## 2. Create the Oracle Cloud instance

1. Oracle Cloud Console → **Compute** → **Instances** → **Create instance**.
2. Image: **Ubuntu 22.04** (or 24.04), **ARM64** — this is what makes it free-tier eligible.
3. Shape: **VM.Standard.A1.Flex** — Always Free covers up to 4 OCPUs / 24 GB total
   across all A1 instances; one instance with 2–4 OCPUs / 6–12 GB is plenty here.
4. Add your SSH public key (or generate one and download the private key —
   there is no other way to reach the instance).
5. Networking: use the default VCN/subnet unless you already have one.
6. **Reserve a public IP** (Networking → IP Management → Reserved Public IPs).
   An ephemeral IP can change if the instance is stopped/restarted; a reserved
   one is still free-tier and keeps DuckDNS pointing at the right address.
7. Create the instance, note its public IP.

## 3. Open ports 80/443 — in two places

Oracle blocks inbound traffic at **two independent layers**; both must be opened
or the deploy will look "successful" while nothing outside the VM can reach it.

**a) Security List (or NSG) in the OCI console**

VCN → your subnet's Security List → **Add Ingress Rules**:
- Source `0.0.0.0/0`, TCP, destination port `80`
- Source `0.0.0.0/0`, TCP, destination port `443`
- (optional, for HTTP/3) Source `0.0.0.0/0`, UDP, destination port `443`

**b) The instance's own firewall (iptables/ufw)**

Ubuntu images on Oracle ship with `iptables` rules that also block 80/443 by
default, independently of the Security List above.

```bash
sudo apt-get update && sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

If you'd rather not run ufw on top of the default iptables rules, at minimum
insert equivalent `ACCEPT` rules for 80/tcp and 443/tcp before the default
REJECT rule in `iptables` and persist them (`iptables-persistent`).

## 4. Install Docker + the compose plugin

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker compose version   # confirms the compose plugin is present
```

## 5. Clone the repository

```bash
git clone <repo-url> sfl-price-monitor
cd sfl-price-monitor
```

## 6. Configure `.env`

```bash
cp .env.example .env
```

Edit `.env` with real production values:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the direct Neon connection string from step 1 |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `BOT_INTERNAL_SECRET` | `openssl rand -hex 16` |
| `TELEGRAM_BOT_TOKEN` | token from @BotFather |
| `ENABLE_SWAGGER` | `true` — see CLAUDE.md, "Swagger is public" is intentional here |
| `DOMAIN` | your DuckDNS hostname, e.g. `sfl-monitor.duckdns.org` |

DuckDNS setup, if not already done: create a free account and subdomain at
[duckdns.org](https://www.duckdns.org), point it at the reserved public IP from
step 2. DuckDNS domains don't expire but the IP mapping does if never refreshed —
for a static reserved IP a one-time manual update on the DuckDNS site is enough;
add their update cron job only if you plan to use a non-reserved/changing IP.

## 7. Bring the stack up

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f caddy   # watch it obtain the TLS certificate
```

## 8. Verify

```bash
curl -I https://<your-domain>/health              # expect 200
curl -I https://<your-domain>/docs                 # expect 200 (Swagger UI)
curl -i -X POST https://<your-domain>/api/auth/login   # expect 404 — blocked at Caddy
```

In Telegram, message your bot:
- `/start` — should get a reply confirming registration/login.
- `/prices` — should get a reply with current prices.

## Always Free reclamation risk

Oracle can reclaim an Always Free Ampere A1 instance that it considers idle
(low CPU/network utilization over a sustained period). This VM runs a cron job
every 15 minutes and a long-polling bot process, so idle reclamation is
unlikely but not impossible — treat it as a real risk for a project with no
paid tier backing it.

**What survives a reclaim:** Neon (managed separately), the DuckDNS hostname,
the git repository. **What's lost:** the VM itself, its reserved public IP
binding, and the Caddy TLS certificate cache (`caddy_data` volume).

**Recovery is just steps 2–7 again:**
1. Create a new instance (step 2) and re-attach or re-reserve a public IP.
2. If the IP changed, update the DuckDNS record to point at it.
3. Open ports again (step 3) — a fresh instance starts with default rules.
4. Install Docker (step 4), clone the repo (step 5).
5. Recreate `.env` (step 6) — reuse the same `DATABASE_URL`,
   `BOT_INTERNAL_SECRET` and `TELEGRAM_BOT_TOKEN` so the bot and existing
   Telegram users keep working without re-registering; `JWT_SECRET` can be
   regenerated freely since it only invalidates currently-issued tokens.
6. `docker compose up -d --build` — Caddy will request a fresh certificate
   for the domain automatically.

Total recovery time is dominated by instance provisioning and DNS propagation,
typically well under 30 minutes.
