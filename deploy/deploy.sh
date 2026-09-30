#!/bin/sh
# Brings the production stack to a commit (default: the tip of origin/master).
#   1. checks out the commit and builds its image while the old version keeps serving;
#   2. backs up the database (a new migration makes the old version refuse the database);
#   3. replaces the app container and waits until /api/ready answers;
#   4. if it does not, puts the previous image and commit back and fails.
# Usage (on the server): sh deploy/deploy.sh [commit]
set -eu

# Everything runs from this function: git checkout may rewrite this very file,
# and sh reads a script while executing it.
main() {
  cd "$(dirname "$0")/.."
  git fetch --quiet origin master
  target=$(git rev-parse --verify "${1:-origin/master}^{commit}")
  previous=$(git rev-parse HEAD)
  tag=$(echo "$target" | cut -c1-12)

  echo "deploy: $previous -> $target"
  git checkout --quiet --detach "$target"
  APP_TAG=$tag docker compose build app

  docker compose up -d --wait db caddy
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
  sh deploy/backup.sh "pre-$tag"

  if APP_TAG=$tag docker compose up -d --no-deps --wait --wait-timeout 90 app; then
    docker tag "magic8-tcg:$tag" magic8-tcg:current
    echo "deploy: $tag is live"
  else
    echo "deploy: $tag did not become ready; last log lines:" >&2
    APP_TAG=$tag docker compose logs --tail 50 app >&2 || true
    git checkout --quiet --detach "$previous"
    if docker image inspect magic8-tcg:current > /dev/null 2>&1; then
      echo "deploy: rolling back to the previous image" >&2
      docker compose up -d --no-deps --wait --wait-timeout 90 app || true
    fi
    echo "deploy: FAILED. If $tag applied a migration, the previous version refuses the database: restore the pre-$tag backup (deploy/README.md)." >&2
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
