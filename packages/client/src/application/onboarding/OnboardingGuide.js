/**
 * The first-time guide: five steps from a new player to the season — the
 * tutorial, the free starter deck, a first daily challenge won, a first
 * online game, a ranked game — and the one to take next. What only this
 * browser can know comes from OnboardingProgress; the starter deck from the
 * account, ranked play from the ranked standing. A step counts as done when
 * any step after it is (a player who plays ranked knows the rules), so a
 * player who has come further on another device is not sent back.
 *
 * The guide is over once every step is done, or once the player hid it.
 */
import { Milestone } from "./OnboardingProgress.js";

export const GuideStep = Object.freeze({
  TUTORIAL: "tutorial",
  STARTER: "starter",
  CHALLENGE: "challenge",
  ONLINE: "online",
  RANKED: "ranked",
});

/** The steps, in the order a player takes them. */
export const GUIDE_STEPS = Object.freeze([GuideStep.TUTORIAL, GuideStep.STARTER, GuideStep.CHALLENGE, GuideStep.ONLINE, GuideStep.RANKED]);

/**
 * What the guide looks at besides the progress kept here.
 * @typedef {Readonly<{
 *   server: boolean,
 *   account: string | null,
 *   needsStarter: boolean,
 *   standing: import("../ports/RankingApi.contract.js").Standing | null,
 * }>} GuideFacts `server`: whether there is a game server (offline, only the tutorial can be taken); `account`: the signed-in
 *   player's, once their account is loaded (null otherwise); `standing`: their ranked standing, once read
 * @typedef {Readonly<{ id: string, done: boolean }>} GuideEntry
 * @typedef {Readonly<{ steps: readonly GuideEntry[], current: string | null, number: number, shown: boolean }>} Guide
 *   `current`: the step to take next (null: all done); `number`: its place, from 1; `shown`: whether the guide is on show
 */

/**
 * @param {Pick<import("./OnboardingProgress.js").OnboardingProgress, "has" | "dismissed">} progress
 * @param {GuideFacts} facts
 * @returns {Guide}
 */
export function guideFor(progress, facts) {
  const own = GUIDE_STEPS.map((step) => doneOnItsOwn(step, progress, facts));
  const steps = GUIDE_STEPS.map((id, index) => Object.freeze({ id, done: own.slice(index).some(Boolean) }));
  const next = steps.findIndex((step) => !step.done);
  const current = next === -1 ? null : steps[next].id;
  // Offline, nothing after the tutorial can be taken: the guide has nothing to offer once it is played.
  const reachable = current !== null && (facts.server || current === GuideStep.TUTORIAL);
  return Object.freeze({ steps: Object.freeze(steps), current, number: next + 1, shown: reachable && !progress.dismissed });
}

/**
 * @param {string} step
 * @param {Pick<import("./OnboardingProgress.js").OnboardingProgress, "has">} progress
 * @param {GuideFacts} facts
 */
function doneOnItsOwn(step, progress, { account, needsStarter, standing }) {
  const rankedGames = standing?.games ?? 0;
  switch (step) {
    case GuideStep.TUTORIAL:
      return progress.has(Milestone.TUTORIAL, account);
    case GuideStep.STARTER:
      return account !== null && !needsStarter;
    case GuideStep.CHALLENGE:
      return progress.has(Milestone.CHALLENGE, account);
    case GuideStep.ONLINE:
      return progress.has(Milestone.ONLINE, account);
    default:
      return rankedGames > 0;
  }
}
