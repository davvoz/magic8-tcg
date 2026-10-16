/**
 * The screen the game opens on, and that signing in or out leads to: Home,
 * or the old main menu where Home is not registered (tools, previews).
 */
import { SceneId } from "./sceneIds.js";

/**
 * @param {(sceneId: string) => boolean} hasScene
 * @returns {string}
 */
export function landingScene(hasScene) {
  return hasScene(SceneId.HOME) ? SceneId.HOME : SceneId.MAIN_MENU;
}
