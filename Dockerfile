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

# Inside a container the server must listen on every interface; the proxy reaches it over the compose network.
ENV M8_HOST=0.0.0.0 \
    M8_PORT=8080 \
    M8_LOG_FORMAT=json
EXPOSE 8080
USER node
CMD ["node", "packages/server/src/main.js"]
