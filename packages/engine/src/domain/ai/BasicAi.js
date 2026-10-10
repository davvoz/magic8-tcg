/**
 * Greedy rule-based player. Works purely from its perspective snapshot
 * and `legalMoves`, so it can only ever submit commands the engine accepts.
 * Deterministic: the same snapshot and style always yield the same command,
 * which keeps AI-vs-AI games replayable from a seed (the auto ranked mode
 * plays both seats with it on the server, docs/tcg/23-automatica.md).
 *
 * Heuristics (deliberately simple; a search-based AI would replace this
 * class without touching its callers):
 * - Main phases: play a card that wins on the spot if there is one (a burn
 *   spell, or before combat a haste creature whose attack makes the
 *   unblocked damage lethal), else the most expensive playable card (haste
 *   first on ties before combat), then move on. Damage goes to the face when
 *   that is lethal, else where it kills, removal (destroy, bounce) on the
 *   strongest enemy creature, buffs on the strongest ally. Healing spells
 *   stay in hand while nothing of its own is hurt, harmful spells while
 *   they could only hit its own side, sacrifice cards while the cheapest
 *   victim is worth more than half of what the card brings.
 * - Attack with creatures that cannot be blocked and killed for free; attack
 *   with everything when unblocked damage would be lethal. Attackers without
 *   vigilance cannot block the enemy's next attack, so they stay home while
 *   that attack would otherwise be lethal.
 * - Block to kill an attacker and survive, to trade evenly, or to chump when
 *   the incoming damage would be lethal. A blocked trampler still hits for
 *   its attack beyond the blocker's health, so chumping it takes the blocker
 *   that stops the most.
 *
 * A style shifts those rules (STYLE_RULES); BALANCED is the rules above.
 */
import { CardType } from "../cards/CardType.js";
import { declareAttackers, declareBlockers, endPhase, endTurn, playCard } from "../commands/commandFactories.js";
import { Keyword } from "../effects/Keyword.js";
import { TargetKind, TargetOwner } from "../effects/TargetSpec.js";
import { TriggerType } from "../effects/TriggerType.js";
import { GamePhase } from "../game/GamePhase.js";

/** @typedef {import("../game/GameSnapshot.js").CardView} CardView */
/** @typedef {ReturnType<import("../game/GameEngine.js").GameEngine["getSnapshot"]>} Snapshot */
/** @typedef {Snapshot["players"][number]} PlayerView */
/**
 * The snapshot of the player to move, whose legal moves are known.
 * @typedef {Snapshot & { legalMoves: NonNullable<Snapshot["legalMoves"]> }} MoveSnapshot
 */

/**
 * Version of the decision rules. A change to what the AI decides in any
 * situation is a new version: auto games record the version that played
 * them, so a replay can be checked against the rules of that version.
 */
export const AI_VERSION = 2;

export const AiStyle = Object.freeze({ AGGRESSIVE: "aggressive", BALANCED: "balanced", DEFENSIVE: "defensive" });
export const AI_STYLES = Object.freeze(Object.values(AiStyle));

/**
 * What a style changes.
 * - allInBelow: attack with everything once the enemy is at this life or less (0: only when lethal).
 * - attackOnly: "safe" attacks with creatures no untapped blocker kills for free; "untouchable" with creatures no
 *   untapped blocker kills at all.
 * - blockTrades / blockWalls: block to trade evenly / with a blocker that survives without killing.
 * - chumpBelow: also chump-block when the hit would leave it at this share of its maximum life or less (0: only lethal).
 * - faceBelow: damage goes to the enemy player, not to a creature it kills, once the enemy is at this life or less.
 * @typedef {Readonly<{ allInBelow: number, attackOnly: "safe" | "untouchable", blockTrades: boolean, blockWalls: boolean, chumpBelow: number, faceBelow: number }>} StyleRules
 */

/** @type {Readonly<Record<string, StyleRules>>} */
const STYLE_RULES = Object.freeze({
  [AiStyle.AGGRESSIVE]: Object.freeze({ allInBelow: 5, attackOnly: "safe", blockTrades: false, blockWalls: true, chumpBelow: 0, faceBelow: 8 }),
  [AiStyle.BALANCED]: Object.freeze({ allInBelow: 0, attackOnly: "safe", blockTrades: true, blockWalls: true, chumpBelow: 0, faceBelow: 0 }),
  [AiStyle.DEFENSIVE]: Object.freeze({ allInBelow: 0, attackOnly: "untouchable", blockTrades: true, blockWalls: true, chumpBelow: 0.5, faceBelow: 0 }),
});

const DAMAGE = "deal_damage";
const DRAIN = "drain";
const HEAL = "heal";
const SACRIFICE = "sacrifice";
const MODIFY_STATS = "modify_stats";
const DRAW_CARD = "draw_card";
/** What a drawn card is worth, in the attack + health currency of `value`. */
const DRAWN_CARD_VALUE = 4;
/** Removal aimed at enemy creatures regardless of their health. */
const REMOVAL = Object.freeze(["destroy", "return_to_hand"]);
/** Effects that hurt whatever they target. */
const HARMFUL = Object.freeze([DAMAGE, DRAIN, ...REMOVAL]);

export class BasicAi {
  #style;
  #rules;

  /** @param {string} [style] one of AiStyle */
  constructor(style = AiStyle.BALANCED) {
    const rules = STYLE_RULES[style];
    if (rules === undefined) {
      throw new TypeError(`unknown AI style "${style}"; expected one of ${AI_STYLES.join(", ")}`);
    }
    this.#style = style;
    this.#rules = rules;
  }

  get style() {
    return this.#style;
  }

  /**
   * The command to submit for the player whose perspective this is, or null when it is not theirs to move.
   * @param {Snapshot} snapshot
   * @returns {Readonly<Record<string, unknown>> | null}
   */
  decide(snapshot) {
    const me = snapshot.perspectivePlayerId;
    if (me === null || snapshot.isOver || snapshot.awaitingPlayerId !== me || snapshot.legalMoves === null) {
      return null;
    }
    const moving = /** @type {MoveSnapshot} */ (snapshot);
    const board = boardFor(moving, me, this.#rules);
    switch (moving.phase) {
      case GamePhase.MAIN_1:
      case GamePhase.MAIN_2:
        return mainPhase(moving, board);
      case GamePhase.COMBAT_ATTACKERS:
        return declareAttackers(me, chooseAttackers(moving, board));
      case GamePhase.COMBAT_BLOCKERS:
        return declareBlockers(me, chooseBlocks(moving, board));
      default:
        return null;
    }
  }
}

/**
 * @param {MoveSnapshot} snapshot
 * @param {Board} board
 */
function mainPhase(snapshot, board) {
  const { legalMoves } = snapshot;
  const playable = board.me.hand.filter((card) => legalMoves.playableCardIds.includes(card.instanceId));
  const card = chooseCard(playable, legalMoves, board, snapshot.phase === GamePhase.MAIN_1);
  if (card !== undefined) {
    const targets = legalMoves.targetOptions[card.instanceId].flatMap((options, index) => chooseTargets(card, index, options, board));
    return playCard(board.me.id, card.instanceId, targets);
  }
  if (snapshot.phase === GamePhase.MAIN_1 && legalMoves.canEndPhase) {
    return endPhase(board.me.id);
  }
  return legalMoves.canEndTurn ? endTurn(board.me.id) : endPhase(board.me.id);
}

/**
 * The player to move (whose hand is always revealed to them), the opponent, and the style it plays.
 * @typedef {{ me: PlayerView & { hand: NonNullable<PlayerView["hand"]> }, enemy: PlayerView, rules: StyleRules }} Board
 */

/**
 * @param {Snapshot} snapshot
 * @param {string} me
 * @param {StyleRules} rules
 * @returns {Board}
 */
function boardFor(snapshot, me, rules) {
  const mine = snapshot.players.find((player) => player.id === me);
  const theirs = snapshot.players.find((player) => player.id !== me);
  if (mine === undefined || mine.hand === null || theirs === undefined) {
    throw new Error("BasicAi: malformed snapshot");
  }
  return { me: { ...mine, hand: mine.hand }, enemy: theirs, rules };
}

/**
 * A card that wins on the spot beats every board consideration; otherwise
 * spend the turn on the most expensive card in hand.
 * @param {readonly CardView[]} playable
 * @param {import("../game/LegalMoves.js").LegalMoves} legalMoves
 * @param {Board} board
 * @param {boolean} beforeCombat a haste creature played now attacks this turn
 * @returns {CardView | undefined}
 */
function chooseCard(playable, legalMoves, board, beforeCombat) {
  const strikesNow = (card) => beforeCombat && card.type === CardType.CREATURE && hasKeyword(card, Keyword.HASTE);
  const byCost = [...playable]
    .filter((card) => !isWasted(card, legalMoves.targetOptions[card.instanceId], board))
    .sort((a, b) => b.cost - a.cost || Number(strikesNow(b)) - Number(strikesNow(a)));
  const readyAttack = board.me.battlefield.filter((creature) => !creature.exhausted && !creature.summoningSick).reduce((sum, creature) => sum + creature.attack, 0);
  const wins = (card) =>
    faceDamage(card, legalMoves.targetOptions[card.instanceId], board) >= board.enemy.life || (strikesNow(card) && readyAttack + card.attack >= board.enemy.life);
  return byCost.find(wins) ?? byCost[0];
}

/**
 * @param {CardView} card
 * @param {string} keyword one of Keyword
 */
function hasKeyword(card, keyword) {
  return card.keywords.includes(keyword);
}

/**
 * @param {CardView} card
 * @param {readonly (readonly string[])[]} targetOptions
 * @param {Board} board
 */
function isWasted(card, targetOptions, board) {
  return isWastedHeal(card, targetOptions, board) || isSelfHarm(card, targetOptions, board) || isBadSacrifice(card, targetOptions, board);
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

/** @param {import("../game/GameSnapshot.js").AbilityView} ability */
function isHarmful(ability) {
  return HARMFUL.includes(ability.effect) || (ability.effect === MODIFY_STATS && isDebuff(ability.params));
}

/**
 * A sacrifice pays off only when the victim is worth at most half of what
 * the card brings (its own body plus the cards it draws): a healthy Bone
 * Colossus is never traded for another one.
 * @param {CardView} card
 * @param {readonly (readonly string[])[]} targetOptions
 * @param {Board} board
 */
function isBadSacrifice(card, targetOptions, board) {
  const index = playerTargetedAbilities(card).findIndex((ability) => ability.effect === SACRIFICE);
  if (index === -1) {
    return false;
  }
  const victim = weakest(board.me.battlefield.filter((creature) => (targetOptions[index] ?? []).includes(creature.instanceId)));
  return victim !== undefined && 2 * value(victim) > sacrificeGain(card);
}

/**
 * @param {CardView} card
 * @returns {number}
 */
function sacrificeGain(card) {
  const body = card.type === CardType.CREATURE ? value(card) : 0;
  const draws = playAbilities(card)
    .filter((ability) => ability.effect === DRAW_CARD)
    .reduce((sum, ability) => sum + Number(ability.params?.amount ?? 0), 0);
  return body + draws * DRAWN_CARD_VALUE;
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
 * @returns {readonly import("../game/GameSnapshot.js").AbilityView[]}
 */
function playAbilities(card) {
  const trigger = card.type === CardType.CREATURE ? TriggerType.ON_PLAY : TriggerType.ON_CAST;
  return card.abilities.filter((ability) => ability.trigger === trigger);
}

/**
 * The abilities whose targets travel in the PLAY_CARD command, in the order
 * `legalMoves.targetOptions` lists them (mirrors Playability).
 * @param {CardView} card
 * @returns {readonly import("../game/GameSnapshot.js").AbilityView[]}
 */
function playerTargetedAbilities(card) {
  return playAbilities(card).filter((ability) => ability.target !== null && !isAutomaticTarget(ability.target));
}

/**
 * Mirrors TargetSpec.isAutomatic: the engine resolves these itself.
 * @param {NonNullable<import("../game/GameSnapshot.js").AbilityView["target"]>} target
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
 * Win the game if the damage is lethal, or hit the enemy player once they are
 * low enough for the style; else kill the strongest enemy creature the damage
 * can finish; otherwise hit the enemy player, or the strongest enemy
 * creature when players are not allowed.
 * @param {number} amount
 * @param {{ creatures: CardView[], players: string[], board: Board }} context
 * @returns {string | undefined}
 */
function chooseDamageTarget(amount, { creatures, players, board }) {
  const canHitFace = players.includes(board.enemy.id);
  if (canHitFace && (amount >= board.enemy.life || board.enemy.life <= board.rules.faceBelow)) {
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
 * Rough worth of a creature on the battlefield: its attack plus its current health.
 * @param {CardView} creature
 */
function value(creature) {
  return creature.attack + creature.health;
}

/**
 * The creature worth least, the cheapest on ties.
 * @param {readonly CardView[]} creatures
 * @returns {CardView | undefined}
 */
function weakest(creatures) {
  return [...creatures].sort((a, b) => value(a) - value(b) || a.cost - b.cost)[0];
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
  if (totalDamage >= board.enemy.life || board.enemy.life <= board.rules.allInBelow) {
    return candidates.map((creature) => creature.instanceId);
  }
  const untouchable = board.rules.attackOnly === "untouchable";
  const safe = candidates.filter((attacker) => !blockers.some((blocker) => blocker.attack >= attacker.health && (untouchable || blocker.health > attacker.attack)));
  return keepGuard(safe, board).map((creature) => creature.instanceId);
}

/**
 * Attacking exhausts a creature without vigilance until the AI's next turn,
 * so it cannot block the enemy's next attack. Keeps such attackers home, the
 * least dangerous first, while the enemy attacking with everything it has
 * would be lethal; when even keeping all of them home would not stop that,
 * guarding is pointless and they all attack.
 * @param {readonly CardView[]} attackers
 * @param {Board} board
 * @returns {CardView[]}
 */
function keepGuard(attackers, board) {
  const threats = board.enemy.battlefield.filter((creature) => creature.attack > 0);
  /** @param {readonly CardView[]} attacking */
  const lethalWith = (attacking) => {
    const home = board.me.battlefield.filter((creature) => !creature.exhausted && (!attacking.includes(creature) || hasKeyword(creature, Keyword.VIGILANCE)));
    return crackBack(threats, home) >= board.me.life;
  };
  const guards = attackers.filter((creature) => !hasKeyword(creature, Keyword.VIGILANCE)).sort((a, b) => a.attack - b.attack || b.health - a.health);
  if (!lethalWith(attackers) || lethalWith(attackers.filter((creature) => !guards.includes(creature)))) {
    return [...attackers];
  }
  const attacking = [...attackers];
  for (const guard of guards) {
    if (!lethalWith(attacking)) {
      break;
    }
    attacking.splice(attacking.indexOf(guard), 1);
  }
  return attacking;
}

/**
 * Rough damage that gets through when every attacker swings and each blocker
 * stops one, the toughest blockers on the biggest attackers: a blocked
 * attacker deals nothing to the player unless it tramples over its blocker.
 * @param {readonly CardView[]} attackers
 * @param {readonly CardView[]} blockers
 */
function crackBack(attackers, blockers) {
  const walls = [...blockers].sort((a, b) => b.health - a.health);
  return [...attackers]
    .sort((a, b) => b.attack - a.attack)
    .reduce((sum, attacker, index) => sum + (index < walls.length ? trampleOver(attacker, walls[index]) : attacker.attack), 0);
}

/**
 * Damage a blocked attacker still deals to the defending player.
 * @param {CardView} attacker
 * @param {CardView} blocker
 */
function trampleOver(attacker, blocker) {
  return hasKeyword(attacker, Keyword.TRAMPLE) ? Math.max(0, attacker.attack - Math.max(0, blocker.health)) : 0;
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
  const chump = incoming >= board.me.life || board.me.life - incoming <= board.rules.chumpBelow * board.me.maxLife;
  const blocks = [];
  for (const attacker of attackers) {
    const blocker = pickBlocker(attacker, available, chump, board.rules);
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
 * @param {boolean} chump block with a creature that dies for nothing when nothing better blocks
 * @param {StyleRules} rules
 * @returns {CardView | undefined}
 */
function pickBlocker(attacker, available, chump, rules) {
  const kills = (blocker) => blocker.attack >= attacker.health;
  const survives = (blocker) => blocker.health > attacker.attack;
  const ideal = available.find((blocker) => kills(blocker) && survives(blocker));
  if (ideal !== undefined) {
    return ideal;
  }
  const trade = rules.blockTrades ? available.find((blocker) => kills(blocker) && blocker.cost <= attacker.cost) : undefined;
  if (trade !== undefined) {
    return trade;
  }
  const wall = rules.blockWalls ? available.find((blocker) => survives(blocker)) : undefined;
  if (wall !== undefined) {
    return wall;
  }
  return chump ? chumpBlocker(attacker, available) : undefined;
}

/**
 * The cheapest creature; against a trampler, which still hits for its attack
 * beyond the blocker's health, the one that stops the most damage (the
 * cheapest on ties).
 * @param {CardView} attacker
 * @param {readonly CardView[]} available
 * @returns {CardView | undefined}
 */
function chumpBlocker(attacker, available) {
  const stopped = (/** @type {CardView} */ blocker) => attacker.attack - trampleOver(attacker, blocker);
  return [...available].sort((a, b) => stopped(b) - stopped(a) || a.cost - b.cost)[0];
}
