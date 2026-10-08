/**
 * The online lobby against a real OnlineService and a scripted server:
 * decks with their playability, queueing, handing the match to the match
 * screen once the server starts the game, and — in v2 — saying who has
 * accepted the game with Keychain, and who did not when it is cancelled.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { EntryService } from "../../src/application/entries/EntryService.js";
import { LobbyService } from "../../src/application/lobby/LobbyService.js";
import { RankingService } from "../../src/application/ranking/RankingService.js";
import { ShopService } from "../../src/application/shop/ShopService.js";
import { LISTING_WITH_ENTRIES } from "../application/fakeMarketApi.js";
import { OnlineService } from "../../src/application/online/OnlineService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { OnlineScene, matchedText } from "../../src/rendering/scenes/OnlineScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const GAME = "01j8x3r6h2qkq4w0v7m5a9c1dz";

/** A player who may play ranked, in a running season. */
const ELIGIBLE = Object.freeze({ season: { id: "season-1", name: "Season 1" }, rating: 1500, deviation: 350, provisional: true, rank: null, games: 0, wins: 0, losses: 0, draws: 0, eligible: true, casualGamesNeeded: 0 });

/**
 * @param {{ lobbyReplies?: Record<string, (d: any) => unknown>, ranked?: { balance: number, perGame: number }, eligible?: boolean, shop?: boolean }} [options] `lobbyReplies`: the scripted server's answers to the lobby's requests;
 *   `ranked`: the player holds these entries (and may play ranked unless `eligible` is false); `shop`: the shop's listing (with ranked entries at 1 STEEM) can be read
 */
async function harness({ lobbyReplies, ranked, eligible = true, shop: withShop = false } = {}) {
  const listeners = new Set();
  const statusListeners = new Set();
  const requests = [];
  const connection = {
    connect: () => statusListeners.forEach((listener) => listener("open", { code: null })),
    close: () => undefined,
    request: async (t, d) => {
      requests.push({ t, d });
      if (t === "hello") {
        return ok({ t: "welcome", d: { user: {}, serverTime: 0, activeGame: null, queue: { state: "idle" } } });
      }
      if (lobbyReplies?.[t] !== undefined) {
        return ok(lobbyReplies[t](d));
      }
      return ok({ t: t === "queue.join" ? "queue.status" : "ok", d: { state: t === "queue.join" ? "searching" : "idle" } });
    },
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onStatus: (listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
  };
  const online = new OnlineService({
    connection,
    randomHex: (bytes) => "ab".repeat(bytes),
    newCommandId: () => "00000000-0000-4000-8000-000000000001",
    accountDecks: () => [
      { id: "11111111-1111-4111-8111-111111111111", name: "Iron Foundry", mix: [{ faction: "iron", count: 26 }, { faction: "neutral", count: 4 }], totalCards: 30, playable: true, problem: null },
      { id: "22222222-2222-4222-8222-222222222222", name: "Draft", mix: [{ faction: "ember", count: 3 }], totalCards: 3, playable: false, problem: "deck has 3 cards; minimum is 30" },
    ],
    logger: new MemoryLogger(),
  });
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const navigated = [];
  const services = { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: (id, params) => navigated.push({ id, params }), hasScene: () => true };
  const lobby = lobbyReplies === undefined ? undefined : new LobbyService({ connection, scheduler: { delay: () => new Promise(() => undefined) }, now: () => 0, logger: new MemoryLogger() });
  const standing = eligible ? ELIGIBLE : { ...ELIGIBLE, eligible: false, casualGamesNeeded: 2 };
  const ranking = ranked === undefined ? undefined : new RankingService({ api: { standing: async () => ok(standing), leaderboard: async () => ok({ season: ELIGIBLE.season, entries: [] }) } });
  const unused = async () => ok(null);
  const shop = withShop ? new ShopService({ api: { listing: async () => ok(LISTING_WITH_ENTRIES), createOrder: unused, getOrder: unused, listOrders: unused, cancelOrder: unused, paymentHint: unused }, wallet: { name: "Steem Keychain" }, account: { state: { account: "alice" }, refresh: async () => undefined }, scheduler: { delay: async () => undefined }, newKey: () => "key" }) : undefined;
  const entries = ranked === undefined ? undefined : new EntryService({ api: { entries: async () => ok([{ kind: "ranked", ...ranked, season: "season-1" }]) } });
  const scene = new OnlineScene(services, { content, online, lobby, ranking, entries, shop });
  scene.enter({});
  await flush();
  return { scene, online, lobby, requests, navigated, push: (t, d) => listeners.forEach((listener) => listener({ t, d })) };
}

const byId = (scene, id) => scene.root.findById(id);
function rendered(scene) {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
}
/** Everything the scene says, as one text (wrapped paragraphs read across their lines). */
const said = (scene) => rendered(scene).join(" ");

describe("OnlineScene", () => {
  it("lists the account's decks, unplayable ones disabled with the reason", async () => {
    const { scene } = await harness();
    const good = byId(scene, "online.deck.11111111-1111-4111-8111-111111111111");
    const draft = byId(scene, "online.deck.22222222-2222-4222-8222-222222222222");
    assert.equal(good.selected, true);
    assert.equal(draft.enabled, false);
    assert.match(draft.subtitle, /not playable: deck has 3 cards/);
    assert.match(said(scene), /first player is drawn by lot/);
  });

  it("queues with the selected deck, can stop, and opens the match when the server starts it", async () => {
    const { scene, requests, navigated, push } = await harness();
    byId(scene, "online.find").activate();
    await flush();
    assert.deepEqual(requests.find((request) => request.t === "queue.join").d, { mode: "casual", deckId: "11111111-1111-4111-8111-111111111111" });
    assert.equal(byId(scene, "online.cancel").text, "Stop searching");

    push("match.found", { gameId: GAME, seat: "s1", opponent: { account: "bob" }, seedCommit: "ef".repeat(32) });
    assert.ok(rendered(scene).some((text) => text.includes("Opponent found: @bob")));
    push("game.events", { gameId: GAME, seat: "s1", status: "ACTIVE", opponent: { account: "bob" }, version: 3, snapshot: { version: 3, isOver: false }, events: [] });
    const match = navigated.at(-1);
    assert.equal(match.id, SceneId.MATCH);
    assert.deepEqual(match.params.session.humanPlayerIds, ["s1"]);
    assert.equal(match.params.againScene, SceneId.ONLINE, "play again leads back to the lobby");
  });
});

describe("OnlineScene with ranked entries", () => {
  it("shows from the start what a ranked game costs in STEEM, that it goes into the jackpot, and how many entries the player has", async () => {
    const { scene, requests } = await harness({ ranked: { balance: 3, perGame: 1 }, shop: true });
    assert.equal(byId(scene, "online.entries").text, "A ranked game costs 1.000 STEEM, and every entry goes into the season's jackpot: you have 3 ranked entries.");
    const tickets = byId(scene, "online.tickets");
    assert.equal(tickets.count, 3, "the tickets held, as a stack");
    assert.equal(tickets.face, "1.000 STEEM", "printed with what an entry costs");
    assert.ok(rendered(scene).includes("×3"), "sealed with the count");
    assert.equal(byId(scene, "online.mode.ranked").text, "Ranked · 1.000 STEEM");
    assert.equal(byId(scene, "online.find").text, "Find a match", "casual is free");
    byId(scene, "online.mode.ranked").activate();
    assert.equal(byId(scene, "online.find").text, "Find a match · 1.000 STEEM");
    byId(scene, "online.find").activate();
    await flush();
    assert.deepEqual(requests.find((request) => request.t === "queue.join").d.mode, "ranked");
  });

  it("offers to get ranked entries in the shop instead of a search the server would refuse", async () => {
    const { scene, navigated, requests } = await harness({ ranked: { balance: 0, perGame: 1 } });
    assert.match(byId(scene, "online.entries").text, /you have no ranked entries yet\.$/);
    assert.equal(byId(scene, "online.tickets").count, 0, "a faded ticket sealed at 0");
    assert.ok(byId(scene, "online.find"), "casual needs no entries");
    byId(scene, "online.mode.ranked").activate();
    assert.equal(byId(scene, "online.find"), null);
    const get = byId(scene, "online.getEntries");
    assert.equal(get.text, "Get ranked entries");
    get.activate();
    assert.deepEqual(navigated.at(-1), { id: SceneId.SHOP, params: { category: "ranked", from: SceneId.ONLINE } });
    assert.equal(requests.some((request) => request.t === "queue.join"), false);
  });

  it("says what ranked costs even before the player may play it", async () => {
    const { scene } = await harness({ ranked: { balance: 0, perGame: 1 }, eligible: false, shop: true });
    assert.match(byId(scene, "online.entries").text, /^A ranked game costs 1\.000 STEEM/);
    assert.equal(byId(scene, "online.mode.ranked").text, "Ranked · 1.000 STEEM");
  });

  it("says nothing of entries while ranked play is free", async () => {
    const { scene } = await harness({ ranked: { balance: 0, perGame: 0 } });
    assert.equal(byId(scene, "online.entries"), null);
    assert.equal(byId(scene, "online.tickets"), null);
    byId(scene, "online.mode.ranked").activate();
    assert.ok(byId(scene, "online.find"));
  });
});

describe("OnlineScene before a v2 game starts", () => {
  const WAITING = (authorized) => ({ gameId: GAME, seat: "s1", status: "CREATED", protocol: 2, opponent: { account: "bob" }, version: 0, snapshot: null, authorized });

  it("says the game starts once both players sign it, and who has", () => {
    const state = (acceptance) => ({ status: "matched", opponent: "bob", acceptance, error: null, session: null, watching: null });
    assert.equal(matchedText(state({ you: false, opponent: false })), "Opponent found: @bob. The game starts once both of you sign it with Keychain: accept it in Keychain, waiting for @bob.");
    assert.equal(matchedText(state({ you: true, opponent: false })), "Opponent found: @bob. The game starts once both of you sign it with Keychain: you have accepted, waiting for @bob.");
    assert.equal(matchedText(state({ you: false, opponent: true })), "Opponent found: @bob. The game starts once both of you sign it with Keychain: accept it in Keychain, @bob has accepted.");
    assert.equal(matchedText(state(null)), "Opponent found: @bob. Shuffling with both players' randomness…", "v1: nothing to sign");
  });

  it("shows who has accepted, then the cancellation and who did not accept, and lets the player search again", async () => {
    const { scene, navigated, push } = await harness();
    push("game.state", WAITING({ s0: true, s1: false }));
    assert.match(said(scene), /@bob has accepted/);
    assert.equal(byId(scene, "online.find").enabled, false, "no new search while a game waits");

    push("game.aborted", { gameId: GAME, reason: "not_authorized", seats: ["s1"], you: "s1" });
    assert.match(said(scene), /cancelled before it started/);
    assert.match(said(scene), /You did not sign the game with Keychain in time/);
    assert.equal(byId(scene, "online.find").enabled, true);
    assert.ok(navigated.every((entry) => entry.id !== SceneId.MATCH), "never went to the board");
  });
});

describe("OnlineScene: players online and challenges", () => {
  const DECK = "11111111-1111-4111-8111-111111111111";
  const CHALLENGE = { id: "c1", from: "carol", to: "me", mode: "casual", expiresAt: 0, expiresInMs: 60_000 };
  const players = [
    { account: "bob", status: "idle" },
    { account: "dave", status: "searching" },
    { account: "erin", status: "playing" },
  ];
  const lobbyReplies = {
    "lobby.list": () => ({ t: "lobby.players", d: { players, challenges: { incoming: [], outgoing: null } } }),
    "challenge.send": (d) => ({ t: "challenge.sent", d: { id: "c2", from: "me", to: d.to, mode: d.mode, expiresAt: 0, expiresInMs: 60_000 } }),
    "challenge.accept": (d) => ({ t: "challenge.accepted", d: { challengeId: d.challengeId, gameId: GAME } }),
    "challenge.decline": (d) => ({ t: "challenge.declined", d: { challengeId: d.challengeId } }),
    "challenge.cancel": (d) => ({ t: "challenge.cancelled", d: { challengeId: d.challengeId } }),
  };

  it("lists the players online with their portraits; those in a game cannot be challenged", async () => {
    const { scene } = await harness({ lobbyReplies });
    const bob = byId(scene, "online.player.bob");
    assert.equal(bob.avatar, "bob");
    assert.match(bob.subtitle, /Ready to play/);
    assert.equal(bob.enabled, true);
    assert.equal(byId(scene, "online.player.dave").enabled, true, "searching players can be challenged");
    assert.equal(byId(scene, "online.player.erin").enabled, false);
    assert.equal(byId(scene, "online.players.count").text, "3");
  });

  it("challenges a player to a casual or ranked game with the selected deck, and can withdraw it", async () => {
    const { scene, requests } = await harness({ lobbyReplies });
    byId(scene, "online.player.bob").activate();
    assert.equal(byId(scene, "challenge.title").text, "Challenge @bob");
    assert.equal(byId(scene, "challenge.ranked").enabled, false, "ranked needs the player to be eligible");
    byId(scene, "challenge.casual").activate();
    await flush();
    assert.deepEqual(requests.find((request) => request.t === "challenge.send").d, { to: "bob", mode: "casual", deckId: DECK });
    assert.equal(scene.modal, null);
    assert.match(said(scene), /Waiting for @bob to accept your casual challenge/);
    assert.equal(byId(scene, "online.player.bob").selected, true);
    assert.equal(byId(scene, "online.find"), null, "no queue while waiting for an answer");

    byId(scene, "online.withdraw").activate();
    await flush();
    assert.deepEqual(requests.at(-1), { t: "challenge.cancel", d: { challengeId: "c2" } });
    assert.ok(byId(scene, "online.find"));
  });

  it("shows a challenge received first, and accepts it with the selected deck", async () => {
    const { scene, requests, push } = await harness({ lobbyReplies });
    push("challenge.received", CHALLENGE);
    const row = byId(scene, "online.challenge.c1");
    assert.equal(row.text, "@carol challenges you");
    assert.equal(row.avatar, "carol");
    row.activate();
    assert.equal(byId(scene, "challenge.title").text, "@carol challenges you");
    assert.match(byId(scene, "challenge.message").text, /You play with “Iron Foundry”/);
    byId(scene, "challenge.accept").activate();
    await flush();
    assert.deepEqual(requests.find((request) => request.t === "challenge.accept").d, { challengeId: "c1", deckId: DECK });
    assert.equal(byId(scene, "online.challenge.c1"), null);
  });

  it("keeps a dialog open while the list refreshes, and closes it when its challenge closes", async () => {
    const listed = { t: "lobby.players", d: { players, challenges: { incoming: [CHALLENGE], outgoing: null } } };
    const { scene, lobby, requests, push } = await harness({ lobbyReplies: { ...lobbyReplies, "lobby.list": () => listed } });
    push("challenge.received", CHALLENGE);
    byId(scene, "online.challenge.c1").activate();
    await lobby?.refresh();
    assert.notEqual(scene.modal, null, "a refresh does not close it");
    assert.equal(byId(scene, "challenge.title").text, "@carol challenges you");
    push("challenge.closed", { challengeId: "c1", reason: "cancelled" });
    assert.equal(scene.modal, null);

    push("challenge.received", { ...CHALLENGE, id: "c3" });
    byId(scene, "online.challenge.c3").activate();
    byId(scene, "challenge.decline").activate();
    await flush();
    assert.deepEqual(requests.at(-1), { t: "challenge.decline", d: { challengeId: "c3" } });
    assert.equal(scene.modal, null);
  });
});
