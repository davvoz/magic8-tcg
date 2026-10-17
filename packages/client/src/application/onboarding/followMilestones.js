/**
 * Notes the first-time guide's milestones as the player reaches them, on
 * any screen: a tutorial won, a daily challenge won (the day's run shows it,
 * even one won on another device today), an online game finished (not a
 * challenge: those are games against the server's characters).
 */
import { OnlineStatus } from "../online/OnlineService.js";
import { Milestone } from "./OnboardingProgress.js";

/** The mode of the daily challenges' games, which are online games too. */
const DAILY_MODE = "daily";

/**
 * @param {{
 *   progress: import("./OnboardingProgress.js").OnboardingProgress,
 *   identity?: { state: { user: { account: string } | null }, subscribe: (listener: () => void) => () => void },
 *   tutorial?: { onCompleted: (listener: () => void) => () => void },
 *   daily?: { state: import("../daily/DailyService.js").DailyState, subscribe: (listener: () => void) => () => void },
 *   online?: { state: import("../online/OnlineService.js").OnlineState, subscribe: (listener: () => void) => () => void },
 * }} sources each one absent where the game has none (offline: only the tutorial)
 * @returns {() => void} stops following
 */
export function followMilestones({ progress, identity, tutorial, daily, online }) {
  const account = () => identity?.state.user?.account ?? null;
  const checkDaily = () => {
    const run = daily?.state.day?.run ?? null;
    if (run !== null && (run.stage > 0 || run.rewarded)) {
      progress.reach(Milestone.CHALLENGE, account());
    }
  };
  const checkOnline = () => {
    const state = online?.state;
    if (state?.status === OnlineStatus.OVER && state.mode !== DAILY_MODE) {
      progress.reach(Milestone.ONLINE, account());
    }
  };
  const stops = [
    tutorial?.onCompleted(() => progress.reach(Milestone.TUTORIAL)),
    daily?.subscribe(checkDaily),
    online?.subscribe(checkOnline),
    // The day read before the account was known counts once it is.
    identity?.subscribe(checkDaily),
  ];
  checkDaily();
  return () => stops.forEach((stop) => stop?.());
}
