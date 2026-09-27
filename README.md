# Magic8 TCG

Multiplayer collectible card game built on the magic8 rules engine (forked with its history):

- **authoritative server**: clients send intentions, the server validates them with the deterministic engine;
- **STEEM** for identity (Steem Keychain login, no private key ever leaves the browser), payments (standard `transfer` operations, verified on-chain) and a public record, through `custom_json`, of what changes hands: purchase receipts, pack draws (verifiable from the chain alone), trades and sales, and each game's result. A game's hash-chained history stays in the server's database; its result, published when it ends, commits to that history;
- blockchain access behind network-agnostic ports, so other chains or payment systems can be added without touching the game domain.

## Design documents (Italian)

| | |
|---|---|
| [00 — Analisi](docs/tcg/00-analisi.md) | What the magic8 engine gives us, what the existing STEEM projects teach, what in the brief had to change |
| [01 — Architettura](docs/tcg/01-architettura.md) | Bounded contexts, packages, layers, blockchain ports, domain model, main flows |
| [02 — Protocollo multiplayer e API](docs/tcg/02-protocollo-multiplayer.md) | HTTP API, WebSocket protocol, concurrency, reconnection, timers |
| [03 — Game Blockchain Protocol](docs/tcg/03-game-blockchain-protocol.md) | canonical JSON, hash-chained game events, commit-reveal, the `custom_json` records of receipts, packs, trades and sales |
| [04 — Modello dati](docs/tcg/04-modello-dati.md) | PostgreSQL schema and the invariants the database enforces |
| [05 — Threat model](docs/tcg/05-threat-model.md) | Threats, countermeasures, accepted residual risks |
| [06 — Roadmap](docs/tcg/06-roadmap.md) | Milestones M0–M7 and their status |

The engine's own architecture document is [docs/engine/ARCHITECTURE.md](docs/engine/ARCHITECTURE.md).

## Packages

```
packages/
  engine/     @magic8/engine    rules engine: pure, deterministic, zero dependencies
  protocol/   @magic8/protocol  canonical JSON, hashing, game events, on-chain records, pack verifier
  steem/      @magic8/steem     STEEM adapter: keys, Keychain signature verification, RPC client with failover
  server/     @magic8/server    modular monolith: HTTP platform, identity (schema in packages/server/migrations)
  client/     @magic8/client    canvas client: sign in with Keychain, offline practice against the AI
data/                           cards, decks, rules, theme — validated JSON, nothing trusted
```

## Commands

Requires Node ≥ 22.

| Command | Purpose |
|---|---|
| `npm install` | Install workspace links and dev dependencies |
| `npm test` | Run every package's `node --test` suite |
| `npm run lint` | ESLint with the Sonar-aligned rule set |
| `npm start` | Game server at http://127.0.0.1:8080/: API + client, sign-in verified against STEEM mainnet |
| `npm run check` | Lint, then every test suite |
| `npm run serve` | Static dev server for the client only (offline practice; no sign-in) |
| `npm run simulate [games]` | Headless AI-vs-AI round robin over the bundled decks |

## Running the server

`npm start` reads its configuration from environment variables (validated at startup):

| Variable | Default | Meaning |
|---|---|---|
| `M8_PUBLIC_ORIGIN` | `http://127.0.0.1:8080` | The origin browsers use. `https://…` switches on Secure `__Host-` cookies and HSTS; plain http is refused except for localhost. |
| `M8_HOST` / `M8_PORT` | `127.0.0.1` / `8080` | Listen address |
| `M8_TRUST_PROXY` | `false` | Take the client IP from `X-Forwarded-For` (only behind your own reverse proxy) |
| `M8_STEEM_NODES` | `api.moecki.online`, then three public fallbacks | Comma-separated https JSON-RPC nodes, in priority order. At least two: a payment is confirmed only when two nodes agree. |
| `M8_APP_NAME` | `verdu.green` | First line of the login message users sign |
| `M8_DATABASE_URL` | `pglite:.data/pglite` for localhost | `postgres://user:pass@host:5432/db?sslmode=require` for a PostgreSQL server (required with an https origin). `pglite:<dir>` or `pglite:memory` runs PostgreSQL in process, for development only. The schema is migrated at startup. |
| `M8_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `M8_LOG_FORMAT` | `pretty` | `pretty`: short readable lines, without hashes, transaction ids and keys; `json`: every field, one object per line, for log collectors |
| `M8_SHOP_ACCOUNT` | `verdu.green` | STEEM account that receives payments. Its keys never go on the server. |
| `M8_DATA_KEY` | public development key on localhost | 64 hex characters (`openssl rand -hex 32`) that encrypt secrets at rest (pack epochs). **Required** with an https origin. |
| `M8_DATA_KEY_ID` / `M8_DATA_KEYS_OLD` | `1` / — | Key rotation: the current key's id, and retired keys as `id:hex,id:hex` so older secrets still open. |

Locally, nothing needs installing: the first `npm start` creates an embedded PostgreSQL (PGlite) in `.data/pglite`, and users, sessions and the audit trail survive restarts. Delete that directory to start from scratch.
