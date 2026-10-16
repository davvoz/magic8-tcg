/**
 * How ranked play works, as it stands for the player: the guide
 * (RankedGuide) with what one entry costs, how many the player holds and
 * the season's jackpot. Shared by the lobby and the Season screen, so they
 * never word it differently.
 */
import { describeJackpot } from "../../../application/jackpot/describeJackpot.js";
import { rankedEntryPrice } from "../../../application/shop/shopCatalog.js";
import { RankedGuide } from "./RankedGuide.js";

/**
 * What one ranked entry costs ("1.000 STEEM"), or null until the shop's listing is read.
 * @param {import("../../../application/AppContext.js").AppContext} app
 */
export function rankedPriceText(app) {
  const price = rankedEntryPrice(app.shop?.state.listing ?? null);
  return price === null ? null : `${price.amount} ${price.asset}`;
}

/**
 * What the season's jackpot holds ("866.666 STEEM"), or null when there is none or it is not known yet.
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
 * @param {{ id?: string, x: number, y: number, width: number, height: number, compact: boolean }} frame
 * @param {number} now
 */
export function rankedGuideFor(app, frame, now) {
  const ranked = app.entries?.ranked ?? null;
  const price = rankedPriceText(app);
  const steps = rankedSteps({ price, perGame: ranked?.perGame ?? null, places: app.jackpot?.state.jackpot?.places.length ?? null });
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
  const buy = price === null ? "From the shop: buy many with one payment." : `${price} each. Buy many with one payment.`;
  const take = perGame === null || perGame === 1 ? "A game takes 1 entry" : `A game takes ${perGame} entries`;
  const share = places === null ? "the best of the season share it" : `the top ${places} share it`;
  return [
    { title: "Get entries", text: free ? "Free this season: no entry needed." : buy },
    { title: "Play ranked", text: free ? "Win to climb the season's leaderboard." : `${take}, given back if it is called off before it starts.` },
    { title: "Win the jackpot", text: `Every entry goes into it. When the season ends, ${share}.` },
  ];
}
