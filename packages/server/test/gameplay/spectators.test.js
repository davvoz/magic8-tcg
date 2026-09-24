/**
 * Spectators on the real services: what they see (the table, never a hand
 * or a drawn card), who may watch, the per-game limit, one game at a time,
 * the end of a watch (stop, disconnect, game over), a rebuilt actor that
 * keeps streaming, and the list of live games.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { MAX_SPECTATORS } from "../../src/modules/gameplay/index.js";
import { buildTestApp, deterministicRandom } from "../helpers.js";

const ENTROPY = Object.freeze({ s0: "0a".repeat(16), s1: "0b".repeat(16) });

/** Players and spectators with inboxes, and a started game between the first two players. */
async function world() {
  const setup = await buildTestApp();
  const content = setup.app.catalog.current().content;
  const games = setup.app.games;
  const person = async (account) => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    const inbox = [];
    setup.app.hub.attach(user.id, { send: (message) => inbox.push(JSON.parse(message)), close: () => undefined });
    return { id: user.id, account, inbox, entrant: { userId: user.id, account, deckId: null, deck: content.preconDecks[0].entries } };
  };
  const startGame = async (first, second) => {
    const gameId = await games.createGame({ entrants: [first.entrant, second.entrant] });
    await games.entropy(first.id, gameId, ENTROPY.s0);
    await games.entropy(second.id, gameId, ENTROPY.s1);
    return gameId;
  };
  const alice = await person("alice");
  const bob = await person("bob");
  const gameId = await startGame(alice, bob);
  return { setup, games, person, startGame, alice, bob, gameId };
}

const ofType = (inbox, type) => inbox.filter((message) => message.t === type).map((message) => message.d);

/** The awaited player ends the turn (or the phase), from their own view. */
async function pass(w, label) {
  const view = await w.games.view(w.alice.id, w.gameId);
  const mover = view.snapshot.awaitingPlayerId === view.seat ? w.alice : w.bob;
  const own = await w.games.view(mover.id, w.gameId);
  const command = own.snapshot.legalMoves.canEndTurn ? { type: "END_TURN" } : { type: "END_PHASE" };
  const ack = await w.games.command(mover.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom(label)), expectedVersion: own.version, command });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  return ack;
}

describe("spectators", () => {
  it("see the table as it changes, but never a hand or a drawn card", async () => {
    const w = await world();
    const carol = await w.person("carol");
    const watched = await w.games.watch(carol.id, w.gameId);
    assert.equal(watched.ok, true);
    assert.deepEqual(watched.view.players.map((player) => player.account), ["alice", "bob"]);
    assert.ok(watched.view.snapshot.players.every((player) => player.hand === null && player.handSize > 0));
    assert.equal(watched.view.snapshot.legalMoves, null);

    let turn = watched.view.snapshot.turnNumber;
    for (let step = 0; turn === watched.view.snapshot.turnNumber && step < 20; step += 1) {
      turn = (await w.games.view(w.alice.id, w.gameId)).snapshot.turnNumber;
      if (turn === watched.view.snapshot.turnNumber) {
        await pass(w, `pass:${step}`);
      }
    }
    const updates = ofType(carol.inbox, "watch.events");
    assert.ok(updates.length > 0);
    const drawn = updates.flatMap((update) => update.events).filter((event) => event.type === "CARD_DRAWN");
    assert.ok(drawn.length > 0, "a new turn draws a card");
    assert.ok(drawn.every((event) => event.definitionId === undefined && typeof event.instanceId === "string"), "which card is never shown");
    const playerSaw = [w.alice, w.bob].flatMap((player) => ofType(player.inbox, "game.events")).flatMap((update) => update.events).filter((event) => event.type === "CARD_DRAWN");
    assert.ok(playerSaw.some((event) => typeof event.definitionId === "string"), "while the player who drew it sees it");
    assert.equal(updates.at(-1).version, (await w.games.view(w.alice.id, w.gameId)).version);
  });

  it("only lets people who do not play watch, up to the limit per game", async () => {
    const w = await world();
    assert.equal((await w.games.watch(w.alice.id, w.gameId)).error.code, "PLAYER_CANNOT_WATCH");
    assert.equal((await w.games.watch("someone", "0".repeat(26))).error.code, "NOT_IN_GAME");
    for (let index = 0; index < MAX_SPECTATORS; index += 1) {
      assert.equal((await w.games.watch(`watcher-${index}`, w.gameId)).ok, true);
    }
    assert.equal((await w.games.watch("watcher-0", w.gameId)).ok, true, "watching again is not a new seat");
    assert.equal((await w.games.watch("one-too-many", w.gameId)).error.code, "SPECTATORS_FULL");
    w.games.unwatch("watcher-1");
    assert.equal((await w.games.watch("one-too-many", w.gameId)).ok, true);
    assert.equal(w.games.liveGames()[0].spectators, MAX_SPECTATORS);
  });

  it("watches one game at a time, and stops on request, on disconnect and at the end", async () => {
    const w = await world();
    const carol = await w.person("carol");
    const dave = await w.person("dave");
    const other = await w.startGame(await w.person("erin"), await w.person("frank"));
    await w.games.watch(carol.id, w.gameId);
    await w.games.watch(dave.id, w.gameId);
    await w.games.watch(carol.id, other);
    assert.deepEqual(w.games.liveGames().map((game) => game.spectators).sort(), [1, 1], "carol moved to the other game");
    await w.games.presence(dave.id, false);
    assert.equal(w.games.liveGames().find((game) => game.gameId === w.gameId).spectators, 0, "a spectator who leaves stops watching");

    await w.games.watch(dave.id, w.gameId);
    await pass(w, "one");
    const before = ofType(carol.inbox, "watch.events").length;
    assert.ok(ofType(dave.inbox, "watch.events").length > 0);
    assert.equal(ofType(carol.inbox, "watch.events").filter((update) => update.gameId === w.gameId).length, 0, "nothing from a game no longer watched");
    w.games.unwatch(dave.id);
    const streamed = ofType(dave.inbox, "watch.events").length;
    await pass(w, "two");
    assert.equal(ofType(dave.inbox, "watch.events").length, streamed);
    assert.equal(ofType(carol.inbox, "watch.events").length, before);

    await w.games.watch(dave.id, w.gameId);
    assert.equal((await w.games.concede(w.bob.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom("concede")) })).ok, true);
    assert.equal(ofType(dave.inbox, "watch.over").at(-1).gameId, w.gameId);
    assert.equal((await w.games.watch(dave.id, w.gameId)).error.code, "GAME_NOT_ACTIVE");
    await w.games.tick();
    assert.deepEqual(w.games.liveGames().map((game) => game.gameId), [other], "a finished game leaves the list");
  });

  it("keeps streaming after the game's actor is rebuilt", async () => {
    const w = await world();
    const carol = await w.person("carol");
    await w.games.watch(carol.id, w.gameId);
    const repository = /** @type {any} */ (w.setup.app).gameRepository;
    const append = repository.appendEvents.bind(repository);
    repository.appendEvents = async () => {
      throw new Error("disk full");
    };
    await assert.rejects(pass(w, "fails"), /disk full/);
    repository.appendEvents = append;
    const ack = await pass(w, "retry");
    assert.equal(ofType(carol.inbox, "watch.events").at(-1).version, ack.version);
  });

  it("lists live games, the most watched first", async () => {
    const w = await world();
    const quiet = w.gameId;
    const busy = await w.startGame(await w.person("erin"), await w.person("frank"));
    await w.games.createGame({ entrants: [(await w.person("gina")).entrant, (await w.person("hal")).entrant] });
    await w.games.watch("fan", busy);
    const live = w.games.liveGames();
    assert.deepEqual(live.map((game) => [game.gameId, game.spectators]), [[busy, 1], [quiet, 0]], "a game waiting for entropy is not listed yet");
    assert.deepEqual(Object.keys(live[0]).sort(), ["gameId", "mode", "players", "spectators", "startedAt", "status", "turn"]);
  });
});
