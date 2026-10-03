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
 * @property {Readonly<{ version: string, release?: string, storage: "local" | "memory" }>} environment `version` the engine's; `release` the game's ("v0.2.0 (0253e2b)"), absent in tools and previews
 * @property {import("./identity/IdentityService.js").IdentityService} [identity] absent when the client runs without a game server (tools, previews)
 * @property {import("./account/AccountService.js").AccountService} [account] the signed-in player's collection and decks; absent with `identity`
 * @property {import("./shop/ShopService.js").ShopService} [shop] the marketplace; absent with `identity`
 * @property {import("./wallet/BalanceService.js").BalanceService} [balance] what the player's wallet holds, their budget where they buy; absent with `identity`
 * @property {import("./wallet/ActiveKeyPrompt.js").ActiveKeyPrompt} [activeKeys] asks for the active key a payment needs, when the player signs with their own keys; absent with `identity`
 * @property {import("./online/OnlineService.js").OnlineService} [online] online games; absent with `identity`
 * @property {import("./lobby/LobbyService.js").LobbyService} [lobby] who else is online, and challenges between players; absent with `identity`
 * @property {import("./ranking/RankingService.js").RankingService} [ranking] ranked standing and leaderboard; absent with `identity`
 * @property {import("./ports/GameHistoryApi.contract.js").GameHistoryApi} [gameHistory] the games a player has played (public, by account); absent with `identity`
 * @property {import("./jackpot/JackpotService.js").JackpotService} [jackpot] the ranked season's jackpot (public); absent with `identity`
 * @property {import("./entries/EntryService.js").EntryService} [entries] the player's ranked entries, and what a ranked game costs; absent with `identity`
 * @property {import("./trading/TradingService.js").TradingService} [trading] card-for-card trades; absent with `identity`
 * @property {import("./sales/SalesService.js").SalesService} [sales] the player market (copies sold for STEEM); absent with `identity`
 * @property {import("./notifications/NotificationService.js").NotificationService} [notifications] the player's notification feed; absent with `identity`
 * @property {import("./content/CardRarities.js").CardRarities} [rarities] how rare each card is; absent when the rarities file could not be read
 * @property {import("./audio/AudioService.js").AudioService} [audio] the game's sound and its settings; absent in tools and previews
 */

export const APP_CONTEXT_KEYS = Object.freeze(["content", "deckSelection", "deckBuilding", "matchSetup", "createSeed", "logger", "environment"]);
