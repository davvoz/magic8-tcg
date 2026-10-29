/**
 * How far a purchase paid on the chain has come, for a tracker the player
 * reads at a glance — the same for the shop and for the player market:
 * four steps (the order, the payment the wallet asks for, the blockchain
 * making that payment final, the delivery) and, while the chain confirms,
 * how much of the usual wait is behind it and how much is left.
 *
 * Each service says where its purchase stands as a `PurchaseTrack`
 * (ShopService's `shopTrack`, SalesService's `buyingTrack`): which step,
 * whether the server has seen the payment on the chain, whether it is
 * final, and when the wallet sent it. The wait is an estimate (STEEM makes
 * a transfer final in about a minute); what the server saw moves it on.
 * Past the usual wait the purchase is late: it still arrives, only later,
 * and the bar stops short of the end until it does.
 */

/** The steps, in order: their index is a purchase's `step`; past the last (`PURCHASE_STEP_COUNT`) everything is done. */
export const PurchaseStep = Object.freeze({ ORDER: 0, PAYMENT: 1, CHAIN: 2, DELIVERY: 3 });
export const PURCHASE_STEP_COUNT = 4;
/** Where a purchase stands, as a service tells it: before its payment, paying, on the chain, delivered. */
export const TrackStage = Object.freeze({ ORDER: "order", PAYMENT: "payment", CHAIN: "chain", DONE: "done" });
/** How long the chain usually takes to make a payment final, from the moment the wallet sent it. */
export const CHAIN_WAIT_MS = 60_000;
/** Where the chain stands with the payment. */
export const ChainPhase = Object.freeze({ WAITING: "waiting", SEEN: "seen", FINAL: "final", LATE: "late" });
/**
 * How full the bar is: at least `seen` once the server saw the payment, the time waited fills it up to `timed`,
 * `final` once the payment is final, and `late` past the usual wait (never full until the delivery).
 */
const SHARE = Object.freeze({ seen: 0.1, timed: 0.9, final: 0.95, late: 0.95 });

/**
 * @typedef {Readonly<{ amount: string, asset: string, to: string }>} TrackPayment the transfer the wallet asks for
 * @typedef {Readonly<{ stage: string, seen: boolean, final: boolean, paidAt: number | null, payment: TrackPayment | null }>} PurchaseTrack
 *   `stage`: one of TrackStage; `seen`: the server has seen the payment on the chain; `final`: it is final (only the
 *   delivery is left); `paidAt`: when the wallet sent it (ms)
 * @typedef {Readonly<{ phase: string, share: number, leftMs: number }>} ChainProgress `share`: of the bar, 0 to 1;
 *   `leftMs`: of the usual wait (0 once it is over)
 * @typedef {Readonly<{ step: number, chain: ChainProgress | null }>} PurchaseProgress `step`: the one under way
 *   (PURCHASE_STEP_COUNT once delivered); `chain`: while the chain confirms
 */

/**
 * @param {PurchaseTrack | null} track null: no purchase, or one that failed
 * @param {number} nowMs
 * @returns {PurchaseProgress | null}
 */
export function purchaseProgress(track, nowMs) {
  switch (track?.stage) {
    case TrackStage.ORDER:
      return Object.freeze({ step: PurchaseStep.ORDER, chain: null });
    case TrackStage.PAYMENT:
      return Object.freeze({ step: PurchaseStep.PAYMENT, chain: null });
    case TrackStage.CHAIN: {
      const chained = /** @type {PurchaseTrack} */ (track);
      return Object.freeze({ step: chained.final ? PurchaseStep.DELIVERY : PurchaseStep.CHAIN, chain: chainProgress(chained, nowMs) });
    }
    case TrackStage.DONE:
      return Object.freeze({ step: PURCHASE_STEP_COUNT, chain: null });
    default:
      return null;
  }
}

/**
 * Whether the purchase is paid and on its way: the wallet sent it, the delivery is still to come.
 * @param {PurchaseTrack | null} track
 */
export function isArriving(track) {
  return track?.stage === TrackStage.CHAIN;
}

/**
 * @param {PurchaseTrack} track
 * @param {number} nowMs
 * @returns {ChainProgress}
 */
function chainProgress(track, nowMs) {
  const waited = Math.max(0, nowMs - (track.paidAt ?? nowMs));
  const leftMs = Math.max(0, CHAIN_WAIT_MS - waited);
  const timed = (SHARE.timed * Math.min(waited, CHAIN_WAIT_MS)) / CHAIN_WAIT_MS;
  if (track.final) {
    return Object.freeze({ phase: ChainPhase.FINAL, share: SHARE.final, leftMs });
  }
  if (leftMs === 0) {
    return Object.freeze({ phase: ChainPhase.LATE, share: SHARE.late, leftMs });
  }
  if (track.seen) {
    return Object.freeze({ phase: ChainPhase.SEEN, share: Math.max(SHARE.seen, timed), leftMs });
  }
  return Object.freeze({ phase: ChainPhase.WAITING, share: timed, leftMs });
}
