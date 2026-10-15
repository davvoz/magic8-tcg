/**
 * The daily challenges' characters at the table: their seat is named
 * "ai_<id>" (the server's AiAccount), which no STEEM account can be (STEEM
 * names hold no "_"). So the screens can tell a character from a player by
 * the name alone, show its own name instead of an account, and never fetch
 * a profile picture for it.
 */
import { hashString } from "@magic8/engine/shared/hash.js";

const PREFIX = "ai_";

/**
 * @param {string | null | undefined} account a seat's name at the table
 * @returns {boolean}
 */
export function isCharacterAccount(account) {
  return typeof account === "string" && account.startsWith(PREFIX) && account.length > PREFIX.length;
}

/**
 * @param {string} account a character's seat name
 * @returns {string} the character's id
 */
export function characterIdOf(account) {
  return account.slice(PREFIX.length);
}

/**
 * One of a character's lines, the same for a given game (it does not change when the screen is drawn again).
 * @param {readonly string[]} lines
 * @param {string} key what the line is for (a game id, a day)
 * @returns {string | null}
 */
export function lineFor(lines, key) {
  if (lines.length === 0) {
    return null;
  }
  return lines[hashString(key) % lines.length];
}
