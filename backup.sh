#!/bin/bash
# Nightly Postgres + uploads backup, keeps the last 14 days of each.
# Installed via crontab:  0 4 * * * /home/ubuntu/btu/backup.sh >> /home/ubuntu/btu/backups/backup.log 2>&1
#
# The database runs in the compose "postgres" service (moved off Neon on
# 2026-09-24), so pg_dump runs inside that container: same version as the
# server by construction, no password, no network hop. Uploads are the
# OTHER irreplaceable data - they live in backend/uploads/ (the compose bind
# mount), NOT the retired top-level uploads/ dir from the pre-Docker era.
set -euo pipefail
APP=/home/ubuntu/btu
DEST=$APP/backups
mkdir -p "$DEST"
STAMP=$(date +%F)

# -T: no TTY - cron has none, and exec fails without this flag.
docker compose -f "$APP/docker-compose.prod.yml" --project-directory "$APP" exec -T postgres \
    pg_dump -U btu --no-owner --no-privileges btumarket | gzip > "$DEST/pg-$STAMP.sql.gz"
tar -czf "$DEST/uploads-$STAMP.tar.gz" -C "$APP/backend" uploads

ls -t "$DEST"/pg-*.sql.gz | tail -n +15 | xargs -r rm
ls -t "$DEST"/uploads-*.tar.gz | tail -n +15 | xargs -r rm

# A success line per run - before this, the log only ever recorded failures,
# so an empty log couldn't distinguish "working" from "not running at all".
echo "$(date -Is) OK: pg $(stat -c%s "$DEST/pg-$STAMP.sql.gz")B, uploads $(stat -c%s "$DEST/uploads-$STAMP.tar.gz")B"
