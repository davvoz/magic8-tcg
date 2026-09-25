/**
 * Registers every implemented scene. A scene that does not exist yet is
 * simply not registered, so menu buttons pointing at it stay disabled
 * instead of leading to a placeholder. The account scenes (starter deck,
 * collection) need a game server and exist only when the app has one.
 */
import { CollectionScene } from "./CollectionScene.js";
import { DeckBuilderScene } from "./DeckBuilderScene.js";
import { DeckSelectionScene } from "./DeckSelectionScene.js";
import { ErrorScene } from "./ErrorScene.js";
import { LeaderboardScene } from "./LeaderboardScene.js";
import { LiveGamesScene } from "./LiveGamesScene.js";
import { LoginScene } from "./LoginScene.js";
import { MainMenuScene } from "./MainMenuScene.js";
import { MatchScene } from "./MatchScene.js";
import { OnlineScene } from "./OnlineScene.js";
import { SceneId } from "./sceneIds.js";
import { ShopScene } from "./ShopScene.js";
import { StarterScene } from "./StarterScene.js";
import { TradesScene } from "./TradesScene.js";

/**
 * @param {import("./SceneManager.js").SceneManager} sceneManager
 * @param {import("../../application/AppContext.js").AppContext} app
 */
export function registerScenes(sceneManager, app) {
  sceneManager
    .register(SceneId.MAIN_MENU, (services) => new MainMenuScene(services, app))
    .register(SceneId.DECK_SELECTION, (services) => new DeckSelectionScene(services, app))
    .register(SceneId.DECK_BUILDER, (services) => new DeckBuilderScene(services, app))
    .register(SceneId.MATCH, (services) => new MatchScene(services))
    .register(SceneId.LOGIN, (services) => new LoginScene(services, app))
    .register(SceneId.ERROR, (services) => new ErrorScene(services));
  if (app.account !== undefined) {
    sceneManager
      .register(SceneId.STARTER, (services) => new StarterScene(services, app))
      .register(SceneId.COLLECTION, (services) => new CollectionScene(services, app));
  }
  if (app.online !== undefined) {
    sceneManager.register(SceneId.ONLINE, (services) => new OnlineScene(services, app));
  }
  if (app.online?.canWatch === true) {
    sceneManager.register(SceneId.LIVE_GAMES, (services) => new LiveGamesScene(services, app));
  }
  if (app.ranking !== undefined) {
    sceneManager.register(SceneId.LEADERBOARD, (services) => new LeaderboardScene(services, app));
  }
  if (app.trading !== undefined && app.account !== undefined) {
    sceneManager.register(SceneId.TRADES, (services) => new TradesScene(services, app));
  }
  if (app.shop !== undefined) {
    sceneManager.register(SceneId.SHOP, (services) => new ShopScene(services, app));
  }
}
