#!/bin/sh
# Announces a maintenance from the server's machine (the admin page does the
# same). From the announcement the game takes no new shop orders, purchases
# between players or queue entries, and players see a countdown; games in
# progress go on. deploy.sh ends it after a successful deploy.
# Usage: sh deploy/maintenance.sh <minutes> ["message"]   announce
#        sh deploy/maintenance.sh off                      end it, everything reopens
#        sh deploy/maintenance.sh                          show what is announced
set -eu
cd "$(dirname "$0")/.."

notice() {
  docker compose exec -T app node packages/server/src/maintenance/maintenanceNotice.js "$@"
}

case "${1:-}" in
  '') notice show ;;
  off) notice end ;;
  *[!0-9]*)
    echo "usage: sh deploy/maintenance.sh <minutes> [\"message\"] | off" >&2
    exit 2
    ;;
  *) notice announce "$1" "${2:-}" ;;
esac
