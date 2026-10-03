/**
 * The sounds of what the application services do, heard on whatever screen
 * the player is: coins as a payment leaves their wallet, a refusal when a
 * purchase fails, the cart filling and emptying, the chime of a game found.
 * Each binding follows one service's state and plays a cue on the change
 * that matters; it returns the unsubscribe.
 *
 * What arrives later (cards bought, a sale made) is announced by its
 * notification's toast, and the shop's reveal has its own fanfare: nothing
 * here doubles them.
 */
import { SoundCue } from "../../application/audio/SoundCue.js";
import { BuyStage } from "../../application/sales/SalesService.js";
import { PurchaseStage } from "../../application/shop/ShopService.js";
import { OnlineStatus } from "../../application/online/OnlineService.js";

/** @typedef {import("../scenes/Scene.js").SoundPlayer} SoundPlayer */

/**
 * A service whose state can be followed.
 * @template S
 * @typedef {{ state: S, subscribe: (listener: (state: S) => void) => () => unknown }} Observable
 */

/**
 * Plays `cueFor(previous, next)` on each change of a service's state.
 * @template S
 * @param {Observable<S>} service
 * @param {SoundPlayer} sound
 * @param {(previous: S, next: S) => string | null} cueFor
 * @returns {() => void}
 */
function onChange(service, sound, cueFor) {
  let previous = service.state;
  const unsubscribe = service.subscribe((next) => {
    const cue = cueFor(previous, next);
    previous = next;
    if (cue !== null) {
      sound.play(cue);
    }
  });
  return () => {
    unsubscribe();
  };
}

/**
 * A purchase's payment sent, or refused; something put in the cart or taken out.
 * @param {Observable<import("../../application/shop/ShopService.js").ShopState>} shop
 * @param {SoundPlayer} sound
 */
export function soundShop(shop, sound) {
  return onChange(shop, sound, (previous, next) => {
    const stage = stageCue(previous.purchase.stage, next.purchase.stage, { paying: PurchaseStage.CONFIRMING, failed: PurchaseStage.FAILED });
    if (stage !== null || previous.purchase.stage !== next.purchase.stage) {
      // Paying for the cart empties it: that is the coins, not a card taken out.
      return stage;
    }
    const before = cartSize(previous.cart);
    const after = cartSize(next.cart);
    if (after === before) {
      return null;
    }
    return after > before ? SoundCue.CART_ADD : SoundCue.CART_REMOVE;
  });
}

/**
 * A card bought on the player market: its payment sent, or refused.
 * @param {Observable<import("../../application/sales/SalesService.js").SalesState>} sales
 * @param {SoundPlayer} sound
 */
export function soundSales(sales, sound) {
  return onChange(sales, sound, (previous, next) => stageCue(previous.buying.stage, next.buying.stage, { paying: BuyStage.CONFIRMING, failed: BuyStage.FAILED }));
}

/**
 * A game found (a challenge accepted, the queue matched).
 * @param {Observable<import("../../application/online/OnlineService.js").OnlineState>} online
 * @param {SoundPlayer} sound
 */
export function soundOnline(online, sound) {
  return onChange(online, sound, (previous, next) => (next.status === OnlineStatus.MATCHED && previous.status !== OnlineStatus.MATCHED ? SoundCue.MATCH_FOUND : null));
}

/**
 * The sound of a purchase moving on: coins as its payment is sent, a refusal as it fails.
 * @param {string} previous
 * @param {string} next
 * @param {{ paying: string, failed: string }} stages
 */
function stageCue(previous, next, { paying, failed }) {
  if (next === previous) {
    return null;
  }
  if (next === paying) {
    return SoundCue.COINS;
  }
  return next === failed ? SoundCue.UI_ERROR : null;
}

/** @param {readonly { quantity: number }[]} cart */
function cartSize(cart) {
  return cart.reduce((total, line) => total + line.quantity, 0);
}
