# Deploying BTU Market

Production is one Oracle Cloud free-tier VM (Ubuntu 24.04) running the app
via Docker Compose, behind Caddy (HTTPS) behind Cloudflare (DNS/CDN). The
database is Postgres on Neon; the image is built by CI and pulled from GHCR.
Total hosting cost: $0.

## The routine deploy

The server never builds anything and never creates commits - the dev machine
commits and pushes, CI builds, the server pulls.

```bash
# 1. On the dev machine, after merging to main:
git push
gh workflow run ci.yml --ref main   # manual dispatch = the run that pushes the image

# 2. Wait for that dispatch run (not the plain push run) to go green:
gh run list --workflow=ci.yml --event workflow_dispatch --limit 1

# 3. On the server:
ssh ubuntu@SERVER_IP
cd btu && git pull                  # compose/config changes, if any
docker pull ghcr.io/600kgs/btu-backend:latest
docker compose -f docker-compose.prod.yml up -d
```

`deploy.sh` on the server wraps step 3 (including `alembic upgrade head`, so
schema migrations apply automatically).

Verify a frontend change actually landed by diffing the hashed asset name -
a `/health` 200 only proves the process is up:

```bash
curl -s https://btumarket.ge/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'
```

## Server layout

- `/home/ubuntu/btu` - git checkout: compose file, `.env`, `backend/uploads/`
  (bind-mounted into the container), `backups/`
- `/etc/caddy/Caddyfile` - live copy of [deploy/Caddyfile](deploy/Caddyfile);
  after editing, `sudo systemctl reload caddy`
- Nightly cron runs [backup.sh](backup.sh): `pg_dump` of Neon + a tarball of
  uploads, 14-day retention, logged to `backups/backup.log`

## Environment

All runtime config lives in `.env` on the server (never in git) - see
[deploy/env.example](deploy/env.example) for the full list. Edit individual
lines rather than rewriting the file; several services share it.

## First-time setup

Condensed, since it only ever happens once: create the VM (open 80/443 in
both the cloud security list and the OS firewall), install Docker and Caddy,
clone the repo, write `.env` from the example, copy `deploy/Caddyfile` into
`/etc/caddy/`, point DNS at the VM through Cloudflare (SSL mode "Full
(strict)"), then run the routine deploy above.
