/**
 * House players end to end (docs/tcg/25-bot.md): a real server, a real bot
 * (its own sign-in, WebSocket, session keys and AI) and a real player's
 * client stack with a Keychain the test answers. The player challenges the
 * bot, which accepts, signs the game and plays it to the end; a player
 * searching alone gets a bot in the queue; someone opening the bot's account
 * in a browser makes it step aside, and it comes back.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { clearInterval, setInterval } from "node:timers";

import { WebSocket } from "ws";
import { concede } from "@magic8/engine/domain/commands/commandFactories.js";
import { MemoryLogger } from "@magic8/client/src/infrastructure/logging/MemoryLogger.js";
import { onlineWorld, until } from "../../server/test/e2e/onlineHarness.js";
import { ORIGIN, keyPair } from "../../server/test/helpers.js";
import { ApiClient } from "../../server/test/support/apiClient.js";
import { Bot } from "../src/Bot.js";
import { BotFleet } from "../src/BotFleet.js";
import { BotHttp } from "../src/BotHttp.js";
import { BotPlayer } from "../src/BotPlayer.js";

const timers = Object.freeze({ setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => setTimeout(fn, ms), clearTimeout: (/** @type {any} */ handle) => clearTimeout(handle) });
const delay = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms)).then(() => undefined);
/** A bot that answers in a few milliseconds instead of a few seconds. */
const QUICK = Object.freeze({ answerMs: { min: 1, max: 5 }, signMs: { min: 1, max: 5 }, openingMs: 0, leaveMs: { min: 5, max: 10 }, replacedPauseMs: 50, retryMs: [20, 50] });

describe("house players (real bot, real client, real server)", () => {
  /** @type {Array<() => Promise<void>>} */
  const cleanups = [];
  after(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup();
    }
  });

  /**
   * A world with one bot account on the chain (no deck yet: it claims the starter).
   * @param {string} account
   */
  const worldWithBot = async (account) => {
    const world = await onlineWorld();
    cleanups.push(() => world.close());
    const keys = keyPair(90);
    world.setup.chain.setAccount(account, [keys.publicKey]);
    const logger = new MemoryLogger();
    const bot = new Bot({
      account,
      postingKey: keys.privateKey,
      style: "aggressive",
      starterIndex: 2,
      http: new BotHttp({ server: world.server.base, origin: ORIGIN }),
      openSocket: ({ cookie, origin }) => {
        world.setup.clock.advance(2000); // the gateway allows one upgrade per 2 s per address
        return /** @type {any} */ (new WebSocket(`${world.server.base.replace("http", "ws")}/ws`, { headers: { Cookie: cookie, Origin: origin } }));
      },
      timers,
      delay,
      random: Math.random,
      now: Date.now,
      crypto: globalThis.crypto,
      thinkMs: { min: 0, max: 2 },
      logger,
      policy: QUICK,
    });
    cleanups.push(() => bot.stop());
    return { world, bot, keys, logger };
  };

  /**
   * The server's clock runs while the game is played: each socket's message
   * budget refills with it (the server's turn timers only act on `tick`).
   * @param {Awaited<ReturnType<typeof onlineWorld>>} world
   */
  const runClock = (world) => {
    const ticking = setInterval(() => world.setup.clock.advance(250), 20);
    cleanups.push(async () => clearInterval(ticking));
    return () => clearInterval(ticking);
  };

  /** The bot's log, without the routine lines. @param {MemoryLogger} logger */
  const troubles = (logger) => logger.entries.filter((entry) => entry.level !== "info");

  it("accepts a challenge, signs the game and plays it to the end, then is back in the lobby", async () => {
    const { world, bot, logger } = await worldWithBot("housebot");
    bot.start();
    await until(() => bot.available, "the bot is online");
    const grants = await world.setup.database.rows("SELECT g.kind FROM grants g JOIN users u ON u.id = g.user_id WHERE u.account = $1", ["housebot"]);
    assert.deepEqual(grants.map((row) => row.kind), ["starter"], "a new bot account claims its free starter deck");

    const alice = await world.player("alice");
    await alice.lobby.refresh();
    assert.deepEqual(alice.lobby.state.players, [{ account: "housebot", status: "idle" }], "the bot is listed like anyone online");
    const challenged = await alice.lobby.challenge("housebot", "casual", alice.deckId);
    assert.equal(challenged.ok, true);
    await until(() => alice.keychain.open.length === 1, "the bot accepted: alice is asked to sign the game");
    alice.keychain.approve();
    await until(() => alice.online.state.status === "playing", "both signed: the game starts");
    assert.equal(alice.online.state.opponent, "housebot");

    // Alice's side plays with the same AI, at once.
    const stopClock = runClock(world);
    const aliceAi = new BotPlayer({ style: "balanced", think: () => 0, delay, logger: alice.logger });
    aliceAi.follow(alice.online.state.session);
    cleanups.push(async () => aliceAi.stop());
    await until(() => alice.online.state.status === "over", "the game is played to the end", 120_000);
    aliceAi.stop();
    stopClock();
    const gameId = /** @type {string} */ (alice.online.state.session?.gameId);
    const [game] = await world.setup.database.rows("SELECT status FROM games WHERE id = $1", [gameId]);
    assert.equal(game.status, "FINISHED");
    const [botSeat] = await world.setup.database.rows("SELECT seat FROM game_players WHERE game_id = $1 AND account = $2", [gameId, "housebot"]);
    const [moves] = await world.setup.database.rows("SELECT count(*)::int AS n FROM game_events WHERE game_id = $1 AND kind = 'MOVE' AND actor = $2", [gameId, botSeat.seat]);
    assert.ok(moves.n > 0, "the bot's own signed moves are recorded");

    await until(() => bot.available, "the bot goes back to the lobby");
    assert.ok(logger.entries.some((entry) => /housebot: (won|lost|draw) against @alice/.test(entry.message)), "the bot logs the result");
    assert.deepEqual(troubles(logger), []);
    assert.equal(alice.logger.entries.filter((entry) => entry.level === "error").length, 0);
  });

  it("joins the queue for a player searching alone", async () => {
    const { world, bot, logger } = await worldWithBot("queuebot");
    const fleetLogger = new MemoryLogger();
    const fleet = new BotFleet({ bots: [bot], timers, now: Date.now, random: Math.random, logger: fleetLogger, policy: { scanMs: 20, waitBeforeHelpMs: 50, searchMs: 2000 } });
    cleanups.push(() => fleet.stop());
    runClock(world); // the lobby's list is rebuilt every 2 s of server time
    fleet.start();
    await until(() => bot.available, "the bot is online");

    const alice = await world.player("alice");
    const queued = await alice.online.queue(alice.deckId, "casual");
    assert.equal(queued.ok, true);
    await until(() => alice.online.state.status === "matched", "a bot steps into the queue and is paired with alice");
    assert.equal(alice.online.state.opponent, "queuebot");
    await until(() => alice.keychain.open.length === 1, "alice is asked to sign the game");
    alice.keychain.approve();
    await until(() => alice.online.state.status === "playing", "the game starts");

    // Alice resigns (any time; again if the bot's move got in first).
    const session = /** @type {any} */ (alice.online.state.session);
    let resigned = await session.submit(concede(session.seat));
    for (let tries = 0; !resigned.ok && tries < 5; tries += 1) {
      await delay(20);
      resigned = await session.submit(concede(session.seat));
    }
    assert.equal(resigned.ok, true);
    await until(() => bot.available, "the game over, the bot is back in the lobby");
    assert.ok(fleetLogger.entries.some((entry) => entry.message === "@queuebot joined the casual queue for @alice and was paired"));
    assert.deepEqual(troubles(logger), []);
  });

  it("steps aside when its account is opened elsewhere, then comes back", async () => {
    const { world, bot, keys, logger } = await worldWithBot("shybot");
    bot.start();
    await until(() => bot.available, "the bot is online");

    // The owner opens the account in a browser: that connection replaces the bot's.
    const owner = new ApiClient(world.server.base);
    await owner.signIn("shybot", keys.privateKey);
    world.setup.clock.advance(2000);
    const browser = new WebSocket(`${world.server.base.replace("http", "ws")}/ws`, { headers: { Cookie: /** @type {string} */ (owner.cookie), Origin: ORIGIN } });
    cleanups.push(async () => browser.close());
    await until(() => !bot.available, "the bot steps aside");
    assert.ok(logger.entries.some((entry) => entry.level === "warn" && entry.message.includes("opened somewhere else")));
    await until(() => bot.available, "after its pause the bot is online again");
  });
});
