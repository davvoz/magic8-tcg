/**
 * Pure layout of the match board in logical units: where each zone, HUD,
 * sidebar control and card slot goes for a given snapshot seen from the
 * human's seat. No drawing, no state; the presenter tweens visuals toward
 * these rectangles and the scene builds hit-testable nodes from them.
 * The board fills the area it is given (the whole screen): the HUDs and
 * the sidebar keep to its edges, the fields take the width in between, and
 * extra height goes evenly above and below the two fields.
 *
 * Two sets of metrics: the wide board (1600×900 and up) and the compact one
 * for a phone in landscape (about 400 units tall): smaller cards drawn in
 * their mini face, narrower HUDs, a slim action column instead of the
 * sidebar, no battle-log panel (the scene opens the log on demand) and the
 * opponent's hidden hand peeking in from the top edge.
 */
import { rect } from "@magic8/engine/shared/geometry.js";

/** The wide board's card sizes; also the base proportions every card face is drawn in. */
export const CARD_SIZE = Object.freeze({
  battlefield: Object.freeze({ width: 150, height: 210 }),
  hand: Object.freeze({ width: 170, height: 238 }),
  back: Object.freeze({ width: 48, height: 68 }),
});

const GAP = 12;
/** The ribbon's notched ends leave this fraction of the banner unused on each side (BoardNode draws the ribbon itself); the clock docks there. */
export const BANNER_INSET_FRACTION = 0.18;

/** Which card face the board draws its cards with (CardFace profiles). */
export const BoardFace = Object.freeze({ COMPACT: "compact", MINI: "mini" });

/**
 * @typedef {Readonly<{ width: number, height: number }>} Size
 * @typedef {Readonly<{
 *   compact: boolean, margin: number, sideWidth: number, actionsWidth: number, sideGap: number,
 *   hudHeight: number, sidebarHeight: number | null, bannerGap: number, bannerHeight: number, clockSize: number,
 *   fieldPad: number, handPad: number, handBottom: number, handGap: number, opponentHandPeek: number | null,
 *   sizes: Readonly<{ battlefield: Size, hand: Size, back: Size, reveal: Size }>, face: string,
 * }>} BoardMetrics `sidebarHeight`: null for a sidebar that runs the board's full height with no log panel under it;
 *   `opponentHandPeek`: how much of the opponent's hand shows from behind the top edge (null: a full row);
 *   `handBottom`: how far the human's hand keeps from the bottom edge; `handGap`: between it and their field
 */

/** @type {BoardMetrics} */
const WIDE = Object.freeze({
  compact: false,
  margin: 16,
  sideWidth: 200,
  actionsWidth: 200,
  sideGap: 16,
  hudHeight: 184,
  sidebarHeight: 470,
  bannerGap: 6,
  bannerHeight: 40,
  clockSize: 48,
  fieldPad: GAP,
  handPad: 3,
  handBottom: 16,
  handGap: GAP,
  opponentHandPeek: null,
  sizes: Object.freeze({ ...CARD_SIZE, reveal: Object.freeze({ width: 210, height: 294 }) }),
  face: BoardFace.COMPACT,
});

/** @type {BoardMetrics} */
const COMPACT = Object.freeze({
  compact: true,
  margin: 6,
  sideWidth: 156,
  actionsWidth: 150,
  sideGap: 10,
  hudHeight: 184,
  sidebarHeight: null,
  bannerGap: 3,
  bannerHeight: 24,
  clockSize: 30,
  fieldPad: 4,
  handPad: 2,
  handBottom: 2,
  handGap: 0,
  opponentHandPeek: 24,
  sizes: Object.freeze({
    battlefield: Object.freeze({ width: 76, height: 106 }),
    hand: Object.freeze({ width: 80, height: 112 }),
    back: Object.freeze({ width: 24, height: 34 }),
    reveal: Object.freeze({ width: 170, height: 238 }),
  }),
  face: BoardFace.MINI,
});

/**
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 * @typedef {Readonly<{
 *   id: string,
 *   hud: Rect,
 *   hand: Rect,
 *   battlefield: Rect,
 *   handSlots: readonly Rect[],
 * }>} SeatLayout
 * @typedef {Readonly<{
 *   x: number, y: number, width: number, height: number,
 *   compact: boolean,
 *   me: SeatLayout, opponent: SeatLayout,
 *   banner: Rect, clock: Rect, sidebar: Rect, log: Rect | null,
 *   cards: Readonly<Record<string, Rect>>,
 *   sizes: BoardMetrics["sizes"], face: string,
 * }>} BoardLayout `x`…`height`: the area the board fills; `clock`: where the decision clock docks, in the banner's unused right margin;
 *   `log`: the battle-log panel, null on a compact board; `sizes`: the cards' sizes on this board, and of a card held up to be read (`reveal`);
 *   `face`: the BoardFace its cards are drawn with
 */

/**
 * @param {ReturnType<import("../../application/match/MatchSession.js").MatchSession["snapshotFor"]>} snapshot
 * @param {string} perspectiveId
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area what the board fills, in logical units (at least 1600×900; compact: at least 760×400)
 * @param {{ compact?: boolean }} [options] `compact`: the phone board
 * @returns {BoardLayout}
 */
export function computeBoardLayout(snapshot, perspectiveId, { x, y, width, height }, { compact = false } = {}) {
  const metrics = compact ? COMPACT : WIDE;
  const { margin, sideWidth, actionsWidth, sideGap, sizes } = metrics;
  const me = snapshot.players.find((player) => player.id === perspectiveId) ?? snapshot.players[0];
  const opponent = snapshot.players.find((player) => player.id !== me.id) ?? me;
  const left = Math.round(x);
  const top = Math.round(y);
  const right = Math.round(x + width);
  const bottom = Math.round(y + height);
  const centerX = left + margin + sideWidth + sideGap;
  const centerWidth = right - margin - actionsWidth - sideGap - centerX;
  const fieldHeight = sizes.battlefield.height + 2 * metrics.fieldPad;
  const handHeight = sizes.hand.height + 2 * metrics.handPad;

  const { zone: opponentHand, below: fieldsFrom } = opponentHandZone(metrics, { x: centerX, y: top, width: centerWidth });
  const myHand = rect(centerX, bottom - metrics.handBottom - handHeight, centerWidth, handHeight);
  const between = myHand.y - metrics.handGap - fieldsFrom;
  const fieldsTop = fieldsFrom + Math.round((between - (2 * fieldHeight + 2 * metrics.bannerGap + metrics.bannerHeight)) / 2);
  const opponentField = rect(centerX, fieldsTop, centerWidth, fieldHeight);
  const banner = rect(centerX, opponentField.y + opponentField.height + metrics.bannerGap, centerWidth, metrics.bannerHeight);
  const bannerInset = banner.width * BANNER_INSET_FRACTION;
  const clockSize = metrics.clockSize;
  const clock = rect(Math.round(banner.x + banner.width - bannerInset / 2 - clockSize / 2), Math.round(banner.y + banner.height / 2 - clockSize / 2), clockSize, clockSize);
  const myField = rect(centerX, banner.y + banner.height + metrics.bannerGap, centerWidth, fieldHeight);

  /** @type {Record<string, Rect>} */
  const cards = {};
  assignSlots(cards, opponent.battlefield.map((card) => card.instanceId), opponentField, sizes.battlefield);
  assignSlots(cards, me.battlefield.map((card) => card.instanceId), myField, sizes.battlefield);
  assignSlots(cards, (me.hand ?? []).map((card) => card.instanceId), myHand, sizes.hand);
  const backs = slotsFor(opponent.handSize, opponentHand, sizes.back);
  // A spectator sees no hand at all: the bottom seat's cards are backs too.
  const myBacks = me.hand === null ? slotsFor(me.handSize, myHand, sizes.back) : [];

  const hudHeight = Math.min(metrics.hudHeight, Math.floor((bottom - top - 2 * margin - GAP) / 2));
  const sideX = right - margin - actionsWidth;
  const { sidebar, log } = sideColumn(metrics, { x: sideX, y: top, width: actionsWidth, height: bottom - top });
  return Object.freeze({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    compact,
    opponent: Object.freeze({ id: opponent.id, hud: rect(left + margin, top + margin, sideWidth, hudHeight), hand: opponentHand, battlefield: opponentField, handSlots: Object.freeze(backs) }),
    me: Object.freeze({ id: me.id, hud: rect(left + margin, bottom - margin - hudHeight, sideWidth, hudHeight), hand: myHand, battlefield: myField, handSlots: Object.freeze(myBacks) }),
    banner,
    clock,
    sidebar,
    log,
    cards: Object.freeze(cards),
    sizes,
    face: metrics.face,
  });
}

/**
 * The opponent's hidden hand along the top: a row of its own, or peeking in from behind the edge.
 * @param {BoardMetrics} metrics
 * @param {{ x: number, y: number, width: number }} top the centre column's top edge
 * @returns {{ zone: Rect, below: number }} `below`: where the fields may start
 */
function opponentHandZone(metrics, { x, y, width }) {
  const back = metrics.sizes.back;
  if (metrics.opponentHandPeek === null) {
    const zone = rect(x, y + metrics.margin, width, back.height + GAP);
    return { zone, below: zone.y + zone.height + GAP };
  }
  return { zone: rect(x, y + metrics.opponentHandPeek - back.height, width, back.height), below: y + metrics.opponentHandPeek };
}

/**
 * The right-hand column: the sidebar with the log panel under it, or (compact) the action column alone.
 * @param {BoardMetrics} metrics
 * @param {Rect} column the column's x and width, and the board's top and height
 * @returns {{ sidebar: Rect, log: Rect | null }}
 */
function sideColumn(metrics, { x, y, width, height }) {
  const { margin } = metrics;
  if (metrics.sidebarHeight === null) {
    return { sidebar: rect(x, y + margin, width, height - 2 * margin), log: null };
  }
  return {
    sidebar: rect(x, y + margin, width, metrics.sidebarHeight),
    log: rect(x, y + margin + metrics.sidebarHeight + GAP, width, height - 2 * margin - metrics.sidebarHeight - GAP),
  };
}

/**
 * Centred row of `count` slots; when they do not fit they overlap evenly.
 * @param {number} count
 * @param {Rect} zone
 * @param {{ width: number, height: number }} size
 * @returns {Rect[]}
 */
export function slotsFor(count, zone, size) {
  if (count <= 0) {
    return [];
  }
  const natural = count * size.width + (count - 1) * GAP;
  const spacing = natural <= zone.width || count === 1 ? size.width + GAP : (zone.width - size.width) / (count - 1);
  const rowWidth = size.width + spacing * (count - 1);
  const startX = zone.x + (zone.width - rowWidth) / 2;
  const y = zone.y + (zone.height - size.height) / 2;
  const slots = [];
  for (let index = 0; index < count; index += 1) {
    slots.push(rect(Math.round(startX + index * spacing), Math.round(y), size.width, size.height));
  }
  return slots;
}

/**
 * @param {Record<string, Rect>} into
 * @param {readonly string[]} ids
 * @param {Rect} zone
 * @param {{ width: number, height: number }} size
 */
function assignSlots(into, ids, zone, size) {
  const slots = slotsFor(ids.length, zone, size);
  ids.forEach((id, index) => {
    into[id] = slots[index];
  });
}
