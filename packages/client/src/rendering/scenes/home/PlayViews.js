/**
 * What the screens that offer play (Home, Play) show of each way to play,
 * read from the services: today's challenge, online play, the ranked
 * season, the tutorial. Each says what can be done now, or why it cannot:
 * no game server, not signed in, not open yet. The cards draw what it says.
 */
import { AccountStatus } from "../../../application/account/AccountService.js";
import { IdentityStatus } from "../../../application/identity/IdentityService.js";
import { Milestone } from "../../../application/onboarding/OnboardingProgress.js";
import { jackpotAmountText } from "../online/rankedGuideFor.js";
import { SceneId } from "../sceneIds.js";

/** Why what needs the game server is locked. */
export const OFFLINE_REASON = "Not available offline.";
const MINUTE = 60_000;
/**
 * What today's challenge shows.
 * @typedef {Readonly<{ kind: "locked", reason: string }>
 *   | Readonly<{ kind: "waiting", text: string }>
 *   | Readonly<{ kind: "next", opponent: import("../../../application/ports/DailyApi.contract.js").DailyOpponent, stage: number }>
 *   | Readonly<{ kind: "done", renewsIn: string }>} ChallengeView
 *   `waiting`: the day not read yet (or not readable): the challenges still open, and say more
 */
/**
 * What online play shows.
 * @typedef {Readonly<{ kind: "locked", reason: string }> | Readonly<{ kind: "open", rankedLock: string | null, note: string | null }>} OnlineView
 *   `rankedLock`: why ranked is not open yet (null: it is)
 */
/**
 * What ranked play asks of the player, as the choice between casual and ranked says it.
 * @typedef {Readonly<{ lock: string | null, entries: Readonly<{ held: number, perGame: number }> | null, jackpot: string | null }>} RankedView
 *   `lock`: why it is not open yet (null: it is, or not known yet); `entries`: what the player holds and a game takes (null:
 *   free, or not known yet); `jackpot`: what the season's jackpot holds ("866.666 STEEM"), when known
 */

/** Who stands for the challenges before today's opponents are known: the Archmage, veiled. */
const STAND_IN_CHALLENGER = Object.freeze({ id: "archmage", name: "The Archmage", faction: "arcane", boss: false, state: /** @type {const} */ ("locked") });

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

  /** @returns {ChallengeView} */
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

  /**
   * The character that stands for today's challenge: the next opponent to beat; once the day is won, its boss; before
   * the day is known (signed out, offline, still reading), the Archmage, veiled.
   * @param {ChallengeView} view
   * @returns {import("../daily/CharacterPortrait.js").PortraitCharacter}
   */
  challenger(view) {
    if (view.kind === "next") {
      return view.opponent;
    }
    const boss = view.kind === "done" ? (this.#app.daily?.state.day?.opponents.at(-1) ?? null) : null;
    return boss ?? STAND_IN_CHALLENGER;
  }

  /** @returns {OnlineView} */
  online() {
    if (!this.server || this.#app.online === undefined || !this.#hasScene(SceneId.CASUAL)) {
      return { kind: "locked", reason: OFFLINE_REASON };
    }
    if (!this.signedIn) {
      return { kind: "locked", reason: "Sign in to play online." };
    }
    const standing = this.#app.ranking?.state.standing ?? null;
    if (standing === null) {
      return { kind: "open", rankedLock: null, note: null };
    }
    const lock = rankedLock(standing);
    return { kind: "open", rankedLock: lock, note: lock === null ? "Ranked games count for the season." : null };
  }

  /** @returns {RankedView} */
  ranked() {
    const standing = this.#app.ranking?.state.standing ?? null;
    const ranked = this.#app.entries?.ranked ?? null;
    return {
      lock: standing === null ? null : rankedLock(standing),
      entries: ranked === null || ranked.perGame === 0 ? null : { held: ranked.balance, perGame: ranked.perGame },
      jackpot: jackpotAmountText(this.#app, this.#now()),
    };
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
    const mine = this.signedIn ? { standing: standingLine(standing, error), figures: figuresOf(standing) } : { standing: "Sign in to take part in the season.", figures: null };
    return { kind: "open", season, jackpot: jackpot?.state.jackpot ?? null, now: () => jackpot?.now() ?? this.#now(), ...mine };
  }
}

/**
 * The player's season in figures: their standing, once they may play ranked in a running season; else null.
 * @param {import("../../../application/ports/RankingApi.contract.js").Standing | null} standing
 */
function figuresOf(standing) {
  return standing !== null && standing.season !== null && standing.eligible ? standing : null;
}

/**
 * Why ranked play is not open to the player yet; null when it is.
 * @param {import("../../../application/ports/RankingApi.contract.js").Standing} standing
 */
function rankedLock(standing) {
  if (standing.season === null) {
    return "No ranked season is running.";
  }
  if (!standing.eligible) {
    const games = standing.casualGamesNeeded;
    return `Ranked opens after ${games} more casual game${games === 1 ? "" : "s"}.`;
  }
  return null;
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
  if (standing.provisional || standing.rank === null) {
    return `You: provisional · rating ${standing.rating}`;
  }
  const decay = standing.decay ?? null;
  const warning = decay !== null && !decay.safe ? ` · play ranked today or −${decay.points}` : "";
  return `You: #${standing.rank} · rating ${standing.rating}${warning}`;
}

/** "4h 12m" @param {number} ms */
function timeLeft(ms) {
  const left = Math.max(0, ms);
  const hours = Math.floor(left / (60 * MINUTE));
  const minutes = Math.floor((left % (60 * MINUTE)) / MINUTE);
  return `${hours}h ${minutes}m`;
}
