/**
 * What the two online lobbies (Casual and Ranked) say, and what the screens
 * that speak of ranked play (Season) share with them: the game's status,
 * what a player online is doing, the player's ranked standing, and which
 * lobby a game or a challenge belongs to.
 */
import { ChallengeMode, PlayerActivity } from "../../../application/lobby/LobbyService.js";
import { OnlineStatus } from "../../../application/online/OnlineService.js";
import { SceneId } from "../sceneIds.js";

/** What a lobby says in each state, when nothing is going on of its own (`idle`: the lobby's own words). */
export const STATUS_TEXT = Object.freeze({
  [OnlineStatus.OFFLINE]: () => "Not connected to the game server. Reconnecting…",
  [OnlineStatus.CONNECTING]: () => "Connecting to the game server…",
  [OnlineStatus.SEARCHING]: (/** @type {import("../../../application/online/OnlineService.js").OnlineState} */ state) => state.notice ?? "Looking for an opponent…",
  [OnlineStatus.MATCHED]: (/** @type {import("../../../application/online/OnlineService.js").OnlineState} */ state) => matchedText(state),
  [OnlineStatus.PLAYING]: (/** @type {import("../../../application/online/OnlineService.js").OnlineState} */ state) => `Your game against @${state.opponent ?? "?"} is in progress.`,
  [OnlineStatus.OVER]: () => "The game is over.",
  [OnlineStatus.CANCELLED]: () => "The game was cancelled before it started.",
});

/** What a player online is doing, as their row says it. */
export const ACTIVITY_TEXT = Object.freeze({
  [PlayerActivity.IDLE]: "Ready to play · click to challenge",
  [PlayerActivity.SEARCHING]: "Looking for a match · click to challenge",
  [PlayerActivity.PLAYING]: "In a game",
});

/** @param {string} mode one of ChallengeMode */
export function modeName(mode) {
  return mode === ChallengeMode.RANKED ? "Ranked" : "Casual";
}

/**
 * "Casual game · 0:42 to answer" ("Casual · 0:42 left" in short): a challenge received, with the time left to answer it.
 * @param {string} mode one of ChallengeMode
 * @param {number} seconds
 * @param {{ short?: boolean }} [options]
 */
export function answerTimeText(mode, seconds, { short = false } = {}) {
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return short ? `${modeName(mode)} · ${clock} left` : `${modeName(mode)} game · ${clock} to answer`;
}

/**
 * The lobby a game or a challenge of this mode belongs to: Ranked for ranked ones, the challenges' screen for theirs,
 * Casual for any other (and when the mode is not known).
 * @param {string | null | undefined} mode "casual", "ranked", "daily"
 */
export function lobbyOf(mode) {
  if (mode === ChallengeMode.RANKED) {
    return SceneId.RANKED;
  }
  return mode === "daily" ? SceneId.DAILY : SceneId.CASUAL;
}

/**
 * The lobby once an opponent is found: in v2, who has accepted the game with
 * Keychain so far (it starts only when both have); in v1, the shuffle.
 * @param {import("../../../application/online/OnlineService.js").OnlineState} state
 */
export function matchedText(state) {
  const opponent = `@${state.opponent ?? "?"}`;
  const acceptance = state.acceptance;
  if (acceptance === null) {
    return `Opponent found: ${opponent}. Shuffling with both players' randomness…`;
  }
  const you = acceptance.you ? "you have accepted" : "accept it in Keychain";
  const them = acceptance.opponent ? `${opponent} has accepted` : `waiting for ${opponent}`;
  return `Opponent found: ${opponent}. The game starts once both of you sign it with Keychain: ${you}, ${them}.`;
}

/**
 * One line about the player's ranked standing.
 * @param {import("../../../application/ranking/RankingService.js").RankingState} state
 */
export function standingText(state) {
  const standing = state.standing;
  if (standing === null) {
    return state.error === null ? "Loading your ranked standing…" : `Ranked standing unavailable: ${state.error}`;
  }
  if (standing.season === null) {
    return "No ranked season is running.";
  }
  if (!standing.eligible) {
    const practice = standing.practiceGamesNeeded > 0 ? `, or ${standing.practiceGamesNeeded} more practice game(s) vs AI` : "";
    return `Ranked opens after ${standing.casualGamesNeeded} more casual game(s)${practice}.`;
  }
  const draws = standing.draws > 0 ? `–${standing.draws}` : "";
  const record = `${standing.wins}–${standing.losses}${draws}`;
  const place = standing.provisional ? "provisional" : `#${standing.rank}`;
  const line = `${standing.season.name}: rating ${standing.rating} (${place}), ${record} in ${standing.games} game(s).`;
  const decay = standing.decay ?? null;
  if (decay === null) {
    return line;
  }
  return decay.safe ? `${line}\nSafe today: you played a ranked game.` : `${line}\nPlay a ranked game by 00:00 UTC or lose ${decay.points} rating.`;
}

/**
 * The player's ranked standing in two short lines, beside their tickets on a phone.
 * @param {import("../../../application/ranking/RankingService.js").RankingState} state
 */
export function shortStandingText(state) {
  const standing = state.standing;
  if (standing === null) {
    return state.error === null ? "Loading your standing…" : "Standing unavailable.";
  }
  if (standing.season === null) {
    return "No ranked season is running.";
  }
  if (!standing.eligible) {
    return `Opens after ${standing.casualGamesNeeded} casual game(s).`;
  }
  const draws = standing.draws > 0 ? `–${standing.draws}` : "";
  const place = standing.provisional ? "new" : `#${standing.rank}`;
  const decay = standing.decay ?? null;
  const below = decay !== null && !decay.safe ? `Play ranked today or −${decay.points}` : `${standing.wins}–${standing.losses}${draws} in ${standing.games} game(s)`;
  return `Rating ${standing.rating} · ${place}\n${below}`;
}

/**
 * How many more casual games open ranked play, in words ("2 more casual games").
 * @param {number} count
 */
export function casualGamesText(count) {
  return `${count} more casual game${count === 1 ? "" : "s"}`;
}
