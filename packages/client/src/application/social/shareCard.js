/**
 * The picture of a shared game, as data (docs/tcg/26-ping.md): the outcome,
 * the kind of game, the two players and how they ended, the length of the
 * game. Pure: the rendering layer paints it (rendering/share/ShareCard), the
 * ping carries the painting.
 */

/**
 * @typedef {import("./pingText.js").SharedGame} SharedGame
 * @typedef {Readonly<{ name: string, account: string | null, life: number }>} CardPlayer
 * @typedef {Readonly<{ outcome: import("./pingText.js").Outcome, title: string, kind: string, me: CardPlayer, opponent: CardPlayer, turns: number, site: string }>} ShareCard
 *   `title`: Victory, Defeat or Draw; `kind`: the kind of game, in words; `site`: where the game is played, without its scheme
 */

const TITLES = Object.freeze({ win: "Victory", loss: "Defeat", draw: "Draw" });

/**
 * @param {SharedGame} game
 * @param {{ name: string, account: string | null }} me
 * @returns {ShareCard}
 */
export function shareCardOf(game, me) {
  return Object.freeze({
    outcome: game.outcome,
    title: TITLES[game.outcome],
    kind: kindOf(game),
    me: Object.freeze({ ...me, life: game.myLife }),
    opponent: Object.freeze({ name: game.opponent.name, account: game.opponent.account, life: game.theirLife }),
    turns: game.turns,
    site: game.url.replace(/^https?:\/\//, ""),
  });
}

/**
 * The kind of game, in words: "Ranked game", "Challenges · Hard · Boss".
 * @param {SharedGame} game
 */
export function kindOf({ mode, challenge }) {
  if (mode === "daily") {
    return ["Challenges", challenge?.track ?? null, challenge?.boss === true ? "Boss" : null].filter((part) => part !== null).join(" · ");
  }
  if (mode === "ranked") {
    return "Ranked game";
  }
  return mode === "casual" ? "Casual game" : "Online game";
}
