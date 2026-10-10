/**
 * Practice games against the AI: played in the browser, sent once over with
 * their seed and moves, played again by the server and counted only when
 * they end the same way. They open ranked play like casual games do.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BasicAi } from "@magic8/engine/domain/ai/BasicAi.js";
import { concede } from "@magic8/engine/domain/commands/commandFactories.js";
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { GameEngine } from "@magic8/engine/domain/game/GameEngine.js";
import { uuidV4 } from "../../src/kernel/random.js";
import { buildTestApp, bundledContent, deterministicRandom, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const seedOf = (label) => label.repeat(64 / label.length);

async function world() {
  const bundled = await bundledContent();
  const ranked = structuredClone(bundled.ranked);
  Object.assign(ranked.eligibility, { minFinishedCasualGames: 3, minFinishedPracticeGames: 3 });
  const setup = await buildTestApp({ content: { ...bundled, ranked } });
  const player = async (account) => (await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)))).id;
  return { setup, player, content: setup.app.catalog.current().content };
}

/**
 * A practice game as the browser sends it: the player's seat and the AI's,
 * each with a preconstructed deck, played to the end by the AI for both.
 * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content
 * @param {string} seed
 */
function practiceGame(content, seed) {
  const [mine, theirs] = content.preconDecks;
  const seats = [
    { id: "player", deckList: mine },
    { id: "ai", deckList: theirs },
  ];
  const engine = GameEngine.create({ rules: content.gameRules, catalog: content.catalog, effects: createCoreEffectRegistry(), commands: createCoreCommandRegistry(), players: seats.map((seat) => ({ ...seat, name: seat.id })), seed }).value;
  engine.start();
  const ai = new BasicAi();
  const moves = [];
  while (!engine.isOver) {
    const move = ai.decide(engine.getSnapshot(engine.getSnapshot(null).awaitingPlayerId));
    assert.equal(engine.execute(move).ok, true);
    moves.push(move);
  }
  const players = seats.map((seat) => ({ id: seat.id, deck: seat.deckList.entries.map(({ cardId, count }) => ({ cardId, count })) }));
  return { seed, you: "player", players, moves: JSON.parse(JSON.stringify(moves)) };
}

describe("practice games", () => {
  it("counts a game the server plays again to the same end, once, and opens ranked play after enough of them", async () => {
    const { setup, content } = await world();
    const keys = keyPair(7);
    setup.chain.setAccount("alice", [keys.publicKey]);
    const server = await listen(setup.app);
    try {
      const anonymous = await new ApiClient(server.base).post("/api/practice/games", practiceGame(content, seedOf("a1")));
      assert.equal(anonymous.status, 401, "only a signed-in player's games count");

      const client = new ApiClient(server.base);
      await client.signIn("alice", keys.privateKey);
      const before = (await client.get("/api/ranking/me")).json;
      assert.deepEqual([before.eligible, before.casualGamesNeeded, before.practiceGamesNeeded], [false, 3, 3]);

      const games = ["a1", "b2", "c3"].map((label) => practiceGame(content, seedOf(label)));
      for (const [index, game] of games.entries()) {
        const sent = await client.post("/api/practice/games", game);
        assert.equal(sent.status, 200, sent.text);
        assert.deepEqual(sent.json, { counted: true, practiceGames: index + 1 });
        if (index === 0) {
          const after = (await client.get("/api/ranking/me")).json;
          assert.deepEqual([after.eligible, after.casualGamesNeeded, after.practiceGamesNeeded], [false, 3, 2], "one fewer to go");
        }
      }
      const again = await client.post("/api/practice/games", games[0]);
      assert.deepEqual(again.json, { counted: false, practiceGames: 3 }, "the same game counts once");

      const standing = (await client.get("/api/ranking/me")).json;
      assert.deepEqual([standing.eligible, standing.casualGamesNeeded, standing.practiceGamesNeeded], [true, 0, 0], "three practice games open ranked play");
      const [row] = await setup.database.rows("SELECT result, end_reason, moves FROM practice_games ORDER BY recorded_at LIMIT 1");
      assert.ok(["win", "loss", "draw"].includes(row.result));
      assert.equal(row.moves, games[0].moves.length);
    } finally {
      await server.close();
    }
  });

  it("lets a player with enough practice games queue ranked, and tells one without what is missing", async () => {
    const { setup, player, content } = await world();
    const alice = await player("alice");
    await assert.rejects(setup.app.ranking.assertEligible(alice), /finish 3 more casual game\(s\), or 3 more practice game\(s\) against the AI/);
    for (const label of ["a1", "b2", "c3"]) {
      await setup.app.practice.report(alice, practiceGame(content, seedOf(label)));
    }
    await setup.app.ranking.assertEligible(alice);
  });

  it("refuses a game that does not play again to its end, one the player conceded, and one counted for someone else", async () => {
    const { setup, player, content } = await world();
    const alice = await player("alice");
    const bob = await player("bob");
    const game = practiceGame(content, seedOf("d4"));
    const refused = (body, pattern) => assert.rejects(setup.app.practice.report(alice, body), pattern);

    await refused({ ...game, moves: game.moves.slice(0, -1) }, /not over/);
    await refused({ ...game, moves: [...game.moves.slice(0, 3), ...game.moves.slice(4)] }, /does not replay/);
    await refused({ ...game, seed: seedOf("e5") }, /does not replay|not over/);
    await refused({ ...game, moves: [...game.moves, game.moves.at(-1)] }, /does not replay/);
    await refused({ ...game, moves: [concede("player")] }, /conceded/);
    await refused({ ...game, seed: "12345" }, /invalid seed/);
    await refused({ ...game, you: "someone" }, /invalid seat/);
    await refused({ ...game, players: [game.players[0], { ...game.players[1], deck: [{ cardId: game.players[1].deck[0].cardId, count: 9 }] }] }, /not legal/);
    await refused({ ...game, moves: [] }, /invalid moves/);
    assert.equal(await setup.app.practice.countOf(alice), 0);

    // The AI giving up is a game the player won.
    const conceded = await setup.app.practice.report(alice, { ...game, seed: seedOf("f6"), moves: [concede("ai")] });
    assert.deepEqual(conceded, { counted: true, practiceGames: 1 });

    assert.deepEqual(await setup.app.practice.report(alice, game), { counted: true, practiceGames: 2 });
    assert.deepEqual(await setup.app.practice.report(bob, game), { counted: false, practiceGames: 0 }, "a game counts for one player only");
  });

  it("reads a whole game's report, larger than other requests may be, and no larger", async () => {
    const { setup } = await world();
    const keys = keyPair(7);
    setup.chain.setAccount("alice", [keys.publicKey]);
    const server = await listen(setup.app);
    try {
      const client = new ApiClient(server.base);
      await client.signIn("alice", keys.privateKey);
      const large = await client.post("/api/practice/games", { seed: "bad", padding: "x".repeat(64 * 1024) });
      assert.equal(large.status, 400, "read, then refused for what it says");
      const huge = await client.post("/api/practice/games", { seed: "bad", padding: "x".repeat(512 * 1024) });
      assert.equal(huge.status, 413);
    } finally {
      await server.close();
    }
  });
});
