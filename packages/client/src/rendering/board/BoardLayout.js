/**
 * Pure layout of the match board in logical units: where each zone, HUD,
 * sidebar control and card slot goes for a given snapshot seen from the
 * human's seat. No drawing, no state; the presenter tweens visuals toward
 * these rectangles and the scene builds hit-testable nodes from them.
 */
import { rect } from "@magic8/engine/shared/geometry.js";

export const CARD_SIZE = Object.freeze({
  battlefield: Object.freeze({ width: 150, height: 210 }),
  hand: Object.freeze({ width: 170, height: 238 }),
  back: Object.freeze({ width: 48, height: 68 }),
});

const GAP = 12;
const SIDE_WIDTH = 200;
const MARGIN = 16;
/** The ribbon's notched ends leave this fraction of the banner unused on each side (BoardNode draws the ribbon itself); the clock docks there. */
export const BANNER_INSET_FRACTION = 0.18;
const CLOCK_SIZE = 48;

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
 *   width: number, height: number,
 *   me: SeatLayout, opponent: SeatLayout,
 *   banner: Rect, clock: Rect, sidebar: Rect, log: Rect,
 *   cards: Readonly<Record<string, Rect>>,
 * }>} BoardLayout `clock`: where the decision clock docks, in the banner's unused right margin
 */

/**
 * @param {ReturnType<import("../../application/match/MatchSession.js").MatchSession["snapshotFor"]>} snapshot
 * @param {string} perspectiveId
 * @param {{ logicalWidth: number, logicalHeight: number }} size
 * @returns {BoardLayout}
 */
export function computeBoardLayout(snapshot, perspectiveId, { logicalWidth: width, logicalHeight: height }) {
  const me = snapshot.players.find((player) => player.id === perspectiveId) ?? snapshot.players[0];
  const opponent = snapshot.players.find((player) => player.id !== me.id) ?? me;
  const centerX = MARGIN + SIDE_WIDTH + MARGIN;
  const centerWidth = width - 2 * (MARGIN + SIDE_WIDTH + MARGIN);
  const hudHeight = 184;

  const opponentHand = rect(centerX, MARGIN, centerWidth, CARD_SIZE.back.height + GAP);
  const opponentField = rect(centerX, opponentHand.y + opponentHand.height + GAP, centerWidth, CARD_SIZE.battlefield.height + 2 * GAP);
  const banner = rect(centerX, opponentField.y + opponentField.height + 6, centerWidth, 40);
  const bannerInset = banner.width * BANNER_INSET_FRACTION;
  const clock = rect(Math.round(banner.x + banner.width - bannerInset / 2 - CLOCK_SIZE / 2), Math.round(banner.y + banner.height / 2 - CLOCK_SIZE / 2), CLOCK_SIZE, CLOCK_SIZE);
  const myField = rect(centerX, banner.y + banner.height + 6, centerWidth, CARD_SIZE.battlefield.height + 2 * GAP);
  const myHand = rect(centerX, myField.y + myField.height + GAP, centerWidth, height - (myField.y + myField.height + GAP) - MARGIN);

  /** @type {Record<string, Rect>} */
  const cards = {};
  assignSlots(cards, opponent.battlefield.map((card) => card.instanceId), opponentField, CARD_SIZE.battlefield);
  assignSlots(cards, me.battlefield.map((card) => card.instanceId), myField, CARD_SIZE.battlefield);
  assignSlots(cards, (me.hand ?? []).map((card) => card.instanceId), myHand, CARD_SIZE.hand);
  const backs = slotsFor(opponent.handSize, opponentHand, CARD_SIZE.back);
  // A spectator sees no hand at all: the bottom seat's cards are backs too.
  const myBacks = me.hand === null ? slotsFor(me.handSize, myHand, CARD_SIZE.back) : [];

  return Object.freeze({
    width,
    height,
    opponent: Object.freeze({ id: opponent.id, hud: rect(MARGIN, MARGIN, SIDE_WIDTH, hudHeight), hand: opponentHand, battlefield: opponentField, handSlots: Object.freeze(backs) }),
    me: Object.freeze({ id: me.id, hud: rect(MARGIN, height - MARGIN - hudHeight, SIDE_WIDTH, hudHeight), hand: myHand, battlefield: myField, handSlots: Object.freeze(myBacks) }),
    banner,
    clock,
    sidebar: rect(width - MARGIN - SIDE_WIDTH, MARGIN, SIDE_WIDTH, 470),
    log: rect(width - MARGIN - SIDE_WIDTH, MARGIN + 470 + GAP, SIDE_WIDTH, height - 2 * MARGIN - 470 - GAP),
    cards: Object.freeze(cards),
  });
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
