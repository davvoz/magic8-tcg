/**
 * Registers every implemented scene. A scene that does not exist yet is
 * simply not registered, so menu buttons pointing at it stay disabled
 * instead of leading to a placeholder.
 */
import { DeckBuilderScene } from "./DeckBuilderScene.js";
import { DeckSelectionScene } from "./DeckSelectionScene.js";
import { ErrorScene } from "./ErrorScene.js";
import { LoginScene } from "./LoginScene.js";
import { MainMenuScene } from "./MainMenuScene.js";
import { MatchScene } from "./MatchScene.js";
import { SceneId } from "./sceneIds.js";

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
}
