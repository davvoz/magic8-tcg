/**
 * Registers every implemented scene. A scene that does not exist yet is
 * simply not registered, so menu buttons pointing at it stay disabled
 * instead of leading to a placeholder. The account scenes (starter deck,
 * collection) need a game server and exist only when the app has one.
 */
import { nextStepAfter } from "../../application/daily/characters.js";
import { CollectionScene } from "./CollectionScene.js";
import { DailyScene } from "./DailyScene.js";
import { DeckBuilderScene } from "./DeckBuilderScene.js";
import { DeckSelectionScene } from "./DeckSelectionScene.js";
import { DecksScene } from "./DecksScene.js";
import { ErrorScene } from "./ErrorScene.js";
import { GameHistoryScene } from "./GameHistoryScene.js";
import { HomeScene } from "./HomeScene.js";
import { PlayScene } from "./PlayScene.js";
import { InfoScene } from "./InfoScene.js";
import { LiveGamesScene } from "./LiveGamesScene.js";
import { LoginScene } from "./LoginScene.js";
import { MarketScene } from "./MarketScene.js";
import { MatchScene } from "./MatchScene.js";
import { NotificationsScene } from "./NotificationsScene.js";
import { OnlineScene } from "./OnlineScene.js";
import { ReplayScene } from "./ReplayScene.js";
import { SceneId } from "./sceneIds.js";
import { SeasonScene } from "./SeasonScene.js";
import { ShopScene } from "./ShopScene.js";
import { StarterScene } from "./StarterScene.js";
import { TradesScene } from "./TradesScene.js";

/**
 * @param {import("./SceneManager.js").SceneManager} sceneManager
 * @param {import("../../application/AppContext.js").AppContext} app
 */
export function registerScenes(sceneManager, app) {
  sceneManager
    .register(SceneId.HOME, (services) => new HomeScene(services, app))
    .register(SceneId.PLAY, (services) => new PlayScene(services, app))
    .register(SceneId.DECK_SELECTION, (services) => new DeckSelectionScene(services, app))
    .register(SceneId.DECKS, (services) => new DecksScene(services, app))
    .register(SceneId.DECK_BUILDER, (services) => new DeckBuilderScene(services, app))
    .register(SceneId.MATCH, (services) => new MatchScene(services, { rarityOf: (cardId) => app.rarities?.of(cardId) ?? null, audio: app.audio, help: app.help, characterName: (account) => app.daily?.characterOf(account)?.name ?? null, challengeStep: (account, outcome) => challengeStep(app, account, outcome), voice: app.voice, sharing: app.sharing }))
    .register(SceneId.LOGIN, (services) => new LoginScene(services, app))
    .register(SceneId.INFO, (services) => new InfoScene(services, app))
    .register(SceneId.ERROR, (services) => new ErrorScene(services));
  if (app.account !== undefined) {
    sceneManager
      .register(SceneId.STARTER, (services) => new StarterScene(services, app))
      .register(SceneId.COLLECTION, (services) => new CollectionScene(services, app));
  }
  registerOnlineScenes(sceneManager, app);
  if (app.ranking !== undefined) {
    sceneManager.register(SceneId.SEASON, (services) => new SeasonScene(services, app));
  }
  if (app.gameHistory !== undefined) {
    sceneManager.register(SceneId.GAME_HISTORY, (services) => new GameHistoryScene(services, app));
  }
  if (app.trading !== undefined && app.account !== undefined) {
    sceneManager.register(SceneId.TRADES, (services) => new TradesScene(services, app));
  }
  if (app.shop !== undefined) {
    sceneManager.register(SceneId.SHOP, (services) => new ShopScene(services, app));
  }
  if (app.sales !== undefined) {
    sceneManager.register(SceneId.MARKET, (services) => new MarketScene(services, app));
  }
  if (app.notifications !== undefined) {
    sceneManager.register(SceneId.NOTIFICATIONS, (services) => new NotificationsScene(services, app));
  }
}

/**
 * The screens of online play: the lobby, the games to watch, the replays of auto games.
 * @param {import("./SceneManager.js").SceneManager} sceneManager
 * @param {import("../../application/AppContext.js").AppContext} app
 */
function registerOnlineScenes(sceneManager, app) {
  if (app.online !== undefined) {
    sceneManager.register(SceneId.ONLINE, (services) => new OnlineScene(services, app));
  }
  if (app.online !== undefined && app.daily !== undefined) {
    sceneManager.register(SceneId.DAILY, (services) => new DailyScene(services, app));
  }
  if (app.online?.canWatch === true) {
    sceneManager.register(SceneId.LIVE_GAMES, (services) => new LiveGamesScene(services, app));
  }
  if (app.autoReplays !== undefined) {
    sceneManager.register(SceneId.REPLAY, (services) => new ReplayScene(services, app));
  }
}

/**
 * After a daily challenge, what going back to the challenges offers; null when the opponent was no character of the day.
 * @param {import("../../application/AppContext.js").AppContext} app
 * @param {string} account the opponent's seat
 * @param {"win" | "loss" | "draw"} outcome the player's
 */
function challengeStep(app, account, outcome) {
  const opponent = app.daily?.characterOf(account) ?? null;
  return opponent === null ? null : nextStepAfter(outcome, opponent.boss);
}
