/**
 * The daily challenges in the client (docs/tcg/24-sfide.md): the server's day
 * read and checked, the service the screens drive, the character's voice
 * during a game, the game's rules in words, and the notification of the pack.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { DailyCompanion, LOW_LIFE } from "../../src/application/daily/DailyCompanion.js";
import { DailyBusy, DailyService } from "../../src/application/daily/DailyService.js";
import { characterIdOf, isCharacterAccount, lineFor, nextStepAfter } from "../../src/application/daily/characters.js";
import { describeCondition } from "../../src/application/match/describeCondition.js";
import { describeNotification, packName } from "../../src/application/notifications/describeNotification.js";
import { HttpDailyApi } from "../../src/infrastructure/api/HttpDailyApi.js";
import { DAY } from "./dailyFixtures.js";
import { loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();

/** A DailyApi answering from scripts. */
function scriptedApi({ today = [], track = [], play = [] } = {}) {
  const calls = [];
  return {
    calls,
    today: async () => (calls.push(["today"]), today.shift() ?? ok(DAY)),
    chooseTrack: async (id) => (calls.push(["track", id]), track.shift() ?? ok({ ...DAY, run: { track: id, stage: 0, gameId: null, attempts: 0, rewarded: false, last: null, reward: null } })),
    play: async (deckId) => (calls.push(["play", deckId]), play.shift() ?? ok({ gameId: "game-1" })),
  };
}

describe("HttpDailyApi", () => {
  const api = (body, status = 200) => new HttpDailyApi({ fetch: async () => ({ ok: status < 400, status, headers: { get: () => "application/json" }, json: async () => body, text: async () => JSON.stringify(body) }) });

  it("reads today's day, and refuses one of the wrong shape", async () => {
    const read = await api(DAY).today();
    assert.equal(read.ok, true);
    assert.equal(read.value.opponents[2].conditions[0].name, "Scorched Earth");
    assert.ok(Object.isFrozen(read.value.opponents[0].lines.intro));
    for (const broken of [{ ...DAY, opponents: [{ ...DAY.opponents[0], state: "won" }] }, { ...DAY, run: { track: "normal" } }, { ...DAY, endsAt: "tomorrow" }, null]) {
      assert.equal((await api(broken).today()).ok, false, JSON.stringify(broken)?.slice(0, 80));
    }
  });

  it("starts a challenge and gives back its game", async () => {
    assert.deepEqual((await api({ gameId: "g1" }).play("deck-1")).value, { gameId: "g1" });
    assert.equal((await api({ game: "g1" }).play("deck-1")).ok, false);
  });
});

describe("DailyService", () => {
  it("reads the day, fixes the track, starts challenges one at a time", async () => {
    const api = scriptedApi({ play: [ok({ gameId: "g-1" }), fail("CONFLICT", "you are already in a game")] });
    const daily = new DailyService({ api });
    assert.equal(daily.next, null);
    await daily.refresh();
    assert.equal(daily.next?.id, "kael");
    assert.equal(daily.characterOf("ai_kael")?.name, "Kael", "the characters met are known by their seat");
    assert.equal(daily.characterOf("kael"), null, "a STEEM account is not a character");

    assert.equal((await daily.chooseTrack("hard")).ok, true);
    assert.equal(daily.state.day?.run?.track, "hard");

    const first = daily.play("deck-1");
    assert.equal(daily.state.busy, DailyBusy.PLAY);
    assert.equal((await daily.play("deck-1")).error?.code, "BUSY", "a second click while the server works is ignored");
    assert.deepEqual(await first, ok("g-1"));
    assert.equal(daily.state.busy, null);
    const refused = await daily.play("deck-1");
    assert.equal(refused.ok, false);
    assert.equal(daily.state.error, "you are already in a game");
    assert.deepEqual(api.calls.filter(([what]) => what === "play").length, 2);
  });

  it("forgets the player's day on sign-out, and drops answers that arrive after", async () => {
    let answer;
    const daily = new DailyService({ api: { ...scriptedApi(), today: () => new Promise((resolve) => (answer = resolve)) } });
    const reading = daily.refresh();
    daily.reset();
    answer(ok(DAY));
    await reading;
    assert.equal(daily.state.day, null);
  });
});

describe("DailyCompanion", () => {
  /** An online service whose single game the test moves on by hand. */
  function online(rivalName = "ai_kael") {
    const listeners = new Set();
    let snapshot = { turnNumber: 1, isOver: false, winnerId: null, players: [{ id: "s0", name: "alice", life: 20 }, { id: "s1", name: rivalName, life: 20 }] };
    const session = { gameId: "g-7", seat: "s0", hasSnapshot: true, snapshotFor: () => snapshot };
    const service = { state: { session: null }, subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)) };
    const move = (changes) => {
      snapshot = { ...snapshot, ...changes };
      service.state = { session };
      listeners.forEach((listener) => listener(service.state));
    };
    return { service, move, life: (life) => move({ turnNumber: 6, players: [snapshot.players[0], { ...snapshot.players[1], life }] }) };
  }

  it("has the character speak as the game starts, once nearly beaten, and at the end", async () => {
    const daily = new DailyService({ api: scriptedApi() });
    await daily.refresh();
    const said = [];
    const game = online();
    new DailyCompanion({ online: game.service, daily, say: (speech) => said.push([speech.kind, speech.line]) }).start();
    game.move({});
    game.move({ turnNumber: 2 });
    game.life(LOW_LIFE + 1);
    game.life(LOW_LIFE);
    game.life(2);
    game.move({ isOver: true, winnerId: "s0" });
    game.move({ isOver: true, winnerId: "s0" });
    assert.deepEqual(said, [["intro", "kael says hello"], ["low", "kael is hurt"], ["lose", "kael loses"]]);
  });

  it("keeps quiet in games against people, and does not greet a game already under way", async () => {
    const daily = new DailyService({ api: scriptedApi() });
    await daily.refresh();
    const said = [];
    const people = online("bob");
    new DailyCompanion({ online: people.service, daily, say: (speech) => said.push(speech.kind) }).start();
    people.life(1);
    const late = online();
    new DailyCompanion({ online: late.service, daily, say: (speech) => said.push(speech.kind) }).start();
    late.move({ turnNumber: 9 });
    late.move({ isOver: true, winnerId: "s1" });
    assert.deepEqual(said, ["win"]);
  });
});

describe("characters and rules in words", () => {
  it("tells a character's seat from a STEEM account", () => {
    assert.equal(isCharacterAccount("ai_kael"), true);
    assert.equal(characterIdOf("ai_kael"), "kael");
    for (const account of ["alice", "ai", "ai_", null, undefined]) {
      assert.equal(isCharacterAccount(account), false, String(account));
    }
    assert.equal(lineFor(["a", "b", "c"], "game-1"), lineFor(["a", "b", "c"], "game-1"), "the same line for the same game");
    assert.equal(lineFor([], "game-1"), null);
  });

  it("names what follows a challenge: the next one, the pack after the boss, another try", () => {
    assert.equal(nextStepAfter("win", false), "Next challenge");
    assert.equal(nextStepAfter("win", true), "See your prize");
    assert.equal(nextStepAfter("loss", true), "Try again");
    assert.equal(nextStepAfter("draw", false), "Try again");
  });

  it("puts each kind of condition in words, from the reader's seat", () => {
    const readers = { viewerId: "s0", nameOf: () => "The Gravelord" };
    const say = (condition) => describeCondition(condition, readers);
    assert.equal(say({ kind: "cost", players: ["s0"], filter: { type: "spell" }, amount: 1 }), "Your spells cost 1 more");
    assert.equal(say({ kind: "cost", players: ["s0", "s1"], filter: { type: "creature", faction: "verdant" }, amount: -1 }), "Everyone's Verdant creatures cost 1 less");
    assert.equal(say({ kind: "enter_stats", players: ["s1"], attack: 0, health: 2 }), "The Gravelord's creatures enter the battlefield with +0/+2");
    assert.equal(say({ kind: "keyword", players: ["s0"], filter: { keyword: "trample" }, keyword: "haste" }), "Your creatures with Trample enter the battlefield with Haste");
    assert.equal(say({ kind: "turn_start", players: ["s0", "s1"], effect: "lose_life", amount: 1 }), "At the start of everyone's turn, that player loses 1 life");
    assert.equal(say({ kind: "turn_start", players: ["s0"], effect: "draw", amount: 2 }), "At the start of your turn, you draw 2 cards");
    assert.equal(say({ kind: "extra_draw", players: ["s0", "s1"], amount: 1 }), "Everyone draws 1 more card each turn");
    assert.equal(say({ kind: "starting_hand", players: ["s1"], amount: 2 }), "The Gravelord starts with 2 more cards in hand");
    assert.equal(say({ kind: "starting_life", players: ["s0"], amount: -5 }), "You start with 5 less life");
    assert.equal(say({ kind: "eclipse", players: ["s0"] }), "A special rule holds in this game");
  });

  it("words the notification of the pack won", () => {
    assert.equal(packName("core_mini_booster"), "Core Mini Booster");
    const text = describeNotification({ kind: "daily.reward", data: { day: "2026-10-15", track: "hard", pack: "core_booster", cards: [{ definitionId: "ember_imp", count: 2 }, { definitionId: "pyre_drake", count: 1 }] } }, content.catalog);
    assert.equal(text.title, "Challenges won");
    assert.match(text.body, /Core Booster is open, 3 cards added/);
    assert.equal(text.target, "collection", "opens the collection, the cards won first");
    assert.equal(text.cards.length, 2);
  });
});
