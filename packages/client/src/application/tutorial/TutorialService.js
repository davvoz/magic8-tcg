/**
 * Use case: start the tutorial. A practice match like any other, set up so
 * the lesson always plays the same way: both decks dealt in their written
 * order, the player first (no coin toss), a short game (TUTORIAL_LIFE), and
 * an opponent that follows the script (ScriptedAiController). With it comes
 * the coach that walks the player through it (TutorialCoach). Needs no
 * game server and no cards of the player's own.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { GameRules } from "@magic8/engine/domain/game/GameRules.js";
import { humanController } from "../match/HumanController.js";
import { ScriptedAiController } from "../match/ScriptedAiController.js";
import { TutorialCoach } from "./TutorialCoach.js";
import { OPPONENT_DECK, OPPONENT_SCRIPT, PLAYER_DECK, TUTORIAL_LIFE, TUTORIAL_SEATS, TUTORIAL_STEPS } from "./tutorialScript.js";

/** The seed only draws what the script leaves to chance (none of it, as written); any fixed one will do. */
const SEED = 1;

/**
 * @typedef {Readonly<{ session: import("../match/MatchSession.js").MatchSession, coach: TutorialCoach }>} Tutorial
 */

export class TutorialService {
  #matchSetup;
  #content;

  /**
   * @param {{ matchSetup: import("../match/MatchSetupService.js").MatchSetupService, content: import("../content/ContentService.js").GameContent }} deps
   */
  constructor({ matchSetup, content }) {
    this.#matchSetup = matchSetup;
    this.#content = content;
  }

  /**
   * @param {{ aiDelayMs?: number }} [options] `aiDelayMs`: how long the opponent takes over each move
   * @returns {import("@magic8/engine/shared/Result.js").Ok<Tutorial> | import("@magic8/engine/shared/Result.js").Fail}
   */
  start({ aiDelayMs = 0 } = {}) {
    const created = this.#matchSetup.createMatch({
      seats: [
        { ...TUTORIAL_SEATS.player, deckList: PLAYER_DECK, controller: humanController },
        { ...TUTORIAL_SEATS.opponent, deckList: OPPONENT_DECK, controller: new ScriptedAiController({ script: OPPONENT_SCRIPT }) },
      ],
      seed: SEED,
      aiDelayMs,
      shuffle: false,
      rules: new GameRules({ ...this.#content.gameRules, startingLife: TUTORIAL_LIFE }),
    });
    if (!created.ok) {
      return fail(created.error.code, `the tutorial could not be set up: ${created.error.message}`, created.error.details);
    }
    return ok(Object.freeze({ session: created.value, coach: new TutorialCoach({ steps: TUTORIAL_STEPS, playerId: TUTORIAL_SEATS.player.id }) }));
  }
}
