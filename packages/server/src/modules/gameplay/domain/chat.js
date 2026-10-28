/**
 * Chat at the table (docs/tcg/28-chat.md): the line a player or a spectator
 * types, as the server lets it through, and how fast one may type.
 *
 * A line is plain text: control and formatting characters go (except the
 * joiner that holds an emoji together), runs of spaces become one, and it
 * is cut to MAX_CHAT_LENGTH characters. Nothing is stored: lines live in
 * the game's memory while it runs, and are never part of its record.
 */

/** The longest line, in characters (code points). */
export const MAX_CHAT_LENGTH = 140;

/** Lines one person may send in a burst, and how fast that allowance comes back. */
const BURST = 4;
const REFILL_PER_SECOND = 0.5;

/** Control, formatting, private-use and unassigned characters; the zero-width joiner is kept apart. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u;
const ZERO_WIDTH_JOINER = "‍";

/**
 * The line as the table will read it, or null when nothing is left to say.
 * @param {unknown} text
 * @returns {string | null}
 */
export function cleanChatLine(text) {
  if (typeof text !== "string") {
    return null;
  }
  const printable = Array.from(text)
    .map((character) => (/\s/u.test(character) ? " " : character))
    .filter((character) => character === ZERO_WIDTH_JOINER || !UNPRINTABLE.test(character))
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
  const line = Array.from(printable).slice(0, MAX_CHAT_LENGTH).join("").trim();
  return line.length === 0 ? null : line;
}

/** A token bucket per person: a few lines at once, then one every couple of seconds. */
export class ChatThrottle {
  /** @type {Map<string, { tokens: number, at: number }>} */
  #buckets = new Map();

  /**
   * Takes one line's allowance.
   * @param {string} userId
   * @param {number} now ms
   * @returns {boolean} whether the line may go
   */
  take(userId, now) {
    const bucket = this.#buckets.get(userId) ?? { tokens: BURST, at: now };
    bucket.tokens = Math.min(BURST, bucket.tokens + (Math.max(0, now - bucket.at) / 1000) * REFILL_PER_SECOND);
    bucket.at = now;
    this.#buckets.set(userId, bucket);
    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  }
}
