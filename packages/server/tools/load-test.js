/**
 * Load test: the real server (in process, PGlite in memory, a fake STEEM
 * chain that produces a block every 3 s and a broadcaster publishing every
 * record) and N simulated players, each from its own address: sign in
 * (challenge + signature), take a starter deck, open a WebSocket, queue,
 * and play whole games with random legal moves. One extra client floods
 * the server with messages while the games run.
 *
 *   node packages/server/tools/load-test.js [players=40] [maxCommandsPerGame=400]
 *
 * With M8_LOAD_DATABASE_URL=postgres://… it runs against that PostgreSQL
 * instead (migrated first; use a throwaway database: it fills it).
 *
 * Prints a JSON report: games, commands, command latency percentiles (from
 * sending a command to its ack), event-loop delay, memory, what the chain
 * received, and whether the flooder was cut off.
 */
import { createServer } from "node:http";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { clearInterval, setInterval } from "node:timers";

import { WebSocket } from "ws";
import { createServerApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryLogger } from "../src/kernel/logger.js";
import { openDatabase } from "../src/platform/db/openDatabase.js";
import { nodeSecureRandom } from "../src/kernel/random.js";
import { systemClock } from "../src/kernel/time.js";
import { FakeChain, bundledContent, keyPair, keychainSign, testAckSigner, toWif } from "../test/helpers.js";
import { freshDatabase } from "../test/support/database.js";
import { FakeSteemLedger } from "../test/support/fakeSteemLedger.js";
import { broadcastersManifest, moveMessage, sessionAuthorization } from "@magic8/protocol";
import { SteemWalletProvider } from "@magic8/steem";
import { verifySessionSignature } from "../src/kernel/crypto/sessionSignatures.js";

const PLAYERS = Number(process.argv[2] ?? 40);
const MAX_COMMANDS = Number(process.argv[3] ?? 400);
const STARTERS = ["precon_foundry", "precon_harvest", "precon_verdant"];
const BROADCASTER = "m8tcg-b1";
const ROOT = "m8tcg";

/** @param {number[]} values @param {number} q */
const percentile = (values, q) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0 ? 0 : Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10;
};

/** One simulated player: HTTP from its own address, then a WebSocket. */
class Player {
  /** @type {WebSocket | null} */
  socket = null;
  cookie = "";
  seat = "";
  gameId = "";
  commands = 0;
  /** @type {{ key: string, sign: (message: string) => string } | undefined} this game's session key (v2) */
  session = undefined;
  /** @type {Map<string, number>} request id → sent at */
  #pending = new Map();
  #next = 0;

  /**
   * @param {{ base: string, index: number, stats: any, onDone: () => void }} deps
   */
  constructor({ base, index, stats, onDone }) {
    this.base = base;
    this.account = `player${String(index).padStart(4, "0")}`.slice(0, 16);
    this.address = `10.1.${Math.floor(index / 250)}.${(index % 250) + 1}`;
    this.keys = keyPair((index % 250) + 1);
    this.starter = STARTERS[index % STARTERS.length];
    this.stats = stats;
    this.onDone = onDone;
  }

  /** @param {string} path @param {unknown} [body] */
  async #http(path, body) {
    const response = await fetch(`${this.base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-m8-request": "1", origin: this.base, "x-forwarded-for": this.address, ...(this.cookie === "" ? {} : { cookie: this.cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`${path}: ${response.status} ${JSON.stringify(json)}`);
    }
    return { json, headers: response.headers };
  }

  async signIn() {
    const challenge = await this.#http("/api/auth/challenges", { account: this.account });
    const session = await this.#http("/api/auth/sessions", { challengeId: challenge.json.challengeId, signature: keychainSign(challenge.json.message, this.keys.privateKey) });
    this.cookie = (session.headers.getSetCookie().find((value) => value.startsWith("m8_session=")) ?? "").split(";")[0];
    this.deckId = (await this.#http("/api/starter", { starterId: this.starter })).json.deck.id;
  }

  async connect() {
    this.socket = new WebSocket(`${this.base.replace("http", "ws")}/ws`, { headers: { cookie: this.cookie, origin: this.base, "x-forwarded-for": this.address } });
    await new Promise((resolve, reject) => {
      this.socket?.on("open", resolve);
      this.socket?.on("error", reject);
    });
    this.socket.on("message", (raw) => this.#receive(JSON.parse(raw.toString())));
    this.#send("queue.join", { mode: "casual", deckId: this.deckId });
  }

  /** @param {string} t @param {unknown} d */
  #send(t, d) {
    const id = `r${(this.#next += 1)}`;
    this.#pending.set(id, performance.now());
    this.socket?.send(JSON.stringify({ t, id, d }));
    return id;
  }

  /** @param {any} message */
  #receive(message) {
    if (message.re === undefined) {
      this.#event(message);
    } else {
      this.#reply(message);
    }
  }

  /** @param {any} message a reply to one of our requests */
  #reply(message) {
    const sentAt = this.#pending.get(message.re);
    this.#pending.delete(message.re);
    if (message.t === "game.ack" && sentAt !== undefined) {
      this.stats.latencies.push(performance.now() - sentAt);
      if (!message.d.ok) {
        this.stats.rejected[message.d.error.code] = (this.stats.rejected[message.d.error.code] ?? 0) + 1;
      }
    }
    if (message.t === "error") {
      this.stats.errors[message.d.code] = (this.stats.errors[message.d.code] ?? 0) + 1;
    }
  }

  /** @param {any} message a push from the server */
  #event(message) {
    if (message.t === "match.found") {
      this.gameId = message.d.gameId;
      this.seat = message.d.seat;
      if (message.d.protocol >= 2) {
        // Signed moves: a session key, authorised like Keychain would (docs/tcg/12).
        this.session = sessionKey();
        this.#send("game.session", { gameId: this.gameId, key: this.session.key, authorization: keychainSign(sessionAuthorization(this.gameId, this.session.key), this.keys.privateKey) });
      }
      this.#send("game.entropy", { gameId: this.gameId, entropy: randomUUID().replaceAll("-", "") });
    } else if (message.t === "game.events" || message.t === "game.state") {
      this.#maybeMove(message.d);
    } else if (message.t === "game.over") {
      this.stats.gamesOver += this.seat === "s0" ? 1 : 0;
      this.onDone();
    }
  }

  /** @param {any} view */
  #maybeMove(view) {
    const snapshot = view.snapshot;
    if (view.status !== "ACTIVE" || snapshot.awaitingPlayerId !== this.seat) {
      return;
    }
    this.commands += 1;
    this.stats.commands += 1;
    const commandId = randomUUID();
    if (this.commands > MAX_COMMANDS) {
      this.#send("game.concede", { gameId: this.gameId, commandId, ...this.#signed(commandId, view.version, { type: "CONCEDE" }) });
      return;
    }
    const command = chooseMove(snapshot);
    this.#send("game.command", { gameId: this.gameId, commandId, expectedVersion: view.version, command, ...this.#signed(commandId, view.version, command) });
  }

  /**
   * v2: the signature (and version) that go with a command.
   * @param {string} commandId
   * @param {number} expectedVersion
   * @param {Record<string, unknown>} command
   */
  #signed(commandId, expectedVersion, command) {
    if (this.session === undefined) {
      return {};
    }
    return { expectedVersion, signature: this.session.sign(moveMessage({ gameId: this.gameId, commandId, expectedVersion, command })) };
  }

  close() {
    this.socket?.close();
  }
}

/** A browser's session key: P-256, signatures as r ‖ s (what WebCrypto makes). */
function sessionKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const key = `04${Buffer.from(/** @type {string} */ (jwk.x), "base64url").toString("hex")}${Buffer.from(/** @type {string} */ (jwk.y), "base64url").toString("hex")}`;
  return { key, sign: (/** @type {string} */ message) => sign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("hex") };
}

/** @param {any} snapshot the player's own view */
function chooseMove(snapshot) {
  const moves = snapshot.legalMoves;
  const playable = moves.playableCardIds.filter((cardId) => (moves.targetOptions[cardId] ?? []).every((group) => group.length > 0));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  if (playable.length > 0 && Math.random() < 0.6) {
    const cardId = pick(playable);
    return { type: "PLAY_CARD", cardId, targets: (moves.targetOptions[cardId] ?? []).map((group) => pick(group)) };
  }
  if (snapshot.phase === "COMBAT_ATTACKERS") {
    return { type: "DECLARE_ATTACKERS", attackerIds: moves.attackerIds.filter(() => Math.random() < 0.7) };
  }
  if (snapshot.phase === "COMBAT_BLOCKERS") {
    const attackers = snapshot.combat.attackerIds;
    return { type: "DECLARE_BLOCKERS", blocks: moves.blockerIds.slice(0, attackers.length).filter(() => Math.random() < 0.5).map((blockerId, index) => ({ attackerId: attackers[index], blockerId })) };
  }
  return moves.canEndPhase ? { type: "END_PHASE" } : { type: "END_TURN" };
}

/** A client that sends messages as fast as it can; the server must cut it off and stay responsive. */
async function flood(base, cookie) {
  const socket = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { cookie, origin: base, "x-forwarded-for": "10.9.9.9" } });
  await new Promise((resolve) => socket.on("open", resolve));
  const closed = new Promise((resolve) => socket.on("close", (code) => resolve(code)));
  let sent = 0;
  while (socket.readyState === WebSocket.OPEN && sent < 5000) {
    socket.send(JSON.stringify({ t: "hello", d: {} }));
    sent += 1;
    if (sent % 100 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  return { sent, closeCode: await closed };
}

async function main() {
  const ledger = new FakeSteemLedger();
  const wallets = new FakeChain();
  const broadcasterKey = new Uint8Array(32).fill(99);
  ledger.addAccount(BROADCASTER, broadcasterKey);
  const publishing = ledger.publishing(new Map([[BROADCASTER, toWif(broadcasterKey)]]));
  const logger = new MemoryLogger();
  const database = process.env.M8_LOAD_DATABASE_URL === undefined ? await freshDatabase() : await openDatabase({ url: process.env.M8_LOAD_DATABASE_URL, baseDirectory: process.cwd(), logger });
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  const app = await createServerApp({
    config: loadConfig({ M8_PUBLIC_ORIGIN: base, M8_TRUST_PROXY: "true", M8_ROOT_ACCOUNT: ROOT }),
    clock: systemClock,
    random: nodeSecureRandom,
    logger,
    wallets: new Map([["steem", new SteemWalletProvider({ chain: wallets, appName: "luciojolly" })]]),
    paymentProviders: new Map([["steem", ledger.paymentProvider()]]),
    defaultNetwork: "steem",
    database,
    content: await bundledContent(),
    publishing,
    ackSigner: testAckSigner,
    verifyMoveSignature: verifySessionSignature,
  });
  server.on("request", app.http.listener);
  app.realtime.attach(server);
  ledger.time = systemClock.now();
  ledger.publishManifest(ROOT, broadcastersManifest({ accounts: [BROADCASTER], fromBlock: 0 }));
  ledger.produceBlock();
  ledger.finalize();
  await app.chain.manifests.runOnce();

  const jobs = [
    setInterval(() => {
      ledger.time = systemClock.now();
      ledger.produceBlock();
      ledger.irreversibleBlock = Math.max(ledger.irreversibleBlock, ledger.headBlock - 15);
    }, 3000),
    setInterval(() => app.chain.broadcaster.runOnce().catch(() => undefined), 3000),
    setInterval(() => app.chain.tracker.runOnce().catch(() => undefined), 6000),
    setInterval(() => app.games.tick().catch(() => undefined), 1000),
    setInterval(() => app.games.sealStale().catch(() => undefined), 5000),
  ];
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let peakRss = 0;
  const memory = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 500);

  const stats = { latencies: [], commands: 0, gamesOver: 0, rejected: {}, errors: {} };
  let done = 0;
  const allDone = new Promise((resolve) => {
    const players = Array.from({ length: PLAYERS }, (_, index) => new Player({ base, index, stats, onDone: () => (done += 1) === PLAYERS && resolve(players) }));
    (async () => {
      const setupStarted = performance.now();
      for (const player of players) {
        wallets.setAccount(player.account, [player.keys.publicKey]);
      }
      await Promise.all(players.map((player) => player.signIn()));
      stats.signInMs = Math.round(performance.now() - setupStarted);
      stats.playStarted = performance.now();
      await Promise.all(players.map((player) => player.connect()));
      const attacker = new Player({ base, index: PLAYERS + 1, stats: { latencies: [] }, onDone: () => undefined });
      wallets.setAccount(attacker.account, [attacker.keys.publicKey]);
      await attacker.signIn();
      stats.flood = await flood(base, attacker.cookie);
    })().catch((error) => {
      process.stderr.write(`setup failed: ${error.message}\n`);
      process.exit(1);
    });
  });
  const players = /** @type {Player[]} */ (await allDone);
  const playMs = performance.now() - stats.playStarted;
  loop.disable();
  jobs.forEach(clearInterval);
  // Drain: how many blocks one broadcaster account needs to publish everything (one operation per block).
  await app.games.sealStale();
  let drainBlocks = 0;
  while ((await database.rows("SELECT 1 FROM blockchain_events WHERE status IN ('BUILT', 'BROADCAST') LIMIT 1")).length > 0 && drainBlocks < 2000) {
    ledger.time += 3000;
    await app.chain.broadcaster.runOnce();
    ledger.produceBlock();
    ledger.finalize();
    await app.chain.tracker.runOnce();
    drainBlocks += 1;
  }
  const records = Object.fromEntries((await database.rows("SELECT status, count(*)::integer AS n FROM blockchain_events GROUP BY status")).map((row) => [row.status, row.n]));
  const report = {
    players: PLAYERS,
    games: stats.gamesOver,
    signInSeconds: stats.signInMs / 1000,
    playSeconds: Math.round(playMs / 100) / 10,
    commands: stats.commands,
    commandsPerSecond: Math.round((stats.commands / playMs) * 10000) / 10,
    ackLatencyMs: { p50: percentile(stats.latencies, 0.5), p95: percentile(stats.latencies, 0.95), p99: percentile(stats.latencies, 0.99), max: percentile(stats.latencies, 1) },
    rejectedCommands: stats.rejected,
    errors: stats.errors,
    eventLoopDelayMs: { p50: Math.round(loop.percentile(50) / 1e5) / 10, p99: Math.round(loop.percentile(99) / 1e5) / 10, max: Math.round(loop.max / 1e5) / 10 },
    peakRssMb: Math.round(peakRss / 1048576),
    chain: { records, blocksToDrainAfterPlay: drainBlocks, drainMinutesAtOneOpPerBlock: Math.round((drainBlocks * 3) / 6) / 10 },
    flood: stats.flood,
    serverErrors: logger.entries.filter((entry) => entry.level === "error").map((entry) => entry.message).slice(0, 5),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  players.forEach((player) => player.close());
  clearInterval(memory);
  app.realtime.close();
  server.close();
  process.exit(0);
}

await main();
