/**
 * The application services handed to presentation scenes. Assembled once in
 * the composition root (main.js); scenes receive it read-only.
 *
 * @typedef {object} AppContext
 * @property {import("./content/ContentService.js").GameContent} content
 * @property {import("./decks/DeckSelectionService.js").DeckSelectionService} deckSelection
 * @property {import("./decks/DeckBuildingService.js").DeckBuildingService} deckBuilding
 * @property {import("./match/MatchSetupService.js").MatchSetupService} matchSetup
 * @property {() => string} createSeed
 * @property {import("./ports/Logger.contract.js").Logger} logger
 * @property {Readonly<{ version: string, storage: "local" | "memory" }>} environment
 * @property {import("./identity/IdentityService.js").IdentityService} [identity] absent when the client runs without a game server (tools, previews)
 * @property {import("./account/AccountService.js").AccountService} [account] the signed-in player's collection and decks; absent with `identity`
 * @property {import("./shop/ShopService.js").ShopService} [shop] the marketplace; absent with `identity`
 * @property {import("./online/OnlineService.js").OnlineService} [online] online games; absent with `identity`
 * @property {import("./ranking/RankingService.js").RankingService} [ranking] ranked standing and leaderboard; absent with `identity`
 * @property {import("./trading/TradingService.js").TradingService} [trading] card-for-card trades; absent with `identity`
 */

export const APP_CONTEXT_KEYS = Object.freeze(["content", "deckSelection", "deckBuilding", "matchSetup", "createSeed", "logger", "environment"]);
