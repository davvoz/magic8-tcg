/**
 * What the screens that offer play (Home, Play) show of each way to play,
 * read from the services: today's challenge, online play, the ranked
 * season, the tutorial. Each says what can be done now, or why it cannot:
 * no game server, not signed in, not open yet. The cards draw what it says.
 */
import { AccountStatus } from "../../../application/account/AccountService.js";
import { IdentityStatus } from "../../../application/identity/IdentityService.js";
import { Milestone } from "../../../application/onboarding/OnboardingProgress.js";
import { SceneId } from "../sceneIds.js";

/** Why what needs the game server is locked. */
export const OFFLINE_REASON = "Not available offline.";
const MINUTE = 60_000;

export class PlayViews {
  #app;
  #hasScene;
  #now;

  /**
   * @param {{ app: import("../../../application/AppContext.js").AppContext, hasScene: (sceneId: string) => boolean, now: () => number }} deps
   */
  constructor({ app, hasScene, now }) {
    this.#app = app;
    this.#hasScene = hasScene;
    this.#now = now;
  }

  /** Whether the player is signed in and their account is loaded. */
  get signedIn() {
    return this.#app.account?.state.status === AccountStatus.READY;
  }

  /** Whether there is a game server (offline, only what plays in the browser is here). */
  get server() {
    const status = this.#app.identity?.state.status;
    return status !== undefined && status !== IdentityStatus.OFFLINE;
  }

  /** Whether the player has played the tutorial to its end, in this browser. */
  get tutorialDone() {
    return this.#app.onboarding?.has(Milestone.TUTORIAL, null) === true;
  }

  /** @returns {import("./ChallengeCard.js").ChallengeView} */
  challenge() {
    const daily = this.#app.daily;
    if (!this.server || daily === undefined || this.#app.online === undefined || !this.#hasScene(SceneId.DAILY)) {
      return { kind: "locked", reason: OFFLINE_REASON };
    }
    if (!this.signedIn) {
      return { kind: "locked", reason: "Sign in to take on the challenges." };
    }
    const { day, loading, error } = daily.state;
    if (day === null) {
      return { kind: "waiting", text: loading || error === null ? "Reading today's opponents…" : "Today's opponents could not be read: open the challenges to try again." };
    }
    const next = daily.next;
    if (day.run?.rewarded === true || next === null) {
      return { kind: "done", renewsIn: timeLeft(day.endsAt - this.#now()) };
    }
    return { kind: "next", opponent: next, stage: day.opponents.indexOf(next) };
  }

  /** @returns {import("./OnlineCard.js").OnlineView} */
  online() {
    if (!this.server || this.#app.online === undefined || !this.#hasScene(SceneId.ONLINE)) {
      return { kind: "locked", reason: OFFLINE_REASON };
    }
    if (!this.signedIn) {
      return { kind: "locked", reason: "Sign in to play online." };
    }
    const standing = this.#app.ranking?.state.standing ?? null;
    if (standing === null) {
      return { kind: "open", rankedLock: null, note: null };
    }
    if (standing.season === null) {
      return { kind: "open", rankedLock: "No ranked season is running.", note: null };
    }
    if (!standing.eligible) {
      const games = standing.casualGamesNeeded;
      return { kind: "open", rankedLock: `Ranked opens after ${games} more casual game${games === 1 ? "" : "s"}.`, note: null };
    }
    return { kind: "open", rankedLock: null, note: "Ranked games count for the season." };
  }

  /** @returns {import("./SeasonCard.js").SeasonView} */
  season() {
    const ranking = this.#app.ranking;
    if (!this.server || ranking === undefined) {
      return { kind: "locked", reason: OFFLINE_REASON };
    }
    const jackpot = this.#app.jackpot;
    const { standing, error } = ranking.state;
    const season = standing?.season?.name ?? jackpot?.state.jackpot?.season.name ?? null;
    return { kind: "open", season, jackpot: jackpot?.state.jackpot ?? null, now: () => jackpot?.now() ?? this.#now(), standing: this.signedIn ? standingLine(standing, error) : "Sign in to take part in the season." };
  }
}

/**
 * Where the player stands, in a line.
 * @param {import("../../../application/ports/RankingApi.contract.js").Standing | null} standing
 * @param {string | null} error
 */
function standingLine(standing, error) {
  if (standing === null) {
    return error === null ? "Reading your standing…" : "Your standing could not be read.";
  }
  if (standing.season === null) {
    return "No ranked season is running.";
  }
  if (standing.games === 0) {
    return "You: not ranked yet";
  }
  return standing.provisional || standing.rank === null ? `You: provisional · rating ${standing.rating}` : `You: #${standing.rank} · rating ${standing.rating}`;
}

/** "4h 12m" @param {number} ms */
function timeLeft(ms) {
  const left = Math.max(0, ms);
  const hours = Math.floor(left / (60 * MINUTE));
  const minutes = Math.floor((left % (60 * MINUTE)) / MINUTE);
  return `${hours}h ${minutes}m`;
}
