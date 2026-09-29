# Edge proxy (server-wide)

This is **server infrastructure shared by every project on the VPS**, not part of
SFL Price Monitor. It lives here only because SFL is currently the first and only
project on the server. When a second project arrives, move this directory into a
dedicated infra repository.

## What it does

- One Caddy container is the only thing on the server that publishes ports
  80 and 443. Only one process can listen on a port, so projects must not
  publish 80/443 themselves.
- Caddy obtains and renews HTTPS certificates from Let's Encrypt automatically.
- Projects join the shared external docker network `edge` under a unique alias
  (for example `sfl-api`), and Caddy proxies to them by that alias.
- Each project has its own small site file in `sites/`; the main `Caddyfile`
  imports all of them.

## Layout on the server

```
/opt/edge/
  docker-compose.yml   from this directory
  Caddyfile            from this directory
  .env                 ACME_EMAIL=..., see .env.example
  sites/
    sfl.caddy          from deploy/caddy/sfl.caddy.example, domain filled in
```

## Commands (run in /opt/edge)

```bash
docker network create edge        # once per server, before the first `up`
docker compose up -d              # start
docker compose logs -f caddy      # watch certificate issuance and errors

# after adding or editing a file in sites/ — no downtime
docker compose exec -w /etc/caddy caddy caddy reload --config /etc/caddy/Caddyfile

# after editing the main Caddyfile — the file is bind-mounted as a single file,
# and editors replace it on save, so the container keeps seeing the old one
docker compose restart caddy
```

Full walkthrough: [`docs/deploy-hetzner.md`](../../docs/deploy-hetzner.md).
