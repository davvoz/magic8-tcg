/**
 * Starts the tutorial and opens its board, from wherever it is offered (the
 * main menu, the Info screen). Once it is won, the next step offered is a
 * practice match: "Practice vs AI" leads to deck selection.
 */
import { SceneId } from "./sceneIds.js";

/**
 * @param {import("./Scene.js").SceneServices} services
 * @param {import("../../application/tutorial/TutorialService.js").TutorialService} tutorial
 */
export function startTutorial(services, tutorial) {
  const started = tutorial.start({ aiDelayMs: services.theme.animation.mediumMs });
  if (!started.ok) {
    services.logger.error("tutorial setup failed", started.error);
    return;
  }
  services.navigate(SceneId.MATCH, { session: started.value.session, coach: started.value.coach, againScene: SceneId.DECK_SELECTION });
}
