/**
 * A player's game history: the finished games they played, newest first,
 * a page at a time, with who they faced and how it went for them; public
 * over HTTP, by account.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { buildTestApp, deterministicRandom, listen } from "../helpers.js";

const ENTROPY = Object.freeze({ s0: "0a".repeat(16), s1: "0b".repeat(16) });
const SECOND = 1000;

async function world() {
  const setup = await buildTestApp();
  const content = setup.app.catalog.current().content;
  const games = setup.app.games;
  const person = async (account) => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    return { id: user.id, account, entrant: { userId: user.id, account, deckId: null, deck: content.preconDecks[0].entries } };
  };
  /** A started game the loser concedes. */
  const play = async (first, second, loser) => {
    setup.clock.advance(SECOND);
    const gameId = await games.createGame({ entrants: [first.entrant, second.entrant] });
    await games.entropy(first.id, gameId, ENTROPY.s0);
    await games.entropy(second.id, gameId, ENTROPY.s1);
    assert.equal((await games.concede(loser.id, { gameId, commandId: uuidV4(deterministicRandom(`concede:${gameId}`)) })).ok, true);
    return gameId;
  };
  return { setup, games, person, play, alice: await person("alice"), bob: await person("bob"), carol: await person("carol") };
}

describe("game history", () => {
  it("lists the games a player finished, newest first, as they went for that player", async () => {
    const w = await world();
    const first = await w.play(w.alice, w.bob, w.bob);
    const second = await w.play(w.carol, w.alice, w.alice);
    w.setup.clock.advance(SECOND);
    await w.games.createGame({ entrants: [w.alice.entrant, w.carol.entrant] });

    const alice = await w.games.history({ account: "alice" });
    assert.equal(alice.next, null);
    assert.deepEqual(
      alice.games.map((game) => [game.gameId, game.opponent, game.result, game.endReason]),
      [
        [second, "carol", "loss", "concede"],
        [first, "bob", "win", "concede"],
      ],
      "a game not over yet is not listed",
    );
    assert.deepEqual(Object.keys(alice.games[0]).sort(), ["endReason", "finishedAt", "gameId", "mode", "opponent", "result", "startedAt", "turn"]);
    assert.equal(alice.games[0].mode, "casual");
    assert.ok(alice.games[0].finishedAt >= alice.games[0].startedAt);
    assert.deepEqual((await w.games.history({ account: "bob" })).games.map((game) => [game.opponent, game.result]), [["alice", "loss"]]);
    assert.deepEqual((await w.games.history({ account: "nobody" })).games, []);
  });

  it("pages through a long history", async () => {
    const w = await world();
    const played = [];
    for (let index = 0; index < 5; index += 1) {
      played.push(await w.play(w.alice, w.bob, index % 2 === 0 ? w.bob : w.alice));
    }
    const newest = [...played].reverse();
    const page = await w.games.history({ account: "alice", limit: 2 });
    assert.deepEqual(page.games.map((game) => game.gameId), newest.slice(0, 2));
    assert.equal(page.next, newest[1]);
    const next = await w.games.history({ account: "alice", before: page.next, limit: 2 });
    assert.deepEqual(next.games.map((game) => game.gameId), newest.slice(2, 4));
    const last = await w.games.history({ account: "alice", before: next.next, limit: 2 });
    assert.deepEqual([last.games.map((game) => game.gameId), last.next], [newest.slice(4), null]);
  });

  it("is public over HTTP, by account", async () => {
    const w = await world();
    const gameId = await w.play(w.alice, w.bob, w.alice);
    const server = await listen(w.setup.app);
    try {
      const response = await fetch(`${server.base}/api/games/history?account=bob`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual([body.account, body.next, body.games.map((game) => [game.gameId, game.opponent, game.result])], ["bob", null, [[gameId, "alice", "win"]]]);
      assert.equal((await fetch(`${server.base}/api/games/history`)).status, 400, "an account is needed");
      assert.equal((await fetch(`${server.base}/api/games/history?account=Not%20One`)).status, 400);
      assert.equal((await fetch(`${server.base}/api/games/history?account=bob&before=nope`)).status, 400);
    } finally {
      await server.close();
    }
  });
});
