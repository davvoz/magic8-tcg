/**
 * A key that two positions share when they are the same for the search:
 * same phase, life, resources, cards in hand and creatures, whatever order
 * the moves that led there came in (two Ember Imps played in either order).
 * Creatures and hand cards are keyed by what they are, not by instance, so
 * playing either of two identical cards also leads to one key.
 */
import { ModifierDuration } from "../../cards/CardInstance.js";

/** @typedef {import("../AiPolicy.contract.js").Snapshot} Snapshot */
/** @typedef {import("../../game/GameSnapshot.js").CardView} CardView */

/**
 * @param {Snapshot} snapshot
 * @returns {string}
 */
export function positionKey(snapshot) {
  const players = snapshot.players.map((player) =>
    [
      player.life,
      player.resources.current,
      player.handSize,
      player.librarySize,
      player.graveyard.length,
      sortedJoin((player.hand ?? []).map((card) => card.definitionId)),
      sortedJoin(player.battlefield.map(creatureKey)),
    ].join(";"),
  );
  return `${snapshot.activePlayerId}|${snapshot.phase}|${players.join("|")}`;
}

/** @param {CardView} card */
function creatureKey(card) {
  const temporary = card.modifiers.filter((modifier) => modifier.duration !== ModifierDuration.PERMANENT).length;
  return `${card.definitionId}:${card.attack}/${card.health}/${card.maxHealth}:${Number(card.exhausted)}${Number(card.summoningSick)}:${temporary}`;
}

/** @param {string[]} parts */
function sortedJoin(parts) {
  return parts.sort().join(",");
}
