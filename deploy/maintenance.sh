#!/bin/sh
# Announces a maintenance: the game shows a countdown banner. It reads
# /maintenance.json, which nginx serves from the repository directory, so
# nothing restarts. deploy.sh removes the notice after a successful deploy.
# Usage: sh deploy/maintenance.sh <minutes> ["message"]   announce
#        sh deploy/maintenance.sh off                      remove the banner
set -eu
cd "$(dirname "$0")/.."
FILE=maintenance.json

if [ "${1:-}" = off ]; then
  rm -f "$FILE"
  echo "maintenance: banner removed"
  exit
fi
case "${1:-}" in
  '' | *[!0-9]*)
    echo "usage: sh deploy/maintenance.sh <minutes> [\"message\"] | off" >&2
    exit 2
    ;;
esac

at=$(date -u -d "+$1 minutes" +%Y-%m-%dT%H:%M:%SZ)
message=$(printf '%s' "${2:-}" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"at":"%s","message":"%s"}\n' "$at" "$message" > "$FILE.tmp"
chmod 644 "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
echo "maintenance: announced for $at UTC (in $1 minutes)"
