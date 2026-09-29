# Deploying to a Hetzner Cloud VPS

Target: one paid Hetzner Cloud VPS that hosts **several projects**. A single shared
Caddy ("edge") owns ports 80/443 and routes each domain to its project. SFL runs as
two containers (`api` + `bot`) from one image, PostgreSQL is managed by Neon, the
domain comes from DuckDNS. See the root `CLAUDE.md` for why this topology was chosen.

```
Internet
   │
Hetzner Cloud Firewall        allows only 22/tcp, 80/tcp, 443/tcp, 443/udp
   │
VPS ── edge Caddy (/opt/edge)   the only container publishing ports; TLS
          │  docker network "edge"
          ▼
       sfl-api:3000 ── api ── Neon (PostgreSQL)
                         ▲
                         │  project network "sfl-price-monitor_default"
                        bot ── Telegram (long-polling, outbound only)
```

Nothing but Caddy is reachable from the internet. `api` has no published port, and the
bot only makes outbound connections.

Placeholders used below — replace them with your values:

| Placeholder | Example |
|---|---|
| `<SERVER_IP>` | `203.0.113.10` — the server's public IPv4 |
| `<your-domain>` | `sfl-monitor.duckdns.org` |
| `<repo-url>` | `https://github.com/<you>/sfl-price-monitor.git` |

Commands are marked with where they run: **[local]** is your own computer,
**[server]** is an SSH session on the VPS.

## 0. What you need before starting

- A Hetzner Cloud account ([console.hetzner.cloud](https://console.hetzner.cloud)).
- A Neon account ([neon.tech](https://neon.tech)), free tier.
- A DuckDNS account ([duckdns.org](https://www.duckdns.org)), free.
- A Telegram bot token from @BotFather.
- The repository pushed to GitHub (or any git host the server can clone from).

## 1. SSH key on your computer

SSH keys come in pairs. The **private** key (`id_ed25519`) stays on your computer and
is never copied anywhere. The **public** key (`id_ed25519.pub`) is put on servers;
anyone holding the matching private key can log in.

**[local]** check whether you already have a key:

```bash
ls ~/.ssh/id_ed25519.pub
```

If the file does not exist, create one (press Enter to accept the default path; a
passphrase is recommended — it protects the key if your laptop is stolen):

```bash
ssh-keygen -t ed25519 -C "your-laptop"
```

Print the public key — you will paste it into Hetzner in step 3:

```bash
cat ~/.ssh/id_ed25519.pub
```

## 2. Neon: create the database

1. Create a project at [neon.tech](https://neon.tech).
2. In the project dashboard, copy the **direct** connection string — the one whose
   host does **not** contain `-pooler`. The api process is long-running and holds its
   connection open, so Neon's pgbouncer pooler only adds a hop.
3. Confirm the string ends with `sslmode=require` (Neon includes it by default).

Keep this string — it becomes `DATABASE_URL` in step 9.

## 3. Create the server

Hetzner Cloud Console → your project → **Add Server**:

1. **Location**: Germany (Falkenstein / Nuremberg) or Finland (Helsinki).
2. **Image**: Ubuntu 24.04.
3. **Type**: *Shared vCPU* → **x86** → the smallest **CX** plan with **2 vCPU / 4 GB**.
   - Do **not** pick **CPX**: its prices went up sharply in June 2026 and it gives
     nothing this workload needs.
   - Do not pick **CAX** (ARM) either: x86 keeps third-party images of future
     projects and CI builds simple.
4. **Networking**: keep **Public IPv4** enabled (it costs a little extra). An IPv6-only
   server cannot reach some services, for example GitHub.
5. **SSH keys**: **Add SSH key** → paste the output of `cat ~/.ssh/id_ed25519.pub`.
   With a key added, Hetzner does not set a root password, so the only way in is your key.
6. **Firewalls**: you can create and attach one right here — see step 4 for the rules.
7. Give the server a name and create it. Copy its **public IPv4** — that is `<SERVER_IP>`.

The IPv4 stays the same for the lifetime of the server (until you delete it).

## 4. Hetzner Cloud Firewall

Hetzner Cloud Console → **Firewalls** → **Create Firewall**.

Inbound rules (delete everything else, except ICMP if you want `ping` to work):

| Protocol | Port | Source | Why |
|---|---|---|---|
| TCP | 22 | Any IPv4, Any IPv6 | SSH |
| TCP | 80 | Any IPv4, Any IPv6 | HTTP — Let's Encrypt challenge and redirect to HTTPS |
| TCP | 443 | Any IPv4, Any IPv6 | HTTPS |
| UDP | 443 | Any IPv4, Any IPv6 | HTTP/3 |

Leave outbound rules empty (empty = everything allowed). The server must reach
Telegram, Neon, the SFL prices API, Docker Hub and Let's Encrypt.

**Apply to** → select your server → **Create Firewall**.

**Why a cloud firewall and not `ufw`:** Docker writes its own `iptables` rules for
published ports, and those rules are evaluated **before** `ufw`'s. A container
published on a port is reachable from the internet even if `ufw` says the port is
denied — `ufw` gives a false sense of safety on a Docker host. The Hetzner Cloud
Firewall filters traffic *before* it reaches the server, so Docker cannot bypass it.

## 5. First login and basic hardening

### 5.1 Log in as root

**[local]**

```bash
ssh root@<SERVER_IP>
```

The first time, SSH asks `Are you sure you want to continue connecting (yes/no)?` —
type `yes`. This remembers the server's identity in `~/.ssh/known_hosts`.

Update the system:

**[server]**

```bash
apt update && apt upgrade -y
```

If the upgrade asks about a modified config file, keep the currently installed
version (the default answer). If it says a reboot is required, run `reboot`, wait a
minute and log in again.

### 5.2 Create your own user

Working as `root` all the time is risky: one typo has no safety net. Create a regular
user named `deploy` that can use `sudo`:

**[server]** (as root)

```bash
adduser deploy
```

It asks for a password — **set a strong one and save it in your password manager**.
You will need it for `sudo` and for the emergency web console (section 5.5). The name,
room number and other questions can be skipped with Enter.

```bash
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

The second command copies root's `authorized_keys` (your public key) to the new user
with the correct owner, so the same key works for `deploy`.

### 5.3 Check the new user — in a SECOND terminal

> ⚠️ **Do not close the root session from 5.1.** Keep it open until the end of 5.4.
> If something is wrong, that open session is how you fix it.

Open a **second terminal window** on your computer:

**[local]**

```bash
ssh deploy@<SERVER_IP>
```

Then, in that second session:

**[server]** (as deploy)

```bash
sudo whoami
```

It asks for the `deploy` password and must print `root`. **Only continue if both the
login and `sudo whoami` worked.**

### 5.4 Disable root login and password login

From now on, only key-based login as `deploy` is allowed. Settings go into a separate
file so that package upgrades never overwrite them. On Ubuntu the **first** value
found for an option wins, and files in `sshd_config.d/` are read in name order, so the
`00-` prefix guarantees this file takes priority over the cloud image's defaults.

**[server]** (as deploy, in the second session)

```bash
sudo tee /etc/ssh/sshd_config.d/00-hardening.conf > /dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
```

Check the configuration for errors **before** applying it — a broken config can stop
sshd from accepting new connections:

```bash
sudo sshd -t
```

No output means OK. Confirm the effective values:

```bash
sudo sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) '
```

Expected:

```
permitrootlogin no
passwordauthentication no
kbdinteractiveauthentication no
```

Apply:

```bash
sudo systemctl restart ssh
```

Restarting sshd does **not** drop sessions that are already open — both of your
terminals stay connected.

> ⚠️ Now open a **third** terminal and check `ssh deploy@<SERVER_IP>` once more.
> Only when that works, close the root session from 5.1.

Optional check that root is really locked out — **[local]**:

```bash
ssh root@<SERVER_IP>        # expected: Permission denied (publickey)
```

### 5.5 If you ever lock yourself out

- Hetzner Cloud Console → your server → **Console** (the `>_` icon) opens a browser
  terminal. It is a physical-console login, not SSH, so the SSH restrictions above do
  not apply: log in as `deploy` with its password and fix `/etc/ssh/sshd_config.d/`.
- Last resort: server → **Rescue** → **Reset root password**, then log in via the same
  browser console.

### 5.6 Automatic security updates

Ubuntu 24.04 usually has `unattended-upgrades` installed and enabled already. Make sure:

**[server]**

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades    # answer "Yes"
cat /etc/apt/apt.conf.d/20auto-upgrades
```

Expected — both values are `"1"`:

```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

Security updates now install daily. The server does **not** reboot on its own; kernel
updates wait for a reboot. Check from time to time:

```bash
ls /var/run/reboot-required 2>/dev/null && echo "reboot needed"
```

If a reboot is needed, run `sudo reboot`. All containers come back automatically
(`restart: unless-stopped`).

## 6. Install Docker and the compose plugin

Uses Docker's official apt repository, so Docker updates together with the rest of
the system.

**[server]**

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Limit container log size. By default Docker keeps container logs forever and they
slowly fill the disk:

```bash
sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
sudo systemctl restart docker
```

Let `deploy` run docker without `sudo`:

```bash
sudo usermod -aG docker deploy
```

Group membership applies to **new** logins: type `exit`, then `ssh deploy@<SERVER_IP>`
again. Check:

```bash
docker run --rm hello-world     # prints "Hello from Docker!"
docker compose version          # prints "Docker Compose version v2.x"
```

Membership in the `docker` group is effectively root access. That is fine here: it is
your own user on your own server.

## 7. DuckDNS: point the domain at the server

Do this **before** starting Caddy: Caddy requests a certificate as soon as it sees the
domain, and if DNS does not point at the server yet, Let's Encrypt fails and Caddy
retries with growing delays.

1. Log in at [duckdns.org](https://www.duckdns.org), add a subdomain (e.g. `sfl-monitor`).
2. In the **current ip** field enter `<SERVER_IP>`, click **update ip**.
   Leave the IPv6 field empty.

The server's IP is static, so this one-time update is enough — DuckDNS's update cron
job is only needed for changing IPs.

**[local]** check (may take a minute or two):

```bash
nslookup <your-domain>          # must show <SERVER_IP>
```

## 8. Edge proxy — once per server

The edge is shared by all projects on the server; it is set up once. Its template
lives in this repository under `deploy/edge/` (see `deploy/edge/README.md`).

### 8.1 Clone the repository

**[server]**

```bash
cd ~
git clone <repo-url> sfl-price-monitor
```

If the repository is private, the simplest option is a read-only **deploy key**:
on the server run `ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""`, add the
contents of `~/.ssh/github_deploy.pub` in GitHub → repository → Settings → Deploy keys,
then clone with
`GIT_SSH_COMMAND="ssh -i ~/.ssh/github_deploy" git clone git@github.com:<you>/sfl-price-monitor.git`
and run `git config core.sshCommand "ssh -i ~/.ssh/github_deploy"` inside the clone.

### 8.2 Create the shared network and /opt/edge

**[server]**

```bash
docker network create edge

sudo mkdir -p /opt/edge/sites
sudo chown -R deploy:deploy /opt/edge
cp ~/sfl-price-monitor/deploy/edge/docker-compose.yml /opt/edge/
cp ~/sfl-price-monitor/deploy/edge/Caddyfile /opt/edge/
cp ~/sfl-price-monitor/deploy/edge/.env.example /opt/edge/.env
nano /opt/edge/.env              # set ACME_EMAIL to your real email
```

In `nano`: edit, then **Ctrl+O**, Enter to save, **Ctrl+X** to exit.

These are copies: later changes to `deploy/edge/` in the repository do not reach the
server until you copy the files again.

### 8.3 Start the edge

**[server]**

```bash
cd /opt/edge
docker compose up -d
docker compose ps                # caddy: "Up"
docker compose logs caddy
```

`sites/` is still empty, so the logs show a warning that the import pattern matched no
files. That is expected — no site is configured yet.

## 9. Deploy SFL

### 9.1 Configure `.env`

**[server]**

```bash
cd ~/sfl-price-monitor
cp .env.example .env
nano .env
```

| Variable | Value |
|---|---|
| `DATABASE_URL` | the direct Neon connection string from step 2 |
| `JWT_SECRET` | output of `openssl rand -hex 32` |
| `BOT_INTERNAL_SECRET` | output of `openssl rand -hex 16` |
| `TELEGRAM_BOT_TOKEN` | token from @BotFather |
| `ENABLE_SWAGGER` | `true` — public Swagger is intentional, see `CLAUDE.md` |
| `PORT` | keep `3000` — the site file in 9.2 proxies to port 3000 |

Leave the rest as in `.env.example`. Protect the file — it holds secrets:

```bash
chmod 600 .env
```

### 9.2 Add the SFL site to the edge

**[server]**

```bash
cp ~/sfl-price-monitor/deploy/caddy/sfl.caddy.example /opt/edge/sites/sfl.caddy
nano /opt/edge/sites/sfl.caddy   # replace sfl-monitor.duckdns.org with <your-domain>
```

If you ever change `PORT` in `.env`, change `sfl-api:3000` in this file to match.

### 9.3 Start SFL

**[server]**

```bash
cd ~/sfl-price-monitor
docker compose up -d --build     # first build takes a few minutes
docker compose ps                # api: "Up (healthy)", bot: "Up"
```

`bot` waits until `api` is healthy, so it may show up a little later.

### 9.4 Reload the edge

**[server]**

```bash
cd /opt/edge
docker compose exec -w /etc/caddy caddy caddy reload --config /etc/caddy/Caddyfile
docker compose logs -f caddy     # watch for "certificate obtained successfully"; Ctrl+C to stop
```

`caddy reload` applies the new config inside the running container without a restart,
so other sites on the server see no downtime.

## 10. Verify

**[local]**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/health                 # 200
curl -sL -o /dev/null -w '%{http_code}\n' https://<your-domain>/docs                  # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<your-domain>/api/auth/login # 404 — blocked at the edge
nc -zv -w 5 <SERVER_IP> 3000                                                          # must FAIL — api is not exposed
```

In Telegram, message your bot:
- `/start` — replies confirming registration/login.
- `/prices` — replies with current prices.

### If something fails

| Symptom | Where to look |
|---|---|
| `curl` hangs or "connection refused" | Cloud Firewall rules and that it is applied to the server (step 4); `docker compose ps` in `/opt/edge` |
| TLS / certificate error | `docker compose logs caddy` in `/opt/edge`. Usually DNS does not point at `<SERVER_IP>` yet (step 7) or port 80 is closed in the firewall |
| `502 Bad Gateway` | Caddy cannot reach `sfl-api`. Is `api` running (`docker compose ps` in the project)? Is it in the edge network (`docker network inspect edge` lists `sfl-price-monitor-api-1`)? Typo in the site file? |
| Bot is silent | `docker compose logs bot` in the project. A `409 Conflict` from Telegram means another copy of the bot (e.g. on your laptop) is polling with the same token — stop it |
| api restarts in a loop | `docker compose logs api` — usually a wrong `DATABASE_URL` or a missing variable in `.env` |

## 11. Updating after new commits

**[server]**

```bash
cd ~/sfl-price-monitor
git pull
docker compose up -d --build
docker image prune -f            # remove old image layers left by the rebuild
```

Migrations run automatically when `api` starts. The edge does not need a reload unless
the site file changed.

## 12. Adding another project to this server

1. **Do not publish ports** in the new project's compose — the edge owns 80/443.
2. Connect **only** the service Caddy proxies to (usually the HTTP api) to the external
   `edge` network with an alias that is **unique across all projects on the server**,
   prefixed with the project name:

   ```yaml
   services:
     api:
       networks:
         default:
         edge:
           aliases:
             - myproject-api

   networks:
     edge:
       external: true
       name: edge
   ```

   Why only one service and why a prefix: Docker registers each service's plain name
   (`api`, `bot`, `db`…) in **every** network the container joins. If two projects both
   attach a service called `api` to `edge`, the name `api` becomes ambiguous for any
   container attached to `edge` — a request can land in the wrong project. Keep internal
   services (databases, workers, bots) in the project's own network, and have Caddy
   address projects only by their unique alias.
3. Point a domain (e.g. a new DuckDNS subdomain) at `<SERVER_IP>`.
4. Add `/opt/edge/sites/<project>.caddy`:

   ```
   myproject.duckdns.org {
   	reverse_proxy myproject-api:<port>
   }
   ```
5. Start the project (`docker compose up -d --build`), then reload the edge
   (command below).

## 13. Cheat sheet

```bash
# edge (run in /opt/edge)
docker compose exec -w /etc/caddy caddy caddy reload --config /etc/caddy/Caddyfile   # after editing sites/*.caddy
docker compose restart caddy        # after editing the main Caddyfile (single-file bind mount)
docker compose logs -f caddy

# SFL (run in ~/sfl-price-monitor)
docker compose ps
docker compose logs -f api
docker compose logs -f bot
docker compose restart bot
docker compose up -d --build        # after git pull or .env changes

# server
docker network inspect edge         # who is attached to the shared network
df -h /                             # disk space
free -m                             # memory
```
