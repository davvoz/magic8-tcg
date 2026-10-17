/**
 * The online lobby's services for the preview harness, against a scripted
 * server that never answers anything but the lobby's reads: the bundled
 * starter decks as the account's decks, a few players online, a ranked
 * standing in a running season, ranked entries priced by a one-product
 * listing, the season's jackpot and the auto list. Development only.
 *
 *   /tools/preview/?scene=casual                    the casual lobby
 *   /tools/preview/?scene=ranked                    the ranked lobby
 *   ...&entries=0                                   holding no ranked entries (default 3)
 *   ...&eligible=0                                  ranked not open yet
 *   ...&way=auto                                    the auto list in the ranked lobby
 *   ...&guide=1                                     the dialog on how ranked works
 *   ...&buy=1                                       the dialog that gets ranked entries
 */
import { ok } from "@magic8/engine/shared/Result.js";
import { AutoListService } from "../../src/application/auto/AutoListService.js";
import { deckMix } from "../../src/application/decks/deckMix.js";
import { EntryService } from "../../src/application/entries/EntryService.js";
import { LobbyService } from "../../src/application/lobby/LobbyService.js";
import { OnlineService } from "../../src/application/online/OnlineService.js";
import { RankingService } from "../../src/application/ranking/RankingService.js";

const SEASON = Object.freeze({ id: "season-1", name: "Season 1" });
const DAY = 86_400_000;
const PLAYERS = Object.freeze([
  { account: "verdu.green", status: "idle" },
  { account: "davvoz", status: "searching" },
  { account: "im-ridd", status: "playing" },
  { account: "alice", status: "idle" },
]);
/** The season's leaderboard: the stand-in account fourth. */
const LEADERBOARD = Object.freeze([
  { rank: 1, provisional: false, account: "alice", rating: 1700, games: 30, wins: 22, losses: 8, draws: 0 },
  { rank: 2, provisional: false, account: "davvoz", rating: 1650, games: 26, wins: 17, losses: 8, draws: 1 },
  { rank: 3, provisional: false, account: "verdu.green", rating: 1631, games: 19, wins: 12, losses: 7, draws: 0 },
  { rank: 4, provisional: false, account: "im-ridd", rating: 1612, games: 12, wins: 8, losses: 4, draws: 0 },
  { rank: null, provisional: true, account: "bob", rating: 1540, games: 3, wins: 2, losses: 1, draws: 0 },
]);
const RANKED_ENTRY = Object.freeze({ id: "ranked_entry", kind: "entry", name: "Ranked Entry", description: "One ranked game.", prices: [{ asset: "STEEM", amount: "1.000" }], contents: [{ type: "entry", ref: "ranked", count: 1 }], rarity: null, cards: 0, perOrder: 50 });

/**
 * @param {import("../../src/application/content/ContentService.js").GameContent} content
 * @param {{ entries: number, eligible: boolean }} options
 * @param {import("../../src/application/ports/Logger.contract.js").Logger} logger
 */
export function onlineServices(content, { entries, eligible }, logger) {
  const replies = /** @type {Record<string, (d: any) => unknown>} */ ({
    hello: () => ({ t: "welcome", d: { user: {}, serverTime: 0, activeGame: null, queue: { state: "idle" } } }),
    "lobby.list": () => ({ t: "lobby.players", d: { players: PLAYERS, challenges: { incoming: [], outgoing: null } } }),
    "auto.status": () => ({ t: "auto.status", d: { state: "idle", waiting: 2 } }),
  });
  const connection = {
    status: "open",
    connect: () => undefined,
    close: () => undefined,
    request: async (/** @type {string} */ t, /** @type {unknown} */ d) => ok(replies[t]?.(d) ?? { t: "ok", d: {} }),
    subscribe: () => () => undefined,
    onStatus: (/** @type {(status: string, details: unknown) => void} */ listener) => (listener("open", { code: null }), () => undefined),
  };
  const decks = content.preconDecks.slice(0, 4).map((deck) => Object.freeze({ id: deck.id, name: deck.name, mix: deckMix(content, deck.entries), totalCards: deck.totalCards, playable: true, problem: null }));
  const standing = eligible
    ? { season: SEASON, rating: 1612, deviation: 80, provisional: false, rank: 4, games: 12, wins: 8, losses: 4, draws: 0, eligible: true, casualGamesNeeded: 0, practiceGamesNeeded: 0 }
    : { season: SEASON, rating: 1500, deviation: 350, provisional: true, rank: null, games: 0, wins: 0, losses: 0, draws: 0, eligible: false, casualGamesNeeded: 2, practiceGamesNeeded: 2 };
  const now = Date.now();
  const jackpot = {
    season: { ...SEASON, startsAt: now - 8 * DAY, endsAt: now + 23 * DAY, status: "running" },
    bank: "verdu.green",
    asset: "STEEM",
    share: { numerator: 2, denominator: 3 },
    jackpot: "866.666",
    opening: "666.666",
    readAt: now,
    places: [
      { place: 1, percent: 65, amount: "563.332", account: "alice", rating: 1700, paid: null },
      { place: 2, percent: 25, amount: "216.666", account: "davvoz", rating: 1650, paid: null },
      { place: 3, percent: 10, amount: "86.668", account: null, rating: null, paid: null },
    ],
  };
  const quiet = () => () => undefined;
  return {
    online: new OnlineService({ connection, randomHex: (bytes) => "ab".repeat(bytes), newCommandId: () => crypto.randomUUID(), accountDecks: () => decks, logger }),
    lobby: new LobbyService({ connection, scheduler: { delay: () => new Promise(() => undefined) }, now: () => Date.now(), logger }),
    ranking: new RankingService({ api: { standing: async () => ok(standing), leaderboard: async () => ok({ season: SEASON, entries: LEADERBOARD }) } }),
    entries: new EntryService({ api: { entries: async () => ok([{ kind: "ranked", balance: entries, perGame: 1, season: SEASON.id }]) } }),
    shop: { state: { status: "ready", listing: { products: [RANKED_ENTRY] }, purchase: { stage: "none", order: null, txId: null, error: null, cart: null } }, subscribe: quiet, load: async () => undefined, dismiss: () => undefined, buy: async () => undefined },
    balance: { state: { loading: false, balances: [{ asset: "STEEM", amount: "12.500" }], error: null }, subscribe: quiet, refresh: async () => undefined, amountOf: () => "12.500", isShort: (/** @type {string} */ amount) => Number(amount) > 12.5 },
    jackpot: { state: { loading: false, loaded: true, jackpot, error: null }, subscribe: quiet, watch: quiet, now: () => Date.now() },
    autoList: new AutoListService({ connection, randomHex: (bytes) => "cd".repeat(bytes), logger }),
    account: { state: { status: "ready", account: "im-ridd", error: null }, subscribe: quiet },
  };
}
