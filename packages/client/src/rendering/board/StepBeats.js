/**
 * One update from the session — the state a move led to and everything that
 * happened on the way — broken into the beats the board plays one after
 * another. The engine resolves a cast and all it sets off in one go; shown
 * in one go it is a jumble, with the creature a spell kills already gone
 * before the card has even turned over, and whatever its death triggers
 * landing at the same instant.
 *
 * A beat ends where abilities are announced (ABILITY_TRIGGERED): what they
 * do is the next beat, which the board shows once the announcement — the
 * opponent's cast turning over, the rune of a triggered ability — has
 * struck. Each beat carries the state as it stood at its end, and the board
 * is laid out from that: a creature a later beat kills is still standing,
 * life a later beat takes is still there. That state is staged from what
 * the events say happened, never guessed from differences: whatever later
 * beats still change is the previous state carried forward by the events
 * so far; everything else is already as the final state has it. The last
 * beat is the final state itself.
 */
import { GameEventType } from "@magic8/engine/domain/game/GameEventType.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";

/**
 * @typedef {ReturnType<import("../../application/match/MatchSession.js").MatchSession["snapshotFor"]>} Snapshot
 * @typedef {Snapshot["players"][number]} PlayerView
 * @typedef {import("@magic8/engine/domain/game/GameSnapshot.js").CardView} CardView
 * @typedef {Readonly<Record<string, unknown>>} GameEvent
 * @typedef {Readonly<{ snapshot: Snapshot, events: readonly GameEvent[], outcome: readonly GameEvent[] }>} Beat
 *   `outcome`: the events of the beat after it — what this one announces is going to do (none for the last beat).
 *   A random discard's crosshair, for one, has to end on the cards that do go
 * @typedef {{ card: CardView | null, playerId: string, zone: string }} Placement a card's view and where it stands; the view is null for a card nobody may see
 * @typedef {{ cards: Set<string>, lives: Set<string>, resources: Set<string>, hands: Set<string>, libraries: Set<string> }} Pending what later beats still change: cards by id, the rest by player id
 */

/** Where the events that move a card send it. @type {Readonly<Record<string, (event: GameEvent) => { id: unknown, playerId: unknown, zone: unknown }>>} */
const MOVES = Object.freeze({
  [GameEventType.CARD_PLAYED]: (event) => ({ id: event.instanceId, playerId: event.playerId, zone: event.zone }),
  [GameEventType.CARD_DRAWN]: (event) => ({ id: event.instanceId, playerId: event.playerId, zone: ZoneType.HAND }),
  [GameEventType.CARD_DISCARDED]: (event) => ({ id: event.instanceId, playerId: event.playerId, zone: ZoneType.GRAVEYARD }),
  [GameEventType.CARD_MILLED]: (event) => ({ id: event.instanceId, playerId: event.playerId, zone: ZoneType.GRAVEYARD }),
  [GameEventType.CREATURE_DIED]: (event) => ({ id: event.instanceId, playerId: event.playerId, zone: ZoneType.GRAVEYARD }),
  [GameEventType.CARD_RETURNED]: (event) => ({ id: event.targetId, playerId: event.playerId, zone: ZoneType.HAND }),
});

/** How the events that change a card's numbers change them. @type {Readonly<Record<string, (card: CardView, event: GameEvent) => CardView>>} */
const PATCHES = Object.freeze({
  [GameEventType.DAMAGE_DEALT]: (card, event) => ({ ...card, health: typeof event.remainingHealth === "number" ? event.remainingHealth : card.health - Number(event.amount), damage: card.damage + Number(event.amount) }),
  [GameEventType.HEALED]: (card, event) => ({ ...card, health: card.health + Number(event.amount), damage: Math.max(0, card.damage - Number(event.amount)) }),
  [GameEventType.STATS_MODIFIED]: (card, event) => ({ ...card, attack: Number(event.attackNow), health: Number(event.healthNow), maxHealth: card.maxHealth + Number(event.health ?? 0) }),
});

/** Events that change how many cards are in a player's hand, and by how much. */
const HAND_CHANGES = Object.freeze({ [GameEventType.CARD_DRAWN]: 1, [GameEventType.CARD_RETURNED]: 1, [GameEventType.CARD_PLAYED]: -1, [GameEventType.CARD_DISCARDED]: -1 });
/** Events that take a card off the top of a player's library. @type {ReadonlySet<string>} */
const LIBRARY_CHANGES = new Set([GameEventType.CARD_DRAWN, GameEventType.CARD_MILLED]);

/**
 * @param {Snapshot | null} previous the state the board showed before this update; null when there is none
 * @param {Snapshot} snapshot the state the update led to
 * @param {readonly GameEvent[]} events what happened on the way, in order
 * @returns {readonly Beat[]} at least one; the last carries `snapshot` itself
 */
export function splitIntoBeats(previous, snapshot, events) {
  const groups = beatsOf(events);
  if (groups.length <= 1 || previous === null) {
    return Object.freeze([Object.freeze({ snapshot, events, outcome: Object.freeze([]) })]);
  }
  let end = 0;
  return Object.freeze(
    groups.map((group, index) => {
      end += group.length;
      const staged = index === groups.length - 1 ? snapshot : stage(previous, snapshot, events.slice(0, end), events.slice(end));
      return Object.freeze({ snapshot: staged, events: Object.freeze(group), outcome: Object.freeze(groups[index + 1] ?? []) });
    }),
  );
}

/**
 * Cuts the events after each run of announcements that more events follow.
 * @param {readonly GameEvent[]} events
 * @returns {GameEvent[][]}
 */
function beatsOf(events) {
  /** @type {GameEvent[][]} */
  const groups = [];
  /** @type {GameEvent[]} */
  let current = [];
  for (const event of events) {
    const last = current.at(-1);
    if (last !== undefined && isAnnouncement(last) && !isAnnouncement(event)) {
      groups.push(current);
      current = [];
    }
    current.push(event);
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

/** @param {GameEvent} event */
function isAnnouncement(event) {
  return event.type === GameEventType.ABILITY_TRIGGERED;
}

/**
 * The state as it stood once `done` had happened, with `later` still to come.
 * @param {Snapshot} previous
 * @param {Snapshot} final
 * @param {readonly GameEvent[]} done
 * @param {readonly GameEvent[]} later
 * @returns {Snapshot}
 */
function stage(previous, final, done, later) {
  const pending = pendingIn(later);
  const placed = placeHeldCards(previous, final, done, pending.cards);
  const ended = done.some((event) => event.type === GameEventType.GAME_ENDED);
  return Object.freeze({
    ...final,
    isOver: ended ? final.isOver : previous.isOver,
    winnerId: ended ? final.winnerId : previous.winnerId,
    endReason: ended ? final.endReason : previous.endReason,
    players: final.players.map((player) => {
      const before = previous.players.find((candidate) => candidate.id === player.id);
      return before === undefined ? player : stagePlayer(player, before, { done, pending, placed });
    }),
  });
}

/**
 * @param {readonly GameEvent[]} later
 * @returns {Pending}
 */
function pendingIn(later) {
  /** @type {Pending} */
  const pending = { cards: new Set(), lives: new Set(), resources: new Set(), hands: new Set(), libraries: new Set() };
  for (const event of later) {
    const type = /** @type {string} */ (event.type);
    const playerId = /** @type {string} */ (event.playerId);
    for (const id of [event.instanceId, event.targetId]) {
      if (typeof id === "string") {
        pending.cards.add(id);
      }
    }
    if (type === GameEventType.LIFE_CHANGED) {
      pending.lives.add(playerId);
    }
    if (type === GameEventType.RESOURCES_CHANGED) {
      pending.resources.add(playerId);
    }
    if (type in HAND_CHANGES) {
      pending.hands.add(playerId);
    }
    if (LIBRARY_CHANGES.has(type)) {
      pending.libraries.add(playerId);
    }
  }
  return pending;
}

/**
 * Where each card that later beats still change stands once `done` has
 * happened, and how it looks: where it stood before, carried forward.
 * @param {Snapshot} previous
 * @param {Snapshot} final
 * @param {readonly GameEvent[]} done
 * @param {Set<string>} held
 * @returns {Map<string, Placement>}
 */
function placeHeldCards(previous, final, done, held) {
  const before = placementsOf(previous);
  const after = placementsOf(final);
  /** @type {Map<string, Placement>} */
  const placed = new Map();
  for (const id of held) {
    const start = before.get(id);
    if (start !== undefined) {
      placed.set(id, start);
    }
  }
  for (const event of done) {
    moveHeldCard(event, placed, after, held);
    patchHeldCard(event, placed);
    if (event.type === GameEventType.TURN_STARTED) {
      readyCreaturesOf(/** @type {string} */ (event.playerId), placed);
    }
  }
  return placed;
}

/**
 * Carries a held card to wherever `event` sends it. One the board has not
 * shown yet (just drawn, just played) takes its looks from the final state.
 * @param {GameEvent} event
 * @param {Map<string, Placement>} placed
 * @param {Map<string, Placement>} after
 * @param {Set<string>} held
 */
function moveHeldCard(event, placed, after, held) {
  const move = MOVES[/** @type {string} */ (event.type)]?.(event);
  if (move === undefined || typeof move.id !== "string" || !held.has(move.id)) {
    return;
  }
  const card = placed.get(move.id)?.card ?? after.get(move.id)?.card ?? null;
  const zone = /** @type {string} */ (move.zone);
  placed.set(move.id, { card: card === null ? null : { ...card, zone }, playerId: /** @type {string} */ (move.playerId), zone });
}

/**
 * Changes a held card's numbers as `event` says they changed.
 * @param {GameEvent} event
 * @param {Map<string, Placement>} placed
 */
function patchHeldCard(event, placed) {
  const patch = PATCHES[/** @type {string} */ (event.type)];
  const target = typeof event.targetId === "string" ? placed.get(event.targetId) : undefined;
  if (patch !== undefined && target !== undefined && target.card !== null) {
    target.card = patch(target.card, event);
  }
}

/**
 * A new turn readies the creatures of the player whose turn it is.
 * @param {string} playerId
 * @param {Map<string, Placement>} placed
 */
function readyCreaturesOf(playerId, placed) {
  for (const entry of placed.values()) {
    if (entry.card !== null && entry.zone === ZoneType.BATTLEFIELD && entry.card.controllerId === playerId) {
      entry.card = { ...entry.card, exhausted: false, summoningSick: false };
    }
  }
}

/**
 * Every card the snapshot shows, by id, with where it stands.
 * @param {Snapshot} snapshot
 * @returns {Map<string, Placement>}
 */
function placementsOf(snapshot) {
  /** @type {Map<string, Placement>} */
  const placements = new Map();
  for (const player of snapshot.players) {
    for (const zone of [ZoneType.BATTLEFIELD, ZoneType.HAND, ZoneType.GRAVEYARD]) {
      for (const card of cardsIn(player, zone) ?? []) {
        placements.set(card.instanceId, { card, playerId: player.id, zone });
      }
    }
  }
  return placements;
}

/**
 * @param {PlayerView} player
 * @param {string} zone
 * @returns {readonly CardView[] | null} null for a hand nobody may see
 */
function cardsIn(player, zone) {
  if (zone === ZoneType.HAND) {
    return player.hand;
  }
  return zone === ZoneType.BATTLEFIELD ? player.battlefield : player.graveyard;
}

/**
 * One seat as it stood once `done` had happened.
 * @param {PlayerView} final
 * @param {PlayerView} before
 * @param {{ done: readonly GameEvent[], pending: Pending, placed: Map<string, Placement> }} staging
 * @returns {PlayerView}
 */
function stagePlayer(final, before, { done, pending, placed }) {
  const mine = done.filter((event) => event.playerId === final.id);
  const zone = (/** @type {string} */ name) => stageZone(name, { final, before, held: pending.cards, placed });
  const hand = final.hand === null ? null : zone(ZoneType.HAND);
  const lastOf = (/** @type {string} */ type) => mine.findLast((event) => event.type === type);
  const lifeEvent = lastOf(GameEventType.LIFE_CHANGED);
  const resourceEvent = lastOf(GameEventType.RESOURCES_CHANGED);
  const resources = resourceEvent === undefined ? before.resources : Object.freeze({ current: Number(resourceEvent.current), max: Number(resourceEvent.max) });
  const count = (/** @type {(event: GameEvent) => number} */ weigh) => mine.reduce((sum, event) => sum + weigh(event), 0);
  return Object.freeze({
    ...final,
    life: pending.lives.has(final.id) ? Number(lifeEvent?.life ?? before.life) : final.life,
    resources: pending.resources.has(final.id) ? resources : final.resources,
    hand,
    handSize: stagedCount(hand?.length, pending.hands.has(final.id), final.handSize, before.handSize + count((event) => HAND_CHANGES[/** @type {string} */ (event.type)] ?? 0)),
    librarySize: stagedCount(undefined, pending.libraries.has(final.id), final.librarySize, before.librarySize - count((event) => (LIBRARY_CHANGES.has(/** @type {string} */ (event.type)) ? 1 : 0))),
    battlefield: zone(ZoneType.BATTLEFIELD),
    graveyard: zone(ZoneType.GRAVEYARD),
  });
}

/**
 * @param {number | undefined} seen the count of cards actually shown, when they are
 * @param {boolean} held whether later beats still change it
 * @param {number} final
 * @param {number} carried the count before this update, carried forward by the events so far
 */
function stagedCount(seen, held, final, carried) {
  if (seen !== undefined) {
    return seen;
  }
  return held ? Math.max(0, carried) : final;
}

/**
 * A zone of one seat: the cards later beats leave alone as the final state
 * has them, and the ones they still change where they stood. Cards keep the
 * order they had before, so one that has yet to leave keeps its place.
 * @param {string} name
 * @param {{ final: PlayerView, before: PlayerView, held: Set<string>, placed: Map<string, Placement> }} seat
 * @returns {CardView[]}
 */
function stageZone(name, { final, before, held, placed }) {
  const kept = (cardsIn(final, name) ?? []).filter((card) => !held.has(card.instanceId));
  const carried = [...placed.values()].filter((entry) => entry.playerId === final.id && entry.zone === name && entry.card !== null).map((entry) => /** @type {CardView} */ (entry.card));
  const rank = orderFrom([...(cardsIn(before, name) ?? []), ...(cardsIn(final, name) ?? [])]);
  const rankOf = (/** @type {CardView} */ card) => rank.get(card.instanceId) ?? rank.size;
  return [...kept, ...carried]
    .map((card, index) => ({ card, index }))
    .sort((a, b) => rankOf(a.card) - rankOf(b.card) || a.index - b.index)
    .map(({ card }) => card);
}

/**
 * The first place each card appears in `cards`.
 * @param {readonly CardView[]} cards
 * @returns {Map<string, number>}
 */
function orderFrom(cards) {
  /** @type {Map<string, number>} */
  const rank = new Map();
  cards.forEach((card, index) => {
    if (!rank.has(card.instanceId)) {
      rank.set(card.instanceId, index);
    }
  });
  return rank;
}
