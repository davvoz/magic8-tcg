/**
 * What a ping sharing a game says (docs/tcg/26-ping.md): who won, against
 * whom, in which kind of game; then the details (how long, how both players
 * ended); then where to play and the hashtags. Pure, and within cur8.fun's
 * 280 characters (a picture's address does not count). Another player is
 * mentioned (@account), so they hear of it; a challenge's character is
 * named.
 */

/** cur8.fun's limit for a ping's text. */
export const MAX_PING_LENGTH = 280;
const HASHTAGS = "#kijam #tcg";

/**
 * @typedef {"win" | "loss" | "draw"} Outcome
 * @typedef {Readonly<{ boss: boolean, track: string | null }>} SharedChallenge a daily challenge's place: the boss or not, the day's track (Normal, Hard)
 * @typedef {Readonly<{
 *   outcome: Outcome, opponent: Readonly<{ name: string, account: string | null, character: boolean }>, mode: string | null,
 *   turns: number, myLife: number, theirLife: number, challenge?: SharedChallenge | null, url: string,
 * }>} SharedGame
 *   `opponent.character`: a challenge's character (named, never mentioned); `mode`: casual, ranked, daily (null: unknown)
 */

/**
 * @param {SharedGame} game
 * @returns {string}
 */
export function pingText(game) {
  const headline = game.mode === "daily" ? challengeLine(game) : gameLine(game);
  const details = [`⚔️ ${game.turns} turns`, `❤️ ${game.myLife} vs ${game.theirLife}`, ...(game.challenge?.track ? [game.challenge.track] : [])].join(" · ");
  const text = `${headline}\n${details}\n\nPlay: ${game.url}\n${HASHTAGS}`;
  return [...text].length <= MAX_PING_LENGTH ? text : `${headline}\n${details}\n${HASHTAGS}`;
}

/** @param {SharedGame} game a daily challenge, against a character */
function challengeLine({ outcome, opponent, challenge }) {
  const name = challenge?.boss === true ? `${opponent.name}, today's boss,` : opponent.name;
  if (outcome === "win") {
    return `I beat ${name} in KIJAM's Challenges! 🏆`;
  }
  if (outcome === "loss") {
    return `${name} beat me in KIJAM's Challenges. I'll be back!`;
  }
  return `A draw with ${name} in KIJAM's Challenges.`;
}

/** @param {SharedGame} game a game against another player */
function gameLine({ outcome, opponent, mode }) {
  const who = opponent.account === null || opponent.character ? opponent.name : `@${opponent.account}`;
  const kind = mode === "ranked" || mode === "casual" ? `a ${mode} game` : "a game";
  if (outcome === "win") {
    return `I won ${kind} against ${who} on KIJAM! 🏆`;
  }
  if (outcome === "loss") {
    return `${who} beat me in ${kind} on KIJAM. GG!`;
  }
  return `A draw against ${who} in ${kind} on KIJAM.`;
}
