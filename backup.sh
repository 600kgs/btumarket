#!/bin/bash
# Nightly Postgres + uploads backup, keeps the last 14 days of each.
# Installed via crontab:  0 4 * * * /home/ubuntu/btu/backup.sh >> /home/ubuntu/btu/backups/backup.log 2>&1
#
# The database lives on Neon (Postgres), so "backup" means pg_dump over the
# network - Neon's own point-in-time history on the free tier only reaches
# back ~24h, which is not a real safety net. pg_dump runs from the official
# postgres Docker image because the client's major version must be >= the
# server's (Neon runs 18; Ubuntu 24.04 packages 16) and the VM already runs
# Docker anyway. Uploads are the OTHER irreplaceable data - they live in
# backend/uploads/ (the compose bind mount), NOT the retired top-level
# uploads/ dir from the pre-Docker era.
set -euo pipefail
APP=/home/ubuntu/btu
DEST=$APP/backups
mkdir -p "$DEST"
STAMP=$(date +%F)

# The app's own connection string, minus the SQLAlchemy-only "+psycopg"
# driver marker that pg_dump wouldn't understand.
# tr strips a Windows carriage return - the .env line ends CRLF, which the
# app's env parser tolerates but libpq reports as an invalid parameter value.
PG_URL=$(grep -oP '^MARKETPLACE_DATABASE_URL=\K.*' "$APP/.env" | tr -d '\r' | sed 's/postgresql+psycopg:/postgresql:/')
if [ -z "$PG_URL" ]; then
    echo "$(date -Is) FAILED: no MARKETPLACE_DATABASE_URL in $APP/.env"
    exit 1
fi

docker run --rm postgres:18-alpine pg_dump --no-owner --no-privileges "$PG_URL" | gzip > "$DEST/pg-$STAMP.sql.gz"
tar -czf "$DEST/uploads-$STAMP.tar.gz" -C "$APP/backend" uploads

ls -t "$DEST"/pg-*.sql.gz | tail -n +15 | xargs -r rm
ls -t "$DEST"/uploads-*.tar.gz | tail -n +15 | xargs -r rm

# A success line per run - before this, the log only ever recorded failures,
# so an empty log couldn't distinguish "working" from "not running at all".
echo "$(date -Is) OK: pg $(stat -c%s "$DEST/pg-$STAMP.sql.gz")B, uploads $(stat -c%s "$DEST/uploads-$STAMP.tar.gz")B"
