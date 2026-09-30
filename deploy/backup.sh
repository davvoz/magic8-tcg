#!/bin/sh
# Dumps the database into backups/<label>-<UTC time>.dump (pg_dump custom
# format; restore with pg_restore) and keeps the newest $KEEP dumps.
# Usage: sh deploy/backup.sh [label]   e.g. from cron: sh deploy/backup.sh daily
set -eu
cd "$(dirname "$0")/.."

LABEL=${1:-manual}
KEEP=${KEEP:-14}
mkdir -p backups
FILE="backups/$LABEL-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose exec -T db pg_dump -U magic8 -d magic8 -Fc > "$FILE.partial"
mv "$FILE.partial" "$FILE"
echo "backup: $FILE ($(du -h "$FILE" | cut -f1))"

ls -1t backups/*.dump | tail -n +"$((KEEP + 1))" | xargs -r rm --
