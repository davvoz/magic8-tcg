/**
 * Greedy rule-based opponent. Works purely from its perspective snapshot
 * and `legalMoves`, so it can only ever submit commands the engine accepts.
 * Deterministic: the same snapshot always yields the same command, which
 * keeps AI-vs-AI matches replayable from a seed.
 *
 * Heuristics (deliberately simple; a search-based AI would replace this
 * class without touching the session):
 * - Main phases: play a card that wins on the spot if there is one, else the
 *   most expensive playable card, then move on. Damage goes to the face when
 *   that is lethal, else where it kills, removal (destroy, bounce) on the
 *   strongest enemy creature, buffs on the strongest ally. Healing spells
 *   stay in hand while nothing of its own is hurt, harmful spells while
 *   they could only hit its own side.
 * - Attack with creatures that cannot be blocked and killed for free; attack
 *   with everything when unblocked damage would be lethal.
 * - Block to kill an attacker and survive, to trade evenly, or to chump when
 *   the incoming damage would be lethal.
 */
import { CardType } from "@magic8/engine/domain/cards/CardType.js";
import { declareAttackers, declareBlockers, endPhase, endTurn, playCard } from "@magic8/engine/domain/commands/commandFactories.js";
import { TargetKind, TargetOwner } from "@magic8/engine/domain/effects/TargetSpec.js";
import { TriggerType } from "@magic8/engine/domain/effects/TriggerType.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";
import { ControllerKind } from "./PlayerController.contract.js";

/** @typedef {import("@magic8/engine/domain/game/GameSnapshot.js").CardView} CardView */
/** @typedef {ReturnType<import("@magic8/engine/domain/game/GameEngine.js").GameEngine["getSnapshot"]>} Snapshot */
/** @typedef {Snapshot["players"][number]} PlayerView */
/**
 * The snapshot of the player to move, whose legal moves are known.
 * @typedef {Snapshot & { legalMoves: NonNullable<Snapshot["legalMoves"]> }} MoveSnapshot
 */

const DAMAGE = "deal_damage";
const DRAIN = "drain";
const HEAL = "heal";
const SACRIFICE = "sacrifice";
const MODIFY_STATS = "modify_stats";
/** Removal aimed at enemy creatures regardless of their health. */
const REMOVAL = Object.freeze(["destroy", "return_to_hand"]);
/** Effects that hurt whatever they target. */
const HARMFUL = Object.freeze([DAMAGE, DRAIN, ...REMOVAL]);

export class BasicAiController {
  kind = ControllerKind.AI;

  /**
   * @param {Snapshot} snapshot
   * @returns {Readonly<Record<string, unknown>> | null}
   */
  decide(snapshot) {
    const me = snapshot.perspectivePlayerId;
    if (me === null || snapshot.isOver || snapshot.awaitingPlayerId !== me || snapshot.legalMoves === null) {
      return null;
    }
    const moving = /** @type {MoveSnapshot} */ (snapshot);
    const board = boardFor(moving, me);
    switch (moving.phase) {
      case GamePhase.MAIN_1:
      case GamePhase.MAIN_2:
        return this.#mainPhase(moving, board);
      case GamePhase.COMBAT_ATTACKERS:
        return declareAttackers(me, chooseAttackers(moving, board));
      case GamePhase.COMBAT_BLOCKERS:
        return declareBlockers(me, chooseBlocks(moving, board));
      default:
        return null;
    }
  }

  /**
   * @param {MoveSnapshot} snapshot
   * @param {Board} board
   */
  #mainPhase(snapshot, board) {
    const { legalMoves } = snapshot;
    const playable = board.me.hand.filter((card) => legalMoves.playableCardIds.includes(card.instanceId));
    const card = chooseCard(playable, legalMoves, board);
    if (card !== undefined) {
      const targets = legalMoves.targetOptions[card.instanceId].flatMap((options, index) => chooseTargets(card, index, options, board));
      return playCard(board.me.id, card.instanceId, targets);
    }
    if (snapshot.phase === GamePhase.MAIN_1 && legalMoves.canEndPhase) {
      return endPhase(board.me.id);
    }
    return legalMoves.canEndTurn ? endTurn(board.me.id) : endPhase(board.me.id);
  }
}

/**
 * The player to move (whose hand is always revealed to them) and the opponent.
 * @typedef {{ me: PlayerView & { hand: NonNullable<PlayerView["hand"]> }, enemy: PlayerView }} Board
 */

/**
 * @param {Snapshot} snapshot
 * @param {string} me
 * @returns {Board}
 */
function boardFor(snapshot, me) {
  const mine = snapshot.players.find((player) => player.id === me);
  const theirs = snapshot.players.find((player) => player.id !== me);
  if (mine === undefined || mine.hand === null || theirs === undefined) {
    throw new Error("BasicAiController: malformed snapshot");
  }
  return { me: { ...mine, hand: mine.hand }, enemy: theirs };
}

/**
 * A card that wins on the spot beats every board consideration; otherwise
 * spend the turn on the most expensive card in hand.
 * @param {readonly CardView[]} playable
 * @param {import("@magic8/engine/domain/game/LegalMoves.js").LegalMoves} legalMoves
 * @param {Board} board
 * @returns {CardView | undefined}
 */
function chooseCard(playable, legalMoves, board) {
  const byCost = [...playable]
    .filter((card) => !isWastedHeal(card, legalMoves.targetOptions[card.instanceId], board) && !isSelfHarm(card, legalMoves.targetOptions[card.instanceId], board))
    .sort((a, b) => b.cost - a.cost);
  return byCost.find((card) => faceDamage(card, legalMoves.targetOptions[card.instanceId], board) >= board.enemy.life) ?? byCost[0];
}

/**
 * A spell that only heals is wasted when none of its targets is hurt:
 * no wounded friendly creature and the AI already at full life.
 * @param {CardView} card
 * @param {readonly (readonly string[])[]} targetOptions
 * @param {Board} board
 */
function isWastedHeal(card, targetOptions, board) {
  const abilities = playAbilities(card);
  if (card.type !== CardType.SPELL || abilities.length === 0 || abilities.some((ability) => ability.effect !== HEAL)) {
    return false;
  }
  const wounded = new Set(board.me.battlefield.filter((creature) => creature.damage > 0).map((creature) => creature.instanceId));
  if (board.me.life < board.me.maxLife) {
    wounded.add(board.me.id);
  }
  const selfHealsItself = abilities.some((ability) => ability.target !== null && isAutomaticTarget(ability.target) && ability.target.owner === TargetOwner.ALLY);
  const reachesWounded = targetOptions.some((options) => options.some((id) => wounded.has(id)));
  return !(reachesWounded || (selfHealsItself && wounded.has(board.me.id)));
}

/**
 * A harmful spell with no enemy to aim at would land on the AI's own side
 * (e.g. Quick Strike with only friendly creatures on the battlefield).
 * @param {CardView} card
 * @param {readonly (readonly string[])[]} targetOptions
 * @param {Board} board
 */
function isSelfHarm(card, targetOptions, board) {
  if (card.type !== CardType.SPELL) {
    return false;
  }
  const enemyIds = new Set([board.enemy.id, ...board.enemy.battlefield.map((creature) => creature.instanceId)]);
  return playerTargetedAbilities(card).some((ability, index) => isHarmful(ability) && !(targetOptions[index] ?? []).some((id) => enemyIds.has(id)));
}

/** @param {import("@magic8/engine/domain/game/GameSnapshot.js").AbilityView} ability */
function isHarmful(ability) {
  return HARMFUL.includes(ability.effect) || (ability.effect === MODIFY_STATS && isDebuff(ability.params));
}

/**
 * Damage the card can put on the enemy player's own life total when played
 * now: its automatic play abilities plus every chosen target the AI is free
 * to aim at the player.
 * @param {CardView} card
 * @param {readonly (readonly string[])[]} targetOptions
 * @param {Board} board
 * @returns {number}
 */
function faceDamage(card, targetOptions, board) {
  let total = 0;
  let chosenIndex = 0;
  for (const ability of playAbilities(card)) {
    if (ability.target === null) {
      continue;
    }
    const amount = ability.effect === DAMAGE || ability.effect === DRAIN ? Number(ability.params?.amount ?? 0) : 0;
    if (isAutomaticTarget(ability.target)) {
      total += ability.target.owner === TargetOwner.ENEMY ? amount : 0;
      continue;
    }
    total += (targetOptions[chosenIndex] ?? []).includes(board.enemy.id) ? amount : 0;
    chosenIndex += 1;
  }
  return total;
}

/**
 * The card's play-trigger abilities, in the order the engine fires them.
 * @param {CardView} card
 * @returns {readonly import("@magic8/engine/domain/game/GameSnapshot.js").AbilityView[]}
 */
function playAbilities(card) {
  const trigger = card.type === CardType.CREATURE ? TriggerType.ON_PLAY : TriggerType.ON_CAST;
  return card.abilities.filter((ability) => ability.trigger === trigger);
}

/**
 * The abilities whose targets travel in the PLAY_CARD command, in the order
 * `legalMoves.targetOptions` lists them (mirrors Playability).
 * @param {CardView} card
 * @returns {readonly import("@magic8/engine/domain/game/GameSnapshot.js").AbilityView[]}
 */
function playerTargetedAbilities(card) {
  return playAbilities(card).filter((ability) => ability.target !== null && !isAutomaticTarget(ability.target));
}

/**
 * Mirrors TargetSpec.isAutomatic: the engine resolves these itself.
 * @param {NonNullable<import("@magic8/engine/domain/game/GameSnapshot.js").AbilityView["target"]>} target
 */
function isAutomaticTarget(target) {
  return target.kind === TargetKind.PLAYER && target.owner !== TargetOwner.ANY && target.count === 1;
}

/**
 * Picks targets for the card's n-th player-targeted play ability.
 * @param {CardView} card
 * @param {number} abilityIndex
 * @param {readonly string[]} options
 * @param {Board} board
 * @returns {string[]}
 */
function chooseTargets(card, abilityIndex, options, board) {
  if (options.length === 0) {
    return [];
  }
  const ability = playerTargetedAbilities(card)[abilityIndex];
  const creaturesById = new Map([...board.me.battlefield, ...board.enemy.battlefield].map((creature) => [creature.instanceId, creature]));
  const creatures = options.map((id) => creaturesById.get(id)).filter((creature) => creature !== undefined);
  const players = options.filter((id) => id === board.me.id || id === board.enemy.id);
  const pick = choosePreferredTarget(ability?.effect, ability?.params, { creatures, players, board });
  return [pick ?? options[0]];
}

/**
 * @param {string | undefined} effect
 * @param {Readonly<Record<string, number | string>> | undefined} params
 * @param {{ creatures: CardView[], players: string[], board: Board }} context
 * @returns {string | undefined}
 */
function choosePreferredTarget(effect, params, { creatures, players, board }) {
  const enemies = creatures.filter((creature) => creature.controllerId === board.enemy.id);
  if (effect === DAMAGE || effect === DRAIN) {
    return chooseDamageTarget(Number(params?.amount ?? 0), { creatures, players, board });
  }
  if (effect !== undefined && REMOVAL.includes(effect)) {
    return strongest(enemies)?.instanceId;
  }
  if (effect === MODIFY_STATS && isDebuff(params)) {
    return chooseWeakenTarget(Number(params?.health ?? 0), enemies);
  }
  return chooseAllyTarget(effect, { creatures, players, board });
}

/** @param {Readonly<Record<string, number | string>> | undefined} params */
function isDebuff(params) {
  return Number(params?.attack ?? 0) < 0 || Number(params?.health ?? 0) < 0;
}

/**
 * Heal the strongest wounded ally (or self), sacrifice the weakest ally,
 * put anything else (a buff) on the strongest ally.
 * @param {string | undefined} effect
 * @param {{ creatures: CardView[], players: string[], board: Board }} context
 * @returns {string | undefined}
 */
function chooseAllyTarget(effect, { creatures, players, board }) {
  const allies = creatures.filter((creature) => creature.controllerId === board.me.id);
  if (effect === HEAL) {
    return strongest(allies.filter((creature) => creature.damage > 0))?.instanceId ?? (players.includes(board.me.id) ? board.me.id : strongest(allies)?.instanceId);
  }
  if (effect === SACRIFICE) {
    return weakest(allies)?.instanceId;
  }
  return strongest(allies)?.instanceId;
}

/**
 * A debuff goes on the strongest enemy creature it kills outright, else on
 * the strongest enemy creature.
 * @param {number} health Signed health modifier of the debuff.
 * @param {readonly CardView[]} enemies
 * @returns {string | undefined}
 */
function chooseWeakenTarget(health, enemies) {
  return (strongest(enemies.filter((creature) => creature.health <= -health)) ?? strongest(enemies))?.instanceId;
}

/**
 * Win the game if the damage is lethal; else kill the strongest enemy
 * creature the damage can finish; otherwise hit the enemy player, or the
 * strongest enemy creature when players are not allowed.
 * @param {number} amount
 * @param {{ creatures: CardView[], players: string[], board: Board }} context
 * @returns {string | undefined}
 */
function chooseDamageTarget(amount, { creatures, players, board }) {
  const canHitFace = players.includes(board.enemy.id);
  if (canHitFace && amount >= board.enemy.life) {
    return board.enemy.id;
  }
  const enemies = creatures.filter((creature) => creature.controllerId === board.enemy.id);
  const kill = strongest(enemies.filter((creature) => creature.health <= amount));
  if (kill !== undefined) {
    return kill.instanceId;
  }
  return canHitFace ? board.enemy.id : strongest(enemies)?.instanceId;
}

/**
 * @param {readonly CardView[]} creatures
 * @returns {CardView | undefined}
 */
function weakest(creatures) {
  return [...creatures].sort((a, b) => a.attack - b.attack || a.health - b.health)[0];
}

/**
 * @param {readonly CardView[]} creatures
 * @returns {CardView | undefined}
 */
function strongest(creatures) {
  return [...creatures].sort((a, b) => b.attack - a.attack || b.health - a.health)[0];
}

/**
 * @param {MoveSnapshot} snapshot
 * @param {Board} board
 * @returns {string[]}
 */
function chooseAttackers(snapshot, board) {
  const candidates = board.me.battlefield.filter((creature) => snapshot.legalMoves.attackerIds.includes(creature.instanceId) && creature.attack > 0);
  const blockers = board.enemy.battlefield.filter((creature) => !creature.exhausted);
  const totalDamage = candidates.reduce((sum, creature) => sum + creature.attack, 0);
  if (totalDamage >= board.enemy.life) {
    return candidates.map((creature) => creature.instanceId);
  }
  const safe = candidates.filter((attacker) => !blockers.some((blocker) => blocker.attack >= attacker.health && blocker.health > attacker.attack));
  return safe.map((creature) => creature.instanceId);
}

/**
 * @param {MoveSnapshot} snapshot
 * @param {Board} board
 * @returns {{ attackerId: string, blockerId: string }[]}
 */
function chooseBlocks(snapshot, board) {
  const attackers = snapshot.combat.attackerIds
    .map((id) => board.enemy.battlefield.find((creature) => creature.instanceId === id))
    .filter((creature) => creature !== undefined)
    .sort((a, b) => b.attack - a.attack);
  const available = board.me.battlefield.filter((creature) => snapshot.legalMoves.blockerIds.includes(creature.instanceId));
  const incoming = attackers.reduce((sum, attacker) => sum + attacker.attack, 0);
  const blocks = [];
  for (const attacker of attackers) {
    const blocker = pickBlocker(attacker, available, incoming >= board.me.life);
    if (blocker !== undefined) {
      blocks.push({ attackerId: attacker.instanceId, blockerId: blocker.instanceId });
      available.splice(available.indexOf(blocker), 1);
    }
  }
  return blocks;
}

/**
 * @param {CardView} attacker
 * @param {CardView[]} available
 * @param {boolean} lethalIncoming
 * @returns {CardView | undefined}
 */
function pickBlocker(attacker, available, lethalIncoming) {
  const kills = (blocker) => blocker.attack >= attacker.health;
  const survives = (blocker) => blocker.health > attacker.attack;
  const ideal = available.find((blocker) => kills(blocker) && survives(blocker));
  if (ideal !== undefined) {
    return ideal;
  }
  const trade = available.find((blocker) => kills(blocker) && blocker.cost <= attacker.cost);
  if (trade !== undefined) {
    return trade;
  }
  const wall = available.find((blocker) => survives(blocker));
  if (wall !== undefined) {
    return wall;
  }
  return lethalIncoming ? [...available].sort((a, b) => a.cost - b.cost)[0] : undefined;
}
