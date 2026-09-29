/**
 * Human-readable entries for engine events, for the match log, each tagged
 * with a kind so the log can tell them apart at a glance. Ids are resolved
 * against the current snapshot; cards that already left the board fall back
 * to their id.
 */
import { GameEventType } from "@magic8/engine/domain/game/GameEventType.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";

/** What a log entry is about; the battle log colours entries by it. */
export const LogKind = Object.freeze({
  TURN: "turn",
  PLAY: "play",
  COMBAT: "combat",
  DAMAGE: "damage",
  LOSS: "loss",
  HEAL: "heal",
  END: "end",
  REJECTED: "rejected",
});

/**
 * @typedef {typeof LogKind[keyof typeof LogKind]} LogKindValue
 * @typedef {Readonly<{ text: string, kind: LogKindValue }>} LogEntry
 */
/** @typedef {ReturnType<import("../../application/match/MatchSession.js").MatchSession["snapshotFor"]>} Snapshot */

/** @type {Readonly<Record<string, LogKindValue>>} */
const KINDS = Object.freeze({
  [GameEventType.CARD_PLAYED]: LogKind.PLAY,
  [GameEventType.ATTACKERS_DECLARED]: LogKind.COMBAT,
  [GameEventType.BLOCKERS_DECLARED]: LogKind.COMBAT,
  [GameEventType.DAMAGE_DEALT]: LogKind.DAMAGE,
  [GameEventType.CREATURE_SACRIFICED]: LogKind.LOSS,
  [GameEventType.CREATURE_DESTROYED]: LogKind.LOSS,
  [GameEventType.CARD_RETURNED]: LogKind.LOSS,
  [GameEventType.CARD_MILLED]: LogKind.LOSS,
  [GameEventType.CREATURE_DIED]: LogKind.LOSS,
  [GameEventType.CARD_DISCARDED]: LogKind.LOSS,
  [GameEventType.HEALED]: LogKind.HEAL,
  [GameEventType.FATIGUE_DAMAGE]: LogKind.DAMAGE,
  [GameEventType.TURN_STARTED]: LogKind.TURN,
  [GameEventType.PLAYER_CONCEDED]: LogKind.END,
  [GameEventType.GAME_ENDED]: LogKind.END,
});

/** @type {Readonly<Record<string, (event: Readonly<Record<string, unknown>>, names: (id: unknown) => string) => string>>} */
const DESCRIBERS = Object.freeze({
  [GameEventType.CARD_PLAYED]: (event, names) => {
    const targets = /** @type {readonly string[]} */ (event.targetIds ?? []);
    const verb = event.zone === ZoneType.BATTLEFIELD ? "played" : "cast";
    const on = targets.length === 0 ? "" : ` on ${targets.map(names).join(", ")}`;
    return `${names(event.playerId)} ${verb} ${names(event.instanceId)}${on}`;
  },
  [GameEventType.ATTACKERS_DECLARED]: (event, names) => {
    const attackers = /** @type {readonly string[]} */ (event.attackerIds ?? []);
    return attackers.length === 0 ? `${names(event.playerId)} skipped combat` : `${names(event.playerId)} attacks with ${attackers.map(names).join(", ")}`;
  },
  [GameEventType.BLOCKERS_DECLARED]: (event, names) => {
    const blocks = /** @type {readonly { attackerId: string, blockerId: string }[]} */ (event.blocks ?? []);
    return blocks.length === 0 ? `${names(event.playerId)} does not block` : blocks.map((block) => `${names(block.blockerId)} blocks ${names(block.attackerId)}`).join("; ");
  },
  [GameEventType.DAMAGE_DEALT]: (event, names) => (event.sourceId === undefined ? `${names(event.targetId)} takes ${event.amount}` : `${names(event.sourceId)} deals ${event.amount} to ${names(event.targetId)}`),
  [GameEventType.CREATURE_SACRIFICED]: (event, names) => `${names(event.targetId)} was sacrificed`,
  [GameEventType.CREATURE_DESTROYED]: (event, names) => `${names(event.targetId)} was destroyed`,
  [GameEventType.CARD_RETURNED]: (event, names) => `${names(event.targetId)} returned to ${names(event.playerId)}'s hand`,
  [GameEventType.CARD_MILLED]: (event, names) => `${names(event.playerId)} milled ${names(event.instanceId)}`,
  [GameEventType.CREATURE_DIED]: (event, names) => `${names(event.instanceId)} died`,
  [GameEventType.CARD_DISCARDED]: (event, names) => `${names(event.playerId)} discarded ${names(event.instanceId)}`,
  [GameEventType.HEALED]: (event, names) => `${names(event.targetId)} healed ${event.amount}`,
  [GameEventType.FATIGUE_DAMAGE]: (event, names) => `${names(event.playerId)} took ${event.amount} fatigue damage`,
  [GameEventType.TURN_STARTED]: (event, names) => `Turn ${event.turnNumber}: ${names(event.playerId)}`,
  [GameEventType.PLAYER_CONCEDED]: (event, names) => `${names(event.playerId)} conceded`,
  [GameEventType.GAME_ENDED]: (event, names) => (event.winnerId === null ? "The game is a draw" : `${names(event.winnerId)} wins`),
});

/**
 * @param {Readonly<Record<string, unknown>>} event
 * @param {Snapshot} snapshot
 * @returns {LogEntry | null} null for events that are not worth a log line
 */
export function describeEvent(event, snapshot) {
  const type = /** @type {string} */ (event.type);
  const describe = DESCRIBERS[type];
  if (describe === undefined) {
    return null;
  }
  return Object.freeze({ text: describe(event, (id) => nameOf(id, snapshot)), kind: KINDS[type] });
}

/**
 * @param {unknown} id
 * @param {Snapshot} snapshot
 */
function nameOf(id, snapshot) {
  const player = snapshot.players.find((candidate) => candidate.id === id);
  if (player !== undefined) {
    return player.name;
  }
  const card = snapshot.players.flatMap((candidate) => [...candidate.battlefield, ...candidate.graveyard, ...(candidate.hand ?? [])]).find((candidate) => candidate.instanceId === id);
  return card?.name ?? String(id);
}
