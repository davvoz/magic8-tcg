/**
 * The two online lobbies, Casual and Ranked, against a real OnlineService and a scripted server: decks with their
 * playability, queueing in the lobby's mode, handing the match to the match screen once the server starts the game,
 * the players online and the challenges (sent and answered in the lobby's mode, in its panel), and — in v2 — who has
 * accepted the game with Keychain. Ranked puts first what it needs: the entries held (got right there, in a dialog),
 * ranked open to the player, a deck; and a ranked game takes entries, never money.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { AutoListService } from "../../src/application/auto/AutoListService.js";
import { EntryService } from "../../src/application/entries/EntryService.js";
import { LobbyService } from "../../src/application/lobby/LobbyService.js";
import { RankingService } from "../../src/application/ranking/RankingService.js";
import { PurchaseStage, ShopService } from "../../src/application/shop/ShopService.js";
import { LISTING_WITH_ENTRIES, fakeMarketApi } from "../application/fakeMarketApi.js";
import { OnlineService } from "../../src/application/online/OnlineService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { CasualScene } from "../../src/rendering/scenes/CasualScene.js";
import { matchedText } from "../../src/rendering/scenes/lobby/lobbyText.js";
import { rankedSteps } from "../../src/rendering/scenes/online/rankedGuideFor.js";
import { StepState } from "../../src/rendering/scenes/online/StepList.js";
import { RankedScene } from "../../src/rendering/scenes/RankedScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const GAME = "01j8x3r6h2qkq4w0v7m5a9c1dz";
const DECK = "11111111-1111-4111-8111-111111111111";

/** The season's jackpot, three places paid. */
const JACKPOT = Object.freeze({
  season: { id: "season-1", name: "Season 1", startsAt: 0, endsAt: 86_400_000, status: "running" },
  bank: "verdu.green",
  asset: "STEEM",
  share: { numerator: 2, denominator: 3 },
  jackpot: "866.666",
  opening: "666.666",
  readAt: 0,
  places: [
    { place: 1, percent: 65, amount: "563.332", account: "alice", rating: 1700, paid: null },
    { place: 2, percent: 25, amount: "216.666", account: "bob", rating: 1600, paid: null },
    { place: 3, percent: 10, amount: "86.668", account: null, rating: null, paid: null },
  ],
});

/** A player who may play ranked, in a running season. */
const ELIGIBLE = Object.freeze({ season: { id: "season-1", name: "Season 1" }, rating: 1500, deviation: 350, provisional: true, rank: null, games: 0, wins: 0, losses: 0, draws: 0, eligible: true, casualGamesNeeded: 0, practiceGamesNeeded: 0 });

/**
 * @param {{ lobby?: "casual" | "ranked", lobbyReplies?: Record<string, (d: any) => unknown>, ranked?: { balance: number, perGame: number }, eligible?: boolean, shop?: boolean, auto?: boolean, jackpot?: object, params?: object }} [options]
 *   `lobby`: which lobby (casual by default); `lobbyReplies`: the scripted server's answers to the lobby's requests;
 *   `ranked`: the player holds these entries (and may play ranked unless `eligible` is false); `shop`: a shop selling
 *   ranked entries at 1 STEEM, paid with a wallet that approves; `jackpot`: the season's jackpot, as its service has read it
 */
async function harness({ lobby: which = "casual", lobbyReplies, ranked, eligible = true, shop: withShop = false, auto = false, jackpot: pot, params = {} } = {}) {
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
      { id: DECK, name: "Iron Foundry", mix: [{ faction: "iron", count: 26 }, { faction: "neutral", count: 4 }], totalCards: 30, playable: true, problem: null },
      { id: "22222222-2222-4222-8222-222222222222", name: "Draft", mix: [{ faction: "ember", count: 3 }], totalCards: 3, playable: false, problem: "deck has 3 cards; minimum is 30" },
    ],
    logger: new MemoryLogger(),
  });
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const navigated = [];
  const services = { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: (id, navigation) => navigated.push({ id, params: navigation }), hasScene: () => true };
  const lobby = lobbyReplies === undefined ? undefined : new LobbyService({ connection, scheduler: { delay: () => new Promise(() => undefined) }, now: () => 0, logger: new MemoryLogger() });
  const { ranking, entries } = rankedPlay(ranked, eligible);
  const account = { state: { account: "alice" }, refresh: async () => undefined };
  const { shop, market, transfers } = shopFor(withShop, account);
  const autoList = auto ? new AutoListService({ connection, randomHex: (bytes) => "cd".repeat(bytes), logger: new MemoryLogger() }) : undefined;
  const jackpot = pot === undefined ? undefined : { state: { loading: false, loaded: true, jackpot: pot, error: null }, subscribe: () => () => undefined, watch: () => () => undefined, now: () => 0 };
  const app = /** @type {any} */ ({ content, online, lobby, ranking, entries, shop, autoList, account, jackpot });
  const scene = new LOBBIES[which](services, app, () => 3_600_000);
  scene.enter(params);
  await flush();
  return { scene, online, lobby, shop, market, transfers, requests, navigated, push: (t, d) => listeners.forEach((listener) => listener({ t, d })) };
}

/** The lobbies by name. */
const LOBBIES = Object.freeze({ casual: CasualScene, ranked: RankedScene });

/**
 * The player's standing and ranked entries: none without `ranked`; a standing that may play ranked unless `eligible` is false.
 * @param {{ balance: number, perGame: number } | undefined} ranked
 * @param {boolean} eligible
 */
function rankedPlay(ranked, eligible) {
  if (ranked === undefined) {
    return { ranking: undefined, entries: undefined };
  }
  const standing = eligible ? ELIGIBLE : { ...ELIGIBLE, eligible: false, casualGamesNeeded: 2, practiceGamesNeeded: 2 };
  return {
    ranking: new RankingService({ api: { standing: async () => ok(standing), leaderboard: async () => ok({ season: ELIGIBLE.season, entries: [] }) } }),
    entries: new EntryService({ api: { entries: async () => ok([{ kind: "ranked", ...ranked, season: "season-1" }]) } }),
  };
}

/**
 * A shop selling ranked entries, paid with a wallet that approves every transfer (none when `open` is false).
 * @param {boolean} open
 * @param {{ state: { account: string } }} account
 */
function shopFor(open, account) {
  const market = fakeMarketApi({ listing: LISTING_WITH_ENTRIES });
  const transfers = [];
  const wallet = { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => ok(""), requestTransfer: async (request) => (transfers.push(request), ok("ef".repeat(20))) };
  const shop = open ? new ShopService({ now: () => 0, api: market.api, wallet, account, scheduler: { delay: async () => undefined }, newKey: () => "key" }) : undefined;
  return { shop, market, transfers };
}

const byId = (scene, id) => scene.findNode(id);
function rendered(scene) {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
}
/** Everything the scene says, as one text (wrapped paragraphs read across their lines). */
const said = (scene) => rendered(scene).join(" ");

describe("CasualScene", () => {
  it("lists the account's decks, unplayable ones disabled with the reason", async () => {
    const { scene } = await harness();
    const good = byId(scene, `online.deck.${DECK}`);
    const draft = byId(scene, "online.deck.22222222-2222-4222-8222-222222222222");
    assert.equal(good.selected, true);
    assert.equal(draft.enabled, false);
    assert.match(draft.subtitle, /not playable: deck has 3 cards/);
    assert.match(said(scene), /first player is drawn by lot/);
  });

  it("says what casual play is, free, in three steps", async () => {
    const { scene } = await harness({ ranked: { balance: 3, perGame: 1 }, shop: true });
    assert.match(said(scene), /No rating at stake/);
    assert.equal(byId(scene, "casual.steps.text.2").text, "Find a match, or click a player online to challenge them.");
    assert.equal(byId(scene, "online.find").text, "Find a casual match", "casual is free");
    assert.equal(byId(scene, "online.entries"), null, "entries belong to Ranked");
  });

  it("queues casual with the selected deck, can stop, and opens the match when the server starts it", async () => {
    const { scene, requests, navigated, push } = await harness();
    byId(scene, "online.find").activate();
    await flush();
    assert.deepEqual(requests.find((request) => request.t === "queue.join").d, { mode: "casual", deckId: DECK });
    assert.equal(byId(scene, "online.cancel").text, "Stop searching");

    push("match.found", { gameId: GAME, seat: "s1", opponent: { account: "bob" }, seedCommit: "ef".repeat(32) });
    assert.ok(rendered(scene).some((text) => text.includes("Opponent found: @bob")));
    push("game.events", { gameId: GAME, seat: "s1", status: "ACTIVE", opponent: { account: "bob" }, version: 3, snapshot: { version: 3, isOver: false }, events: [] });
    const match = navigated.at(-1);
    assert.equal(match.id, SceneId.MATCH);
    assert.deepEqual(match.params.session.humanPlayerIds, ["s1"]);
    assert.equal(match.params.againScene, SceneId.CASUAL, "play again leads back to the casual lobby");
  });

  it("speaks of casual play only: nothing there of ranked play, locked or open", async () => {
    for (const eligible of [false, true]) {
      const { scene } = await harness({ ranked: { balance: 0, perGame: 1 }, eligible });
      assert.equal(byId(scene, "online.unlockHint"), null);
      assert.equal(byId(scene, "casual.toRanked"), null);
      assert.doesNotMatch(said(scene), /Ranked/);
    }
  });
});

describe("RankedScene", () => {
  it("shows the season, the entries held as tickets with what one costs, what playing needs, and queues ranked for entries, not money", async () => {
    const { scene, requests } = await harness({ lobby: "ranked", ranked: { balance: 3, perGame: 1 }, shop: true });
    assert.equal(byId(scene, "online.season").text, "Season 1");
    assert.equal(byId(scene, "online.crest").place, "NEW", "a provisional rating has no place yet");
    const tickets = byId(scene, "online.tickets");
    assert.equal(tickets.count, 3, "the tickets held, as a stack");
    assert.equal(tickets.face, "1 STEEM", "printed with what an entry costs");
    assert.ok(rendered(scene).includes("×3"), "sealed with the count");
    assert.equal(byId(scene, "online.entries").text, "3 tickets");
    assert.equal(byId(scene, "ranked.band.about").text, "A game uses 1 · 1 STEEM each\nAll go into the season's jackpot");
    assert.equal(byId(scene, "ranked.buy").text, "Buy", "tickets are bought");
    const ready = byId(scene, "ranked.ready");
    assert.deepEqual(ready.steps.map((step) => step.state), [StepState.DONE, StepState.DONE, StepState.DONE]);
    assert.deepEqual([1, 2, 3].map((n) => byId(scene, `ranked.ready.text.${n}`).text), ["Ranked is open to you.", "3 ranked tickets: enough for 3 games.", "Your deck: “Iron Foundry”."]);
    const find = byId(scene, "online.find");
    assert.equal(find.text, "Find a ranked match · 1 ticket", "a game takes an entry: it is not paid for in STEEM");
    find.activate();
    await flush();
    assert.deepEqual(requests.find((request) => request.t === "queue.join").d, { mode: "ranked", deckId: DECK });
  });

  it("shows how ranked works in the panel while nothing is going on, and the status once something is", async () => {
    const { scene } = await harness({ lobby: "ranked", ranked: { balance: 3, perGame: 1 }, shop: true });
    assert.ok(byId(scene, "online.guide"), "how ranked works, on the screen itself");
    assert.equal(byId(scene, "online.status"), null);
    byId(scene, "online.find").activate();
    await flush();
    assert.equal(byId(scene, "online.guide"), null);
    assert.equal(byId(scene, "online.status").text, "Looking for an opponent…");
  });

  it("puts the season's jackpot by the entries, and leads from the bar to all of how ranked works, in Info", async () => {
    const { scene, navigated } = await harness({ lobby: "ranked", ranked: { balance: 3, perGame: 1 }, shop: true, jackpot: JACKPOT });
    assert.equal(byId(scene, "ranked.band.about").text, "A game uses 1 · 1 STEEM each\nAll go into the jackpot: 866 STEEM");
    assert.equal(byId(scene, "online.guide.jackpot").text, "866 STEEM", "how ranked works, in the panel: the pool on the trophy");
    assert.deepEqual([1, 2, 3].map((n) => byId(scene, `online.guide.title.${n}`).text), ["Buy tickets", "Play ranked", "Win the jackpot"], "each step on a plate of its own");
    assert.equal(byId(scene, "online.guide.text.1").text, "1 STEEM each: buy them before you play");
    assert.equal(byId(scene, "online.guide.text.3").text, "Every ticket feeds it: the top 3 share it");
    byId(scene, "ranked.guide").activate();
    assert.deepEqual(navigated.at(-1), { id: SceneId.INFO, params: { topic: "ranked", back: SceneId.RANKED, backParams: {} } }, "the bar's How ranked works: all of it, in Info");
  });

  it("shows the season's prize over the decks: the pool, the podium with each place's share and prize, the player's place and the leaderboard", async () => {
    const { scene, navigated } = await harness({ lobby: "ranked", ranked: { balance: 3, perGame: 1 }, shop: true, jackpot: JACKPOT });
    const prize = byId(scene, "ranked.prize");
    assert.ok(prize, "the prize, across the decks and the players");
    assert.ok(byId(scene, "online.decks").parent.y > prize.y + prize.height, "the decks below it");
    assert.ok(rendered(scene).includes("866 STEEM"), "the pool, in whole STEEM");
    assert.equal(byId(scene, "prize.title").text, "SEASON 1 · PRIZE POOL");
    assert.match(byId(scene, "prize.share").text, /the top 3 of the leaderboard share it: 65% · 25% · 10%/);
    assert.deepEqual([1, 2, 3].map((n) => byId(scene, `prize.name.${n}`).text), ["@alice · You", "@bob", "Open seat"], "the player is @alice: their place says so");
    assert.deepEqual([1, 2, 3].map((n) => byId(scene, `prize.amount.${n}`).text), ["65% · 563 STEEM", "25% · 216 STEEM", "10% · 86 STEEM"]);
    assert.equal(byId(scene, "prize.avatar.1").account, "alice");
    assert.equal(byId(scene, "prize.you").text, "You: not ranked yet · play a game");
    assert.equal(byId(scene, "ranked.season"), null, "one way to the leaderboard: the prize's, not a second one in the bar");
    assert.ok(byId(scene, "ranked.guide"), "how ranked works stays in the bar");
    byId(scene, "prize.leaderboard").activate();
    assert.deepEqual(navigated.at(-1), { id: SceneId.SEASON, params: { back: SceneId.RANKED, backParams: {} } });

    const { scene: bare, navigated: went } = await harness({ lobby: "ranked", ranked: { balance: 3, perGame: 1 } });
    byId(bare, "ranked.season").activate();
    assert.equal(went.at(-1).id, SceneId.SEASON, "without a prize on show, the bar leads to the leaderboard");

    const { scene: casual } = await harness({ ranked: { balance: 3, perGame: 1 }, jackpot: JACKPOT });
    assert.equal(byId(casual, "ranked.prize"), null, "the prize belongs to Ranked");
  });

  it("without entries, says so in red and gets them right there instead of a search the server would refuse", async () => {
    const { scene, requests } = await harness({ lobby: "ranked", ranked: { balance: 0, perGame: 1 }, shop: true });
    assert.equal(byId(scene, "online.entries").text, "None yet");
    assert.equal(byId(scene, "online.entries").colorKey, "danger");
    assert.equal(byId(scene, "online.tickets").count, 0, "a faded ticket sealed at 0");
    assert.equal(byId(scene, "ranked.ready").steps[1].state, StepState.MISSING);
    assert.equal(byId(scene, "ranked.ready.text.2").text, "No ranked tickets: a game uses 1. Buy some above.");
    assert.equal(byId(scene, "online.status"), null, "nothing going on: how ranked works takes the status's place");
    assert.match(byId(scene, "online.guide.title.1").text, /Tickets/i, "its first step: the tickets");
    assert.equal(byId(scene, "online.find"), null);
    const get = byId(scene, "online.getEntries");
    assert.equal(get.text, "Buy ranked tickets");
    get.activate();
    assert.ok(scene.modal?.findById("tickets.buy"), "the purchase opens over the lobby");
    assert.equal(requests.some((request) => request.t === "queue.join"), false);
  });

  it("sells entries in its dialog: how many, what they cost, one payment, and the entries there to play", async () => {
    const { scene, shop, market, transfers } = await harness({ lobby: "ranked", ranked: { balance: 0, perGame: 1 }, shop: true, params: { buy: true } });
    const dialog = () => scene.modal;
    assert.equal(dialog().findById("tickets.title").text, "Buy ranked tickets");
    assert.equal(dialog().findById("tickets.quantity").text, "5", "five to start with");
    dialog().findById("tickets.more").activate();
    dialog().findById("tickets.less").activate();
    dialog().findById("tickets.less").activate();
    assert.equal(dialog().findById("tickets.quantity").text, "4");
    assert.equal(dialog().findById("tickets.added").text, "+4 tickets");
    assert.equal(dialog().findById("tickets.total").text, "Total 4 STEEM");
    assert.match(dialog().findById("tickets.status").text, /Keychain shows the exact transfer before anything is paid/);
    const buy = dialog().findById("tickets.buy");
    assert.equal(buy.text, "Buy 4 tickets · 4 STEEM");
    buy.activate();
    await flush();
    await flush();
    assert.deepEqual(market.calls.find((call) => call.name === "createOrder").args[0], { items: [{ productId: "ranked_entry", quantity: 4 }], asset: "STEEM" });
    assert.deepEqual(transfers.map((transfer) => transfer.amount), ["4.000"], "one wallet prompt for four games");
    assert.equal(shop.state.purchase.stage, PurchaseStage.DONE);
    assert.equal(dialog().findById("tickets.tracker.title").text, "Delivered!", "the purchase's steps all ticked, where the quantity was");
    assert.equal(dialog().findById("tickets.tracker.note").text, "4 ranked tickets added. Good luck in the season!");
    assert.equal(dialog().findById("tickets.quantity"), null);
    dialog().findById("tickets.play").activate();
    assert.equal(scene.modal, null);
  });

  it("opened from the bar's tickets only to buy, goes back where the player was when the purchase closes", async () => {
    const { scene, navigated } = await harness({ lobby: "ranked", ranked: { balance: 0, perGame: 1 }, shop: true, params: { buy: true, quick: true, back: SceneId.SHOP } });
    assert.ok(scene.modal?.findById("tickets.buy"), "the purchase, at once");
    scene.modal.findById("tickets.close").activate();
    assert.equal(navigated.at(-1).id, SceneId.SHOP, "back where the player was");

    const { scene: here, navigated: stayed } = await harness({ lobby: "ranked", ranked: { balance: 0, perGame: 1 }, shop: true });
    byId(here, "online.getEntries").activate();
    here.modal.findById("tickets.close").activate();
    assert.equal(here.modal, null);
    assert.equal(stayed.length, 0, "opened here: it stays here");
  });

  it("opens before the player may play ranked: what is missing, and back to casual for it", async () => {
    const { scene, navigated } = await harness({ lobby: "ranked", ranked: { balance: 0, perGame: 1 }, eligible: false, shop: true });
    assert.equal(byId(scene, "online.standing").text, "Ranked opens after 2 more casual game(s), or 2 more practice game(s) vs AI.");
    assert.equal(byId(scene, "ranked.ready").steps[0].state, StepState.LOCKED);
    assert.equal(byId(scene, "ranked.ready.text.1").text, "Opens after 2 more casual games.");
    assert.equal(byId(scene, "online.crest"), null, "no rating yet");
    assert.equal(byId(scene, "online.find"), null);
    byId(scene, "online.unlock").activate();
    assert.equal(navigated.at(-1).id, SceneId.CASUAL);
    byId(scene, "ranked.toCasual").activate();
    assert.equal(navigated.at(-1).id, SceneId.CASUAL);
  });

  it("says nothing of entries while ranked play is free", async () => {
    const { scene } = await harness({ lobby: "ranked", ranked: { balance: 0, perGame: 0 } });
    assert.equal(byId(scene, "online.entries"), null);
    assert.equal(byId(scene, "online.tickets"), null);
    assert.equal(byId(scene, "ranked.ready.text.2").text, "Free this season: no ticket needed.");
    assert.equal(byId(scene, "online.find").text, "Find a ranked match");
  });
});

describe("rankedSteps", () => {
  it("words the three steps from what is known", () => {
    const [buy, play, win] = rankedSteps({ price: "1.000 STEEM", perGame: 2, places: 3 });
    assert.deepEqual([buy.title, play.title, win.title], ["Buy tickets", "Play ranked", "Win the jackpot"]);
    assert.equal(play.text, "A game takes 2 tickets, given back if it is called off before it starts.");
    assert.equal(win.text, "Every ticket goes into it. When the season ends, the top 3 share it.");
    const unknown = rankedSteps({ price: null, perGame: null, places: null });
    assert.equal(unknown[0].text, "Buy them first, in the Shop: many with one payment.");
    assert.equal(unknown[2].text, "Every ticket goes into it. When the season ends, the best of the season share it.");
  });
});

describe("A lobby before a v2 game starts", () => {
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

describe("Lobbies: players online and challenges", () => {
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

  it("challenges a player to a game of the lobby's kind with the selected deck, and can withdraw it", async () => {
    const { scene, requests } = await harness({ lobbyReplies });
    byId(scene, "online.player.bob").activate();
    assert.equal(byId(scene, "challenge.title").text, "Challenge @bob to a casual game");
    byId(scene, "challenge.send").activate();
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

  it("proposes ranked games from Ranked, saying what they take, and offers entries to a player who has none", async () => {
    const { scene, requests } = await harness({ lobby: "ranked", lobbyReplies, ranked: { balance: 2, perGame: 1 }, shop: true });
    byId(scene, "online.player.bob").activate();
    assert.equal(byId(scene, "challenge.title").text, "Challenge @bob to a ranked game");
    assert.match(byId(scene, "challenge.message").text, /The game takes 1 ranked ticket from each of you when it starts\.$/);
    byId(scene, "challenge.send").activate();
    await flush();
    assert.deepEqual(requests.find((request) => request.t === "challenge.send").d, { to: "bob", mode: "ranked", deckId: DECK });

    const { scene: broke } = await harness({ lobby: "ranked", lobbyReplies, ranked: { balance: 0, perGame: 1 }, shop: true });
    byId(broke, "online.player.bob").activate();
    assert.equal(byId(broke, "challenge.send").enabled, false);
    byId(broke, "challenge.getEntries").activate();
    assert.ok(broke.modal?.findById("tickets.buy"), "the challenge gives way to getting entries");
  });

  it("answers a challenge received in the panel, accepting it with the selected deck", async () => {
    const { scene, requests, push } = await harness({ lobbyReplies });
    push("challenge.received", CHALLENGE);
    assert.equal(byId(scene, "online.answer.title").text, "@carol challenges you");
    assert.equal(byId(scene, "online.answer.time").text, "Casual game · 1:00 to answer");
    assert.match(byId(scene, "online.answer.message").text, /You play with “Iron Foundry”/);
    assert.equal(byId(scene, "online.find"), null, "Accept takes the big button's place");
    assert.equal(scene.modal, null, "no dialog to open");
    byId(scene, "online.answer.accept").activate();
    await flush();
    assert.deepEqual(requests.find((request) => request.t === "challenge.accept").d, { challengeId: "c1", deckId: DECK });
    assert.equal(byId(scene, "online.answer.accept"), null);
    assert.ok(byId(scene, "online.find"), "the panel is the lobby's again");
  });

  it("lists each player once: a challenger's row says so and leads to the answer", async () => {
    const listed = { t: "lobby.players", d: { players: [...players, { account: "carol", status: "idle" }], challenges: { incoming: [CHALLENGE], outgoing: null } } };
    const { scene } = await harness({ lobbyReplies: { ...lobbyReplies, "lobby.list": () => listed } });
    assert.equal(byId(scene, "online.challenge.c1"), null, "no row of its own");
    const carol = byId(scene, "online.player.carol");
    assert.match(carol.subtitle, /Challenging you/);
    carol.activate();
    assert.equal(scene.focusedNode?.id, "online.answer.accept");
    assert.equal(scene.modal, null);
  });

  it("counts the time left down", async () => {
    let now = 0;
    const { scene, lobby, push } = await harness({ lobbyReplies });
    Object.assign(lobby, { secondsLeft: (challenge) => Math.max(0, Math.ceil((challenge.deadline - now) / 1000)) });
    push("challenge.received", CHALLENGE);
    now = 18_500;
    assert.equal(scene.update(16), true);
    assert.equal(byId(scene, "online.answer.time").text, "Casual game · 0:42 to answer");
    assert.equal(scene.update(16), false, "nothing to draw again within the second");
  });

  it("answers a challenge in its own mode's lobby only, and offers tickets in place of Accept to a player who has none", async () => {
    const { scene, push } = await harness({ lobbyReplies, ranked: { balance: 0, perGame: 1 } });
    push("challenge.received", { ...CHALLENGE, mode: "ranked" });
    assert.equal(byId(scene, "online.answer.title"), null, "nothing of ranked play in the casual lobby");

    const { scene: ranked, push: pushRanked } = await harness({ lobby: "ranked", lobbyReplies, ranked: { balance: 0, perGame: 1 }, shop: true });
    pushRanked("challenge.received", { ...CHALLENGE, mode: "ranked" });
    assert.equal(byId(ranked, "online.answer.time").text, "Ranked game · 1:00 to answer");
    assert.match(byId(ranked, "online.answer.message").text, /you have none/);
    assert.equal(byId(ranked, "online.answer.accept"), null);
    byId(ranked, "challenge.getEntries").activate();
    assert.ok(ranked.modal?.findById("tickets.buy"), "the purchase opens right there");
  });

  it("keeps the answer while the list refreshes, goes on to the next challenge, and declines", async () => {
    const second = { ...CHALLENGE, id: "c3", from: "dave" };
    const listed = { t: "lobby.players", d: { players, challenges: { incoming: [CHALLENGE, second], outgoing: null } } };
    const { scene, lobby, requests, push } = await harness({ lobbyReplies: { ...lobbyReplies, "lobby.list": () => listed } });
    push("challenge.received", second);
    assert.match(byId(scene, "online.answer.message").text, /1 more challenge after this one/);
    await lobby?.refresh();
    assert.equal(byId(scene, "online.answer.title").text, "@carol challenges you");
    push("challenge.closed", { challengeId: "c1", reason: "cancelled" });
    assert.equal(byId(scene, "online.answer.title").text, "@dave challenges you");
    byId(scene, "online.answer.decline").activate();
    await flush();
    assert.deepEqual(requests.at(-1), { t: "challenge.decline", d: { challengeId: "c3" } });
    assert.equal(byId(scene, "online.answer.title"), null);
  });
});

describe("RankedScene with the auto list", () => {
  /** The scripted server of the auto list: joining puts the player in it, waiting since the start of time. */
  const AUTO_REPLIES = Object.freeze({
    "auto.status": () => ({ t: "auto.status", d: { state: "idle", waiting: 2 } }),
    "auto.prepare": () => ({ t: "auto.prepared", d: { ticket: "33333333-3333-4333-8333-333333333333", commit: "c".repeat(64) } }),
    "auto.join": (d) => ({ t: "auto.status", d: { state: "waiting", waiting: 3, ticket: d.ticket, since: 0, deckId: d.deckId, style: d.style, entries: 1 } }),
    "lobby.list": () => ({ t: "lobby.players", d: { players: [], challenges: { incoming: [], outgoing: null } } }),
  });

  it("offers a second way to play ranked where the player picks a style and joins, warned there is no way out", async () => {
    const { scene, requests } = await harness({ lobby: "ranked", lobbyReplies: AUTO_REPLIES, ranked: { balance: 1, perGame: 1 }, shop: true, auto: true });
    assert.equal(byId(scene, "online.mode.live").variant, "primary", "live until auto is chosen");
    byId(scene, "online.mode.auto").activate();
    assert.equal(byId(scene, "online.mode.auto").variant, "primary");
    assert.match(byId(scene, "online.auto.status").text, /next player who joins, even hours from now.*2 players are in the auto list/);
    assert.equal(byId(scene, "online.style.balanced").variant, "primary", "balanced until another is chosen");
    byId(scene, "online.style.defensive").activate();
    assert.equal(byId(scene, "online.style.defensive").variant, "primary");
    assert.match(byId(scene, "online.style.hint").text, /blocks often/);
    const join = byId(scene, "online.auto.join");
    assert.equal(join.text, "Join the auto list · 1 ticket");
    join.activate();
    assert.notEqual(scene.modal, null);
    assert.match(scene.modal.findById("challenge.message").text, /“Iron Foundry” defensive.*It costs 1 ranked ticket. Once you join you stay in the list until someone plays you./);
    assert.equal(requests.some((request) => request.t === "auto.prepare"), false, "nothing happens before the player confirms");
    scene.modal.findById("auto.join").activate();
    await flush();
    assert.deepEqual(requests.find((request) => request.t === "auto.join").d, { ticket: "33333333-3333-4333-8333-333333333333", deckId: DECK, style: "defensive", entropy: "cd".repeat(16) });
    const waiting = byId(scene, "online.auto.waiting");
    assert.equal(waiting.enabled, false, "no way out of the list");
    assert.equal(byId(scene, "online.style.aggressive").enabled, false, "the style is the ticket's");
    assert.match(byId(scene, "online.auto.status").text, /You joined 1 h ago with “Iron Foundry”, defensive..*3 players are in the auto list/);
  });

  it("sends a player without entries to get them, and keeps the auto list for those who may play ranked", async () => {
    const { scene } = await harness({ lobby: "ranked", lobbyReplies: AUTO_REPLIES, ranked: { balance: 0, perGame: 1 }, shop: true, auto: true });
    byId(scene, "online.mode.auto").activate();
    assert.equal(byId(scene, "online.auto.join"), null);
    assert.equal(byId(scene, "online.getEntries").text, "Buy ranked tickets");

    const { scene: newcomer } = await harness({ lobby: "ranked", lobbyReplies: AUTO_REPLIES, ranked: { balance: 1, perGame: 1 }, auto: true, eligible: false });
    assert.equal(byId(newcomer, "online.mode.auto").enabled, false, "the same players as ranked");
    assert.equal(byId(newcomer, "online.auto.join"), null, "locked: back to casual instead");
  });
});
