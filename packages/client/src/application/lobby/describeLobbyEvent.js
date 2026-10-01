/**
 * What the toasts say about a challenge that arrives or closes, from the
 * player's side. A toast about a challenge shows the other player's
 * portrait (`account`), and a click on it opens the lobby.
 */
import { ChallengeEnd, ChallengeMode } from "./LobbyService.js";

/**
 * @typedef {Readonly<{ title: string, body: string, tone: "good" | "bad" | "info", account: string }>} LobbyToast
 */

/**
 * @param {import("./LobbyService.js").LobbyEvent} event
 * @returns {LobbyToast}
 */
export function describeLobbyEvent(event) {
  const { challenge } = event;
  const game = challenge.mode === ChallengeMode.RANKED ? "a ranked game" : "a casual game";
  if (event.kind === "received") {
    return toast(`@${challenge.from} challenges you`, `To ${game}. Open Play online to answer within a minute.`, "info", challenge.from);
  }
  const other = event.outgoing ? challenge.to : challenge.from;
  const [title, body, tone] = (event.outgoing ? OUTGOING : INCOMING)[event.reason] ?? ["Challenge with @{other} closed", "", "info"];
  return toast(title, body, tone, other);
}

/**
 * @param {string} title
 * @param {string} body
 * @param {string} tone
 * @param {string} other the other player, named in the text as {other} and shown as the portrait
 * @returns {LobbyToast}
 */
function toast(title, body, tone, other) {
  return Object.freeze({ title: title.replace("{other}", other), body: body.replace("{other}", other), tone: /** @type {"good" | "bad" | "info"} */ (tone), account: other });
}

/** The player's own challenge closed: [title, body, tone]. @type {Readonly<Record<string, readonly [string, string, string]>>} */
const OUTGOING = Object.freeze({
  [ChallengeEnd.ACCEPTED]: ["@{other} accepted your challenge", "The game is starting.", "good"],
  [ChallengeEnd.DECLINED]: ["@{other} declined your challenge", "Challenge someone else, or find a match in the queue.", "bad"],
  [ChallengeEnd.EXPIRED]: ["@{other} did not answer", "Your challenge lapsed after a minute.", "bad"],
  [ChallengeEnd.OFFLINE]: ["@{other} left", "Your challenge was called off.", "bad"],
  [ChallengeEnd.BUSY]: ["@{other} is in another game", "Your challenge was called off.", "bad"],
  [ChallengeEnd.CANCELLED]: ["Challenge to @{other} withdrawn", "", "info"],
  [ChallengeEnd.MAINTENANCE]: ["Challenge called off", "A maintenance is about to start: no new games until it ends.", "bad"],
});

/** A challenge the player received closed: [title, body, tone]. @type {Readonly<Record<string, readonly [string, string, string]>>} */
const INCOMING = Object.freeze({
  [ChallengeEnd.CANCELLED]: ["@{other} withdrew the challenge", "", "info"],
  [ChallengeEnd.EXPIRED]: ["The challenge from @{other} lapsed", "Nobody answered it within a minute.", "info"],
  [ChallengeEnd.OFFLINE]: ["@{other} left", "Their challenge was called off.", "info"],
  [ChallengeEnd.BUSY]: ["@{other} is in another game", "Their challenge was called off.", "info"],
  [ChallengeEnd.MAINTENANCE]: ["Challenge called off", "A maintenance is about to start: no new games until it ends.", "bad"],
});
