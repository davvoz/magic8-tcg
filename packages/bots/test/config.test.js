/**
 * The house players' configuration (config.js): the keys, the styles, the
 * think time, and what is refused at start-up.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { publicKeyOf } from "@magic8/steem";
import { toWif } from "../../server/test/helpers.js";
import { BotConfigError, loadBotConfig, parseBotKeys } from "../src/config.js";

const key = (byte) => new Uint8Array(32).fill(byte);

describe("bot configuration", () => {
  it("reads account:WIF[:style] entries; bots without a style get one each in turn", () => {
    const bots = parseBotKeys(` alice:${toWif(key(1))}, bob:${toWif(key(2))}:defensive ,carol:${toWif(key(3))} `);
    assert.deepEqual(bots.map((bot) => [bot.account, bot.style]), [["alice", "balanced"], ["bob", "defensive"], ["carol", "defensive"]]);
    assert.equal(publicKeyOf(bots[1].postingKey), publicKeyOf(key(2)), "the posting key is decoded from its WIF");
  });

  it("refuses a bad name, key, style or a repeated account, naming the variable", () => {
    for (const value of [`Alice:${toWif(key(1))}`, "alice:notakey", `alice:${toWif(key(1))}:reckless`, `alice:${toWif(key(1))},alice:${toWif(key(2))}`, `alice:${toWif(key(1))}:balanced:extra`]) {
      assert.throws(() => parseBotKeys(value), (error) => error instanceof BotConfigError && error.message.startsWith("M8_BOT_KEYS"), value);
    }
  });

  it("no bot is a valid configuration; the origin defaults to the public one", () => {
    const config = loadBotConfig({ M8_BOT_SERVER: "http://app:8080", M8_PUBLIC_ORIGIN: "https://play.example.com" });
    assert.deepEqual(config.bots, []);
    assert.equal(config.server, "http://app:8080");
    assert.equal(config.origin, "https://play.example.com");
    assert.deepEqual(config.thinkMs, { min: 1200, max: 3200 });
  });

  it("reads the think time and refuses a bad one or a bad URL", () => {
    assert.deepEqual(loadBotConfig({ M8_BOT_THINK_MS: "500-900" }).thinkMs, { min: 500, max: 900 });
    for (const env of [{ M8_BOT_THINK_MS: "900-500" }, { M8_BOT_THINK_MS: "fast" }, { M8_BOT_SERVER: "app:8080/x" }, { M8_BOT_ORIGIN: "https://play.example.com/path" }]) {
      assert.throws(() => loadBotConfig(env), BotConfigError, JSON.stringify(env));
    }
  });
});
