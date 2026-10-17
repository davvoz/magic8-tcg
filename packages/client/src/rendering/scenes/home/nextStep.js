/**
 * What the Home screen's guide says of each step (OnboardingGuide), in the
 * player's words, and what its button does: the step itself, or signing in
 * first when the step needs an account.
 */
import { GuideStep } from "../../../application/onboarding/OnboardingGuide.js";
import { SceneId } from "../sceneIds.js";

/** The steps' short names, on the guide's track. */
export const STEP_NAMES = Object.freeze({
  [GuideStep.TUTORIAL]: "Tutorial",
  [GuideStep.STARTER]: "Starter deck",
  [GuideStep.CHALLENGE]: "First challenge",
  [GuideStep.ONLINE]: "First online game",
  [GuideStep.RANKED]: "Ranked",
});

/**
 * What the guide's button does: open a screen, or start the tutorial.
 * @typedef {Readonly<{ text: string, scene: string, params?: Readonly<Record<string, unknown>> }> | Readonly<{ text: string, tutorial: true }>} StepAction
 * @typedef {Readonly<{ title: string, text: string, action: StepAction }>} StepCopy
 */

/** Signing in, before a step that needs an account. */
const SIGN_IN = Object.freeze({ text: "Sign in", scene: SceneId.LOGIN });

/**
 * @param {string} step one of GuideStep
 * @param {{ signedIn: boolean, standing: import("../../../application/ports/RankingApi.contract.js").Standing | null }} facts
 * @returns {StepCopy}
 */
export function stepCopy(step, { signedIn, standing }) {
  switch (step) {
    case GuideStep.TUTORIAL:
      return { title: "Learn the game in a few minutes", text: "A guided game against a trainer: the rules, one at a time.", action: { text: "Start the tutorial", tutorial: true } };
    case GuideStep.STARTER:
      return signedIn
        ? { title: "Take your free starter deck", text: "Choose one of the faction decks: its cards become yours, ready to play.", action: { text: "Choose your deck", scene: SceneId.STARTER } }
        : { title: "Take your free starter deck", text: "Sign in with your Steem account: the starter deck is free, once per account.", action: SIGN_IN };
    case GuideStep.CHALLENGE:
      return withAccount(signedIn, { title: "Win your first daily challenge", text: "Beat today's first opponent with your deck. Win all three for a pack of cards.", action: { text: "Play the challenge", scene: SceneId.DAILY } });
    case GuideStep.ONLINE:
      return withAccount(signedIn, { title: "Play your first online game", text: "A casual game against a real player: no rating at stake, just the game.", action: { text: "Play casual", scene: SceneId.ONLINE, params: { mode: "casual" } } });
    default:
      return withAccount(signedIn, rankedCopy(standing));
  }
}

/**
 * The ranked step: once ranked play is open, a ranked game; until then, the casual games it waits for.
 * @param {import("../../../application/ports/RankingApi.contract.js").Standing | null} standing
 * @returns {StepCopy}
 */
function rankedCopy(standing) {
  if (standing !== null && !standing.eligible) {
    const games = standing.casualGamesNeeded;
    return { title: "Play a ranked game", text: `Ranked opens after ${games} more casual game${games === 1 ? "" : "s"}: play them first.`, action: { text: "Play casual", scene: SceneId.ONLINE, params: { mode: "casual" } } };
  }
  return { title: "Play a ranked game", text: "Climb the season's leaderboard: the best players share the jackpot.", action: { text: "Play ranked", scene: SceneId.ONLINE, params: { mode: "ranked" } } };
}

/**
 * A step that needs an account: signing in first when there is none.
 * @param {boolean} signedIn
 * @param {StepCopy} copy
 * @returns {StepCopy}
 */
function withAccount(signedIn, copy) {
  return signedIn ? copy : { ...copy, text: "Sign in with your Steem account to take this step.", action: SIGN_IN };
}
