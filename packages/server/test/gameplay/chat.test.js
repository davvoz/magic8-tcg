/**
 * Chat at the table (docs/tcg/28-chat.md) on the real services: a line,
 * a player's or a spectator's, reaches both players and the spectators; who may chat, what a line is cleaned to, how fast one may
 * type, the history a new spectator gets, and the players' last word once
 * the game is over.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { ChatThrottle, MAX_CHAT_LENGTH, cleanChatLine } from "../../src/modules/gameplay/domain/chat.js";
import { buildTestApp, deterministicRandom } from "../helpers.js";

const ENTROPY = Object.freeze({ s0: "0a".repeat(16), s1: "0b".repeat(16) });

/** Two players in a game waiting for their entropy, and people to watch it, each with an inbox. */
async function world() {
  const setup = await buildTestApp();
  const content = setup.app.catalog.current().content;
  const games = setup.app.games;
  const person = async (account) => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    const inbox = [];
    setup.app.hub.attach(user.id, { send: (message) => inbox.push(JSON.parse(message)), close: () => undefined });
    return { id: user.id, account, inbox, speaker: { userId: user.id, account }, entrant: { userId: user.id, account, deckId: null, deck: content.preconDecks[0].entries } };
  };
  const alice = await person("alice");
  const bob = await person("bob");
  const gameId = await games.createGame({ entrants: [alice.entrant, bob.entrant] });
  return { setup, games, person, alice, bob, gameId };
}

/** @param {{ games: any, alice: any, bob: any, gameId: string }} w */
async function start(w) {
  await w.games.entropy(w.alice.id, w.gameId, ENTROPY.s0);
  await w.games.entropy(w.bob.id, w.gameId, ENTROPY.s1);
}

const said = (inbox, type) => inbox.filter((message) => message.t === type).map((message) => message.d);

describe("chat at the table", () => {
  it("brings every line, a player's or a spectator's, to both players and the spectators", async () => {
    const w = await world();
    await start(w);
    const carol = await w.person("carol");
    const dave = await w.person("dave");
    await w.games.watch(carol.id, w.gameId);
    await w.games.watch(dave.id, w.gameId);

    const sent = await w.games.chat(w.alice.speaker, w.gameId, "  good   luck!  ");
    assert.equal(sent.ok, true);
    const line = { gameId: w.gameId, from: "player", seat: "s0", account: "alice", text: "good luck!", at: w.setup.clock.now() };
    assert.deepEqual(said(w.alice.inbox, "game.chat"), [line], "the speaker hears their own line, as the server kept it");
    assert.deepEqual(said(w.bob.inbox, "game.chat"), [line]);
    assert.deepEqual(said(carol.inbox, "watch.chat"), [line]);

    assert.equal((await w.games.chat(carol.speaker, w.gameId, "what a start")).ok, true);
    const comment = said(dave.inbox, "watch.chat").at(-1);
    assert.deepEqual({ ...comment, at: undefined }, { gameId: w.gameId, from: "spectator", seat: null, account: "carol", text: "what a start", at: undefined });
    assert.equal(said(carol.inbox, "watch.chat").length, 2);
    assert.deepEqual(said(w.alice.inbox, "game.chat").at(-1), comment, "the players read the stands");
    assert.deepEqual(said(w.bob.inbox, "game.chat").at(-1), comment);
    assert.equal(said(w.alice.inbox, "watch.chat").length, 0, "as players, on their own channel");
  });

  it("gives whoever starts watching the latest lines", async () => {
    const w = await world();
    await start(w);
    const carol = await w.person("carol");
    await w.games.chat(w.bob.speaker, w.gameId, "hi");
    await w.games.watch(carol.id, w.gameId);
    await w.games.chat(carol.speaker, w.gameId, "hello both");
    const erin = await w.person("erin");
    const watched = await w.games.watch(erin.id, w.gameId);
    assert.deepEqual(watched.view.chat.map((line) => [line.account, line.text]), [["bob", "hi"], ["carol", "hello both"]]);
  });

  it("lets only the players and the spectators chat, once the game has started", async () => {
    const w = await world();
    assert.equal((await w.games.chat(w.alice.speaker, w.gameId, "ready?")).error.code, "GAME_NOT_ACTIVE");
    await start(w);
    const stranger = await w.person("stranger");
    assert.equal((await w.games.chat(stranger.speaker, w.gameId, "hey")).error.code, "NOT_IN_GAME", "watch the game to comment on it");
    assert.equal((await w.games.chat(w.alice.speaker, "0".repeat(26), "hey")).error.code, "NOT_IN_GAME");
    assert.equal((await w.games.chat(w.alice.speaker, w.gameId, " \u0007‮ ")).error.code, "INVALID_CHAT");
    assert.equal(said(stranger.inbox, "watch.chat").length + said(w.bob.inbox, "game.chat").length, 0);
  });

  it("holds back someone typing too fast, then lets them speak again", async () => {
    const w = await world();
    await start(w);
    for (let line = 0; line < 4; line += 1) {
      assert.equal((await w.games.chat(w.alice.speaker, w.gameId, `line ${line}`)).ok, true);
    }
    assert.equal((await w.games.chat(w.alice.speaker, w.gameId, "one more")).error.code, "CHAT_TOO_FAST");
    assert.equal((await w.games.chat(w.bob.speaker, w.gameId, "my turn")).ok, true, "each person has their own allowance");
    w.setup.clock.advance(2000);
    assert.equal((await w.games.chat(w.alice.speaker, w.gameId, "one more")).ok, true);
  });

  it("lets the players say good game for a minute after the end", async () => {
    const w = await world();
    await start(w);
    assert.equal((await w.games.concede(w.bob.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom("concede")) })).ok, true);
    await w.games.tick();
    assert.equal((await w.games.chat(w.bob.speaker, w.gameId, "gg")).ok, true);
    assert.equal(said(w.alice.inbox, "game.chat").at(-1).text, "gg");
    assert.equal(await w.games.activeGameOf(w.alice.id), null, "the finished game is no one's game in play");
    w.setup.clock.advance(60_000);
    await w.games.tick();
    assert.equal((await w.games.chat(w.alice.speaker, w.gameId, "gg")).error.code, "NOT_IN_GAME");
  });
});

describe("a chat line", () => {
  it("is plain text on one line, cut to its length", () => {
    assert.equal(cleanChatLine("well\nplayed\t !"), "well played !");
    assert.equal(cleanChatLine("‮gg​"), "gg", "no direction overrides nor invisible characters");
    assert.equal(cleanChatLine("👨‍👩‍👧 nice"), "👨‍👩‍👧 nice", "an emoji keeps its joiners");
    assert.equal(cleanChatLine("é".repeat(MAX_CHAT_LENGTH + 10)), "é".repeat(MAX_CHAT_LENGTH));
    assert.equal(cleanChatLine("   "), null);
    assert.equal(cleanChatLine(42), null);
  });

  it("goes in a burst of four, then one every two seconds", () => {
    const throttle = new ChatThrottle();
    const sent = Array.from({ length: 5 }, () => throttle.take("u", 0));
    assert.deepEqual(sent, [true, true, true, true, false]);
    assert.equal(throttle.take("u", 1000), false);
    assert.equal(throttle.take("u", 2000), true);
    assert.equal(throttle.take("someone else", 2000), true);
  });
});
