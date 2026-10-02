# The game server, serving the browser client too. It keeps the repository
# layout under /app: the server reads data/, the migrations and the client
# files by their place in the tree.
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a code-only change reuses this layer.
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY packages/steem/package.json packages/steem/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY data data
COPY packages packages
COPY tools tools

# The release this image serves: the version in package.json and the commit
# deploy/deploy.sh builds it from (docker-compose.yml passes APP_TAG; empty
# for an untagged local build). It is stamped into the client
# (packages/client/src/release.js) and the server names it in
# GET /api/maintenance: a tab running another build offers to update. Baked in
# the image, it stays right when an older image is started again (a rollback).
ARG M8_BUILD=
ENV M8_BUILD=$M8_BUILD
RUN node tools/stamp-release.js

# Inside a container the server must listen on every interface; the proxy reaches it over the compose network.
ENV M8_HOST=0.0.0.0 \
    M8_PORT=8080 \
    M8_LOG_FORMAT=json
EXPOSE 8080
USER node
CMD ["node", "packages/server/src/main.js"]
