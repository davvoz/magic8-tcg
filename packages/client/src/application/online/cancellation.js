/**
 * What a player is told when an online game is called off before it
 * started (the server's game.aborted, docs/tcg/12): in protocol v2 both
 * players must accept the game by signing with Keychain, and one of them
 * refused or did not answer in time. The message says who, so a player
 * whose opponent walked away knows it was not their doing.
 */

/** Why the server called the game off (GAME_ABORTED `why`). */
export const AbortReason = Object.freeze({
  DECLINED: "declined",
  NOT_AUTHORIZED: "not_authorized",
});

/** The notice's code: who did not accept the game. */
export const CancellationCode = Object.freeze({
  YOU_DECLINED: "YOU_DECLINED",
  OPPONENT_DECLINED: "OPPONENT_DECLINED",
});

/**
 * @param {{ reason: string, seats: readonly string[], you: string }} aborted the server's game.aborted
 * @param {string | null} opponent the opponent's account
 * @returns {Readonly<{ code: string, message: string }>}
 */
export function cancellationNotice({ reason, seats, you }, opponent) {
  const inTime = reason === AbortReason.NOT_AUTHORIZED;
  if (seats.includes(you)) {
    const what = inTime ? "You did not sign the game with Keychain in time" : "You did not accept the game in Keychain";
    return Object.freeze({ code: CancellationCode.YOU_DECLINED, message: `${what}, so it was cancelled.` });
  }
  const who = opponent === null ? "Your opponent" : `@${opponent}`;
  const what = inTime ? `${who} did not sign the game with Keychain in time` : `${who} did not accept the game in Keychain`;
  return Object.freeze({ code: CancellationCode.OPPONENT_DECLINED, message: `${what}, so it was cancelled. You can look for another opponent.` });
}
