/**
 * The opening coin toss: the CoinToss value, the practice match it seats
 * (MatchSetupService with a coin seed, MatchSession waiting for `begin()`),
 * and the online game that tells the server's choice as a toss
 * (RemoteMatchSession, the same coin for both players).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChaChaRandom } from "@magic8/engine/domain/random/ChaChaRandom.js";
import { endTurn } from "@magic8/engine/domain/commands/commandFactories.js";
import { GameEventType } from "@magic8/engine/domain/game/GameEventType.js";
import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { CoinFace, CoinToss } from "../../src/application/match/CoinToss.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSetupError, MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { textSeed } from "../../src/application/match/textSeed.js";
import { RemoteMatchSession } from "../../src/application/online/RemoteMatchSession.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { createSeed } from "../../src/infrastructure/random/seedProvider.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { effects, loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();
const [ember, iron] = content.preconDecks;

/** A RandomSource double that answers the given draws in order. */
const drawing = (...values) => ({ nextInt: () => /** @type {number} */ (values.shift()) });

/** @param {{ coinSeed?: string | number, seed?: string | number }} [options] */
function practiceMatch({ coinSeed, seed = 42 } = {}) {
  const service = new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger: new MemoryLogger() });
  return service.createMatch({
    seats: [
      { id: "player", name: "You", deckList: ember, controller: humanController },
      { id: "ai", name: "Opponent", deckList: iron, controller: new BasicAiController() },
    ],
    seed,
    coinSeed,
  });
}

/** The first integer coin seed whose toss makes `playerId` go first. */
function coinSeedWinningFor(playerId) {
  for (let coinSeed = 1; coinSeed < 100; coinSeed += 1) {
    const created = practiceMatch({ coinSeed });
    if (created.ok && created.value.openingToss?.firstPlayerId === playerId) {
      return coinSeed;
    }
  }
  return assert.fail(`no coin seed below 100 lets ${playerId} go first`);
}

describe("CoinToss", () => {
  it("gives each player a face and hands the first turn to whoever holds the face that landed", () => {
    const toss = new CoinToss({ calls: { alice: CoinFace.TAILS, bob: CoinFace.HEADS }, landed: CoinFace.HEADS });
    assert.deepEqual(toss.playerIds, ["alice", "bob"]);
    assert.equal(toss.faceOf("alice"), CoinFace.TAILS);
    assert.equal(toss.faceOf("bob"), CoinFace.HEADS);
    assert.equal(toss.faceOf("carol"), null, "a stranger holds no face");
    assert.equal(toss.landed, CoinFace.HEADS);
    assert.equal(toss.firstPlayerId, "bob");
    assert.ok(Object.isFrozen(toss));
  });

  it("refuses tosses that cannot be told: one face each, two players, a real landing", () => {
    assert.throws(() => new CoinToss({ calls: { alice: CoinFace.HEADS, bob: CoinFace.HEADS }, landed: CoinFace.HEADS }), /heads and the other tails/);
    assert.throws(() => new CoinToss({ calls: { alice: CoinFace.HEADS }, landed: CoinFace.HEADS }), /exactly two players/);
    assert.throws(() => new CoinToss({ calls: { alice: CoinFace.HEADS, bob: CoinFace.TAILS }, landed: "edge" }), /heads or tails/);
    assert.throws(() => CoinToss.flip({ playerIds: ["alice", "alice"], random: drawing(0, 0) }), /two distinct players/);
    assert.throws(() => CoinToss.decided({ playerIds: ["alice", "bob"], firstPlayerId: "carol", random: drawing(0) }), /not one of the players/);
  });

  it("flip draws who holds heads, then how the coin lands", () => {
    const tails = CoinToss.flip({ playerIds: ["alice", "bob"], random: drawing(1, 1) });
    assert.equal(tails.faceOf("bob"), CoinFace.HEADS, "first draw: bob (index 1) holds heads");
    assert.equal(tails.landed, CoinFace.TAILS, "second draw: the coin shows tails");
    assert.equal(tails.firstPlayerId, "alice");
    const heads = CoinToss.flip({ playerIds: ["alice", "bob"], random: drawing(0, 0) });
    assert.equal(heads.faceOf("alice"), CoinFace.HEADS);
    assert.equal(heads.firstPlayerId, "alice");
  });

  it("decided draws only the faces and lands the coin on the first player's", () => {
    for (const draw of [0, 1]) {
      const toss = CoinToss.decided({ playerIds: ["s0", "s1"], firstPlayerId: "s1", random: drawing(draw) });
      assert.equal(toss.firstPlayerId, "s1");
      assert.equal(toss.landed, toss.faceOf("s1"));
    }
    assert.notEqual(CoinToss.decided({ playerIds: ["s0", "s1"], firstPlayerId: "s1", random: drawing(0) }).landed, CoinToss.decided({ playerIds: ["s0", "s1"], firstPlayerId: "s1", random: drawing(1) }).landed, "the faces themselves are drawn");
  });

  it("is fair: over many seeds each player goes first about half the time, with either face", () => {
    const firsts = { alice: 0, bob: 0 };
    const landed = { [CoinFace.HEADS]: 0, [CoinFace.TAILS]: 0 };
    for (let seed = 1; seed <= 400; seed += 1) {
      const toss = CoinToss.flip({ playerIds: ["alice", "bob"], random: ChaChaRandom.fromSeed(seed) });
      firsts[/** @type {"alice" | "bob"} */ (toss.firstPlayerId)] += 1;
      landed[toss.landed] += 1;
    }
    for (const count of [...Object.values(firsts), ...Object.values(landed)]) {
      assert.ok(count > 150 && count < 250, `balanced within noise: ${JSON.stringify({ firsts, landed })}`);
    }
  });
});

describe("textSeed", () => {
  it("is stable, spreads nearby texts apart, and is a valid engine seed", () => {
    assert.equal(textSeed("01j8x3r6h2qkq4w0v7m5a9c1dz"), textSeed("01j8x3r6h2qkq4w0v7m5a9c1dz"));
    assert.notEqual(textSeed("game-a"), textSeed("game-b"));
    assert.equal(textSeed(""), 0x811c9dc5, "the FNV-1a offset basis");
    for (const text of ["", "a", "01j8x3r6h2qkq4w0v7m5a9c1dz"]) {
      assert.ok(ChaChaRandom.isValidSeed(textSeed(text)));
      assert.ok(textSeed(text) >= 0 && textSeed(text) <= 0xffffffff);
    }
  });
});

describe("Practice match coin toss (MatchSetupService + MatchSession)", () => {
  it("seats the toss winner first, whichever of the two it is", () => {
    for (const winner of ["player", "ai"]) {
      const created = practiceMatch({ coinSeed: coinSeedWinningFor(winner) });
      assert.equal(created.ok, true);
      const session = created.value;
      assert.equal(session.openingToss?.firstPlayerId, winner);
      assert.equal(session.snapshotFor(null).activePlayerId, winner, "the engine gives the first turn to the toss winner");
      assert.deepEqual(session.humanPlayerIds, ["player"], "seating order does not change who is human");
    }
  });

  it("draws the toss from the coin seed alone: same coin seed, same toss, whatever the match seed", () => {
    const coinSeed = createSeed();
    const a = practiceMatch({ coinSeed, seed: 1 });
    const b = practiceMatch({ coinSeed, seed: createSeed() });
    assert.ok(a.ok && b.ok);
    assert.equal(a.value.openingToss?.firstPlayerId, b.value.openingToss?.firstPlayerId);
    assert.equal(a.value.openingToss?.faceOf("player"), b.value.openingToss?.faceOf("player"));
  });

  it("keeps the seating order and offers no toss without a coin seed", () => {
    const created = practiceMatch();
    assert.ok(created.ok);
    assert.equal(created.value.openingToss, null);
    assert.equal(created.value.snapshotFor(null).activePlayerId, "player");
  });

  it("refuses a coin seed that is not a key or an integer", () => {
    const created = practiceMatch({ coinSeed: "not a key" });
    assert.equal(created.ok, false);
    assert.equal(created.error.code, MatchSetupError.INVALID_SEED);
  });

  it("waits for begin(): the AI does not move while the coin is shown, and the toss is gone once the match runs", async () => {
    const created = practiceMatch({ coinSeed: coinSeedWinningFor("ai") });
    assert.ok(created.ok);
    const session = created.value;
    const updates = [];
    session.subscribe((update) => updates.push(update));
    await session.whenIdle();
    assert.equal(session.version, 0, "nothing happens before begin()");
    assert.deepEqual(updates, []);
    assert.equal(session.submit(endTurn("player")).ok, false, "no command before the match begins");

    assert.equal(session.begin().ok, true);
    assert.equal(session.openingToss, null, "the opening is over");
    assert.equal(updates[0].events[0].type, GameEventType.GAME_STARTED);
    assert.equal(updates[0].events[0].firstPlayerId, "ai");
    await session.whenIdle();
    assert.ok(updates.some((update) => update.playerId === "ai"), "the AI played its first turn");
    assert.equal(session.snapshotFor(null).awaitingPlayerId, "player");

    const version = session.version;
    assert.equal(session.begin().ok, true, "begin() again is harmless");
    assert.equal(session.version, version);
  });

  it("begin() is harmless on a session that was started directly (tools, previews)", () => {
    const created = practiceMatch();
    assert.ok(created.ok);
    assert.equal(created.value.start().ok, true);
    assert.equal(created.value.begin().ok, true);
  });
});

describe("Online coin toss (RemoteMatchSession)", () => {
  const GAME_ID = "01j8x3r6h2qkq4w0v7m5a9c1dz";
  const PLAYERS = [
    { id: "s0", name: "alice" },
    { id: "s1", name: "bob" },
  ];
  /** @param {string | null} seat */
  const remote = (seat, gameId = GAME_ID) => new RemoteMatchSession({ gameId, seat, request: async () => ({ ok: false, error: { code: "OFFLINE", message: "offline" } }), newCommandId: () => "c1" });
  /** @param {number} version @param {readonly object[]} events */
  const view = (version, events) => ({ version, snapshot: { version, players: PLAYERS, isOver: false, awaitingPlayerId: "s1" }, events });
  const OPENING = view(1, [{ type: GameEventType.GAME_STARTED, firstPlayerId: "s1" }, { type: GameEventType.TURN_STARTED, turnNumber: 1, playerId: "s1" }]);

  it("tells the server's choice as a toss: the coin lands on the first seat's face", () => {
    const session = remote("s0");
    assert.equal(session.openingToss, null, "nothing before the game opens");
    session.apply(OPENING);
    const toss = session.openingToss;
    assert.ok(toss !== null);
    assert.equal(toss.firstPlayerId, "s1");
    assert.equal(toss.landed, toss.faceOf("s1"));
    assert.deepEqual([...toss.playerIds].sort(), ["s0", "s1"]);
    assert.equal(session.begin().ok, true, "the server already started the game");
  });

  it("shows both players (and spectators) the same coin, and different games different coins", () => {
    const seen = ["s0", "s1", null].map((seat) => {
      const session = remote(seat);
      session.apply(OPENING);
      return session.openingToss?.faceOf("s0");
    });
    assert.equal(new Set(seen).size, 1, "one coin for everyone at the table");
    const faces = new Set();
    for (let game = 0; game < 16; game += 1) {
      const session = remote("s0", `01j8x3r6h2qkq4w0v7m5a9c1${game.toString(36).padStart(2, "0")}`);
      session.apply(OPENING);
      faces.add(session.openingToss?.faceOf("s0"));
    }
    assert.equal(faces.size, 2, "who holds heads varies from game to game");
  });

  it("is over once anyone moved, and never offered when the opening was not seen", () => {
    const session = remote("s0");
    session.apply(OPENING);
    session.apply(view(2, [{ type: GameEventType.CARD_PLAYED }]));
    assert.equal(session.openingToss, null, "the first player already acted");

    const late = remote("s0");
    late.apply(view(5, []));
    assert.equal(late.openingToss, null, "joined (or resumed) mid-game");
  });
});
