/**
 * How ranked play works, as it stands for the player: the guide
 * (RankedGuide) with what one entry costs, how many the player holds and
 * the season's jackpot. Shared by the lobby and the Season screen, so they
 * never word it differently.
 */
import { describeJackpot } from "../../../application/jackpot/describeJackpot.js";
import { moneyText } from "../../../application/money/moneyText.js";
import { rankedEntryPrice } from "../../../application/shop/shopCatalog.js";
import { RankedGuide } from "./RankedGuide.js";

/**
 * What one ranked ticket costs ("1 STEEM"), or null until the shop's listing is read.
 * @param {import("../../../application/AppContext.js").AppContext} app
 */
export function rankedPriceText(app) {
  const price = rankedEntryPrice(app.shop?.state.listing ?? null);
  return price === null ? null : moneyText(price.amount, price.asset);
}

/**
 * What the season's jackpot holds ("866 STEEM", rounded down), or null when there is none or it is not known yet.
 * @param {import("../../../application/AppContext.js").AppContext} app
 * @param {number} now
 */
export function jackpotAmountText(app, now) {
  const jackpot = app.jackpot?.state.jackpot ?? null;
  return jackpot === null || jackpot.jackpot === null ? null : describeJackpot(jackpot, now).amount;
}

/**
 * The guide in `frame`.
 * @param {import("../../../application/AppContext.js").AppContext} app
 * @param {{ id?: string, x: number, y: number, width: number, height: number, compact: boolean, brief?: boolean, plates?: boolean }} frame
 *   `brief`: each step in a few words (a phone's screen); `plates`: each step on a plate of its own, in a sentence (a wide
 *   screen's ranked panel)
 * @param {number} now
 */
export function rankedGuideFor(app, { brief = false, ...frame }, now) {
  const ranked = app.entries?.ranked ?? null;
  const price = rankedPriceText(app);
  const facts = { price, perGame: ranked?.perGame ?? null, places: app.jackpot?.state.jackpot?.places.length ?? null };
  const steps = wordingFor({ brief, plates: frame.plates === true })(facts);
  return new RankedGuide({ ...frame, steps, tickets: { count: ranked === null || ranked.perGame === 0 ? null : ranked.balance, face: price }, jackpot: jackpotAmountText(app, now) });
}

/**
 * The three steps of ranked play as the guide words them: get entries, play (a game takes some), win the jackpot (which
 * every entry feeds).
 * @param {{ price: string | null, perGame: number | null, places: number | null }} facts what one entry costs ("1.000 STEEM"),
 *   how many a game takes (0: ranked is free; null: not known yet) and how many places the jackpot pays (null: not known)
 * @returns {[import("./RankedGuide.js").GuideStep, import("./RankedGuide.js").GuideStep, import("./RankedGuide.js").GuideStep]}
 */
export function rankedSteps({ price, perGame, places }) {
  const free = perGame === 0;
  const buy = price === null ? "Buy them first, in the Shop: many with one payment." : `Buy them first: ${price} each, many with one payment.`;
  const take = perGame === null || perGame === 1 ? "A game takes 1 ticket" : `A game takes ${perGame} tickets`;
  const share = places === null ? "the best of the season share it" : `the top ${places} share it`;
  return [
    { title: "Buy tickets", text: free ? "Free this season: no ticket needed." : buy },
    { title: "Play ranked", text: free ? "Win to climb the season's leaderboard." : `${take}, given back if it is called off before it starts.` },
    { title: "Win the jackpot", text: `Every ticket goes into it. When the season ends, ${share}.` },
  ];
}

/**
 * The same three steps in a few words each, under a one-word name (its number leads it), for a phone's screen.
 * @param {{ price: string | null, perGame: number | null, places: number | null }} facts as for `rankedSteps`
 * @returns {[import("./RankedGuide.js").GuideStep, import("./RankedGuide.js").GuideStep, import("./RankedGuide.js").GuideStep]}
 */
export function briefRankedSteps({ price, perGame, places }) {
  const share = places === null ? "The best win it" : `Top ${places} win it`;
  if (perGame === 0) {
    return [
      { title: "Free", text: "No tickets needed" },
      { title: "Play", text: "Win to climb" },
      { title: "Win", text: share },
    ];
  }
  const take = perGame === null || perGame === 1 ? "1 ticket a game" : `${perGame} tickets a game`;
  return [
    { title: "Buy", text: price === null ? "Tickets, in the shop" : `${price} a ticket` },
    { title: "Play", text: take },
    { title: "Win", text: share },
  ];
}

/**
 * The three steps in a sentence each, for the plates of a wide screen's ranked panel.
 * @param {{ price: string | null, perGame: number | null, places: number | null }} facts as for `rankedSteps`
 * @returns {[import("./RankedGuide.js").GuideStep, import("./RankedGuide.js").GuideStep, import("./RankedGuide.js").GuideStep]}
 */
export function plateRankedSteps({ price, perGame, places }) {
  const share = places === null ? "the best of the season share it" : `the top ${places} share it`;
  if (perGame === 0) {
    return [
      { title: "No tickets needed", text: "Ranked is free this season" },
      { title: "Play ranked", text: "Win to climb the leaderboard" },
      { title: "Win the jackpot", text: `When the season ends, ${share}` },
    ];
  }
  const uses = perGame === null || perGame === 1 ? "1 ticket" : `${perGame} tickets`;
  return [
    { title: "Buy tickets", text: price === null ? "Buy them before you play" : `${price} each: buy them before you play` },
    { title: "Play ranked", text: `Each game uses ${uses}, back if called off` },
    { title: "Win the jackpot", text: `Every ticket feeds it: ${share}` },
  ];
}

/**
 * How the steps are worded for a layout: a sentence each on plates, a few words when brief, else in full.
 * @param {{ brief: boolean, plates: boolean }} layout
 */
function wordingFor({ brief, plates }) {
  if (plates) {
    return plateRankedSteps;
  }
  return brief ? briefRankedSteps : rankedSteps;
}
