#!/bin/sh
# Brings the production stack to a commit (default: the tip of origin/master).
#   1. announces a maintenance (default in 5 minutes): players see the countdown,
#      the shop, sales between players and the queue close (deploy/maintenance.sh);
#   2. checks out the commit and builds its image while the old version keeps serving;
#   3. waits until the announced time, or less once no game is in progress;
#   4. backs up the database (a new migration makes the old version refuse the database);
#   5. replaces the app container and waits until /api/ready answers, then ends the maintenance;
#   6. if it does not, puts the previous image and commit back and fails.
# A failure before the swap ends the maintenance: the old version goes on serving.
# Usage (on the server): sh deploy/deploy.sh [--notice=<minutes>] [commit]
#   minutes: 0..1440, default M8_DEPLOY_NOTICE_MINUTES or 5. The commit stays the last word:
#   an SSH key limited to the deploy (deploy/README.md) passes only that one.
set -eu

MESSAGE="A new version is being installed."
# How often the wait looks at the games in progress.
POLL_SECONDS=15

# The running version's command line. The new image's would migrate the database before the swap.
notice() {
  docker compose exec -T app node packages/server/src/maintenance/maintenanceNotice.js "$@" > /dev/null
}

# Games not finished yet (waiting for the players' signatures, or being played); "?" when it cannot tell.
live_games() {
  docker compose exec -T db psql -U magic8 -d magic8 -tAc "SELECT count(*) FROM games WHERE status IN ('CREATED', 'ACTIVE')" 2> /dev/null | tr -d '[:space:]' || echo "?"
}

# A failure before the swap: the old version is still serving, reopen it and stop.
abort() {
  echo "deploy: $1; the running version stays" >&2
  git checkout --quiet --detach "$previous"
  notice end || echo "deploy: could not end the maintenance; end it with: sh deploy/maintenance.sh off" >&2
  exit 1
}

# Everything runs from this function: git checkout may rewrite this very file,
# and sh reads a script while executing it.
main() {
  cd "$(dirname "$0")/.."
  minutes=${M8_DEPLOY_NOTICE_MINUTES:-5}
  case "${1:-}" in
    --notice=*)
      minutes=${1#--notice=}
      shift
      ;;
  esac
  case "$minutes" in
    '' | *[!0-9]*)
      echo "deploy: the notice is a number of minutes, not '$minutes'" >&2
      exit 2
      ;;
  esac
  if [ "$minutes" -gt 1440 ]; then
    echo "deploy: a notice is 1440 minutes at most" >&2
    exit 2
  fi
  git fetch --quiet origin master
  target=$(git rev-parse --verify "${1:-origin/master}^{commit}")
  previous=$(git rev-parse HEAD)
  tag=$(echo "$target" | cut -c1-12)

  echo "deploy: $previous -> $target, maintenance in $minutes min"
  deadline=$(( $(date +%s) + minutes * 60 ))
  notice announce "$minutes" "$MESSAGE" || echo "deploy: could not announce the maintenance (is the app running?); going on" >&2

  git checkout --quiet --detach "$target"
  APP_TAG=$tag docker compose build app || abort "the image did not build"

  # Games in progress have until the announced time; once none is left there is nothing to wait for.
  while [ "$(date +%s)" -lt "$deadline" ]; do
    games=$(live_games)
    if [ "$games" = "0" ]; then
      break
    fi
    echo "deploy: ${games:-?} game(s) in progress, $(( deadline - $(date +%s) ))s left"
    sleep "$POLL_SECONDS"
  done
  if [ "$(date +%s)" -lt "$deadline" ]; then
    # Earlier than announced: the banner says it is under way rather than counting down to a time already moot.
    notice announce 0 "$MESSAGE" || true
  fi

  docker compose up -d --wait db || abort "the database is not ready"
  sh deploy/backup.sh "pre-$tag" || abort "the backup failed"

  if APP_TAG=$tag docker compose up -d --no-deps --wait --wait-timeout 90 app; then
    docker tag "magic8-tcg:$tag" magic8-tcg:current
    echo "deploy: $tag is live"
    # The maintenance is over: everything reopens (on the new version, which open tabs offer to reload).
    notice end || echo "deploy: could not end the maintenance; end it with: sh deploy/maintenance.sh off" >&2
  else
    echo "deploy: $tag did not become ready; last log lines:" >&2
    APP_TAG=$tag docker compose logs --tail 50 app >&2 || true
    git checkout --quiet --detach "$previous"
    if docker image inspect magic8-tcg:current > /dev/null 2>&1; then
      echo "deploy: rolling back to the previous image" >&2
      if docker compose up -d --no-deps --wait --wait-timeout 90 app && notice end; then
        echo "deploy: FAILED; the previous version is serving again" >&2
        exit 1
      fi
    fi
    echo "deploy: FAILED. If $tag applied a migration, the previous version refuses the database: restore the pre-$tag backup (deploy/README.md), then: sh deploy/maintenance.sh off" >&2
    exit 1
  fi

  # Keeps the running image and the two before it, for a quick manual rollback.
  docker image ls magic8-tcg --format '{{.Tag}} {{.ID}}' \
    | grep -v -e '^current ' -e "^$tag " \
    | tail -n +3 | cut -d' ' -f1 \
    | xargs -r -I{} docker image rm "magic8-tcg:{}" > /dev/null || true
  docker image prune -f > /dev/null
}

main "$@"
exit
