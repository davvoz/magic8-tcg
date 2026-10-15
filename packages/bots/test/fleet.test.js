/**
 * The fleet's errand (BotFleet): a player searching alone gets one bot sent
 * into the queue, casual first then ranked; bots are never helped, one bot
 * searches at a time, and the same player is not helped again at once.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryLogger } from "@magic8/client/src/infrastructure/logging/MemoryLogger.js";
import { BotFleet } from "../src/BotFleet.js";

/** A bot whose lobby and queue the test sets. */
class FakeBot {
  available = true;
  started = false;
  /** @type {string[]} */
  searches = [];
  /** @type {readonly { account: string, status: string }[]} */
  players = [];
  /** How each queue answers: matched, or refused with a code. @type {Record<string, { matched: boolean, code: string | null }>} */
  answers = { casual: { matched: false, code: null }, ranked: { matched: false, code: null } };

  /** @param {string} account */
  constructor(account) {
    this.account = account;
  }

  start() {
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  async onlinePlayers() {
    return this.players;
  }

  /** @param {"casual" | "ranked"} mode */
  async search(mode) {
    this.searches.push(mode);
    return this.answers[mode];
  }
}

const noTimers = Object.freeze({ setTimeout: () => null, clearTimeout: () => undefined });

describe("bot fleet", () => {
  const fleetOf = (/** @type {FakeBot[]} */ bots, now = { at: 0 }) => {
    const fleet = new BotFleet({ bots, timers: noTimers, now: () => now.at, random: () => 0, logger: new MemoryLogger(), policy: { waitBeforeHelpMs: 10_000, helpAgainMs: 60_000 } });
    fleet.start();
    return fleet;
  };

  it("sends a bot into the casual queue, then the ranked one, for a player who has searched long enough", async () => {
    const now = { at: 0 };
    const [first, second] = [new FakeBot("bot1"), new FakeBot("bot2")];
    first.players = [{ account: "alice", status: "searching" }, { account: "bot2", status: "idle" }];
    const fleet = fleetOf([first, second], now);
    await fleet.scan();
    assert.equal(fleet.helping, null, "not yet: alice has only just started searching");
    now.at = 10_000;
    await fleet.scan();
    await fleet.helping;
    assert.deepEqual(first.searches, ["casual", "ranked"], "the free queue first, then ranked");
    assert.deepEqual(second.searches, []);

    now.at = 20_000;
    await fleet.scan();
    assert.equal(fleet.helping, null, "the same player is not helped again at once");
    now.at = 80_000;
    await fleet.scan();
    await fleet.helping;
    assert.deepEqual(first.searches, ["casual", "ranked", "casual", "ranked"], "a while later, if still alone, they are");
  });

  it("stops once paired, and never helps a bot", async () => {
    const now = { at: 0 };
    const bot = new FakeBot("bot1");
    bot.answers.casual = { matched: true, code: null };
    bot.players = [{ account: "bot2", status: "searching" }, { account: "bob", status: "searching" }];
    const fleet = fleetOf([bot, new FakeBot("bot2")], now);
    await fleet.scan();
    now.at = 10_000;
    await fleet.scan();
    await fleet.helping;
    assert.deepEqual(bot.searches, ["casual"], "paired with bob in the casual queue: no ranked search");
    now.at = 100_000;
    bot.players = [{ account: "bot2", status: "searching" }];
    await fleet.scan();
    await fleet.scan();
    assert.equal(fleet.helping, null, "a bot searching is nobody to help");
  });

  it("sends nobody when no bot is free, and forgets a player who stopped searching", async () => {
    const now = { at: 0 };
    const bot = new FakeBot("bot1");
    bot.players = [{ account: "alice", status: "searching" }];
    bot.available = false;
    const fleet = fleetOf([bot], now);
    await fleet.scan();
    now.at = 10_000;
    await fleet.scan();
    assert.deepEqual(bot.searches, [], "the only bot is busy");
    bot.players = [{ account: "alice", status: "playing" }];
    await fleet.scan();
    bot.available = true;
    bot.players = [{ account: "alice", status: "searching" }];
    now.at = 15_000;
    await fleet.scan();
    assert.equal(fleet.helping, null, "alice searches again: her wait starts over");
  });
});
