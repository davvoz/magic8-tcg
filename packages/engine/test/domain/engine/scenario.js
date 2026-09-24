/**
 * Builds an engine around a hand-crafted board so tests can exercise exact
 * situations (specific cards in hand, creatures in play, life totals) without
 * depending on shuffles.
 *
 * The engine is started, so it sits in MAIN_1 with P1 to act. start() grants
 * P1 its first resource step, which the builder compensates for so that
 * `resources` means "available now".
 */
import { CardInstance } from "../../../src/domain/cards/CardInstance.js";
import { createCoreCommandRegistry } from "../../../src/domain/commands/registerCoreCommands.js";
import { GameEngine } from "../../../src/domain/game/GameEngine.js";
import { GameState } from "../../../src/domain/game/GameState.js";
import { Player } from "../../../src/domain/game/Player.js";
import { ZoneType } from "../../../src/domain/game/ZoneType.js";
import { createResourceSystem } from "../../../src/domain/resources/IncrementalResourceSystem.js";
import { ResourcePool } from "../../../src/domain/resources/ResourcePool.js";
import { ChaChaRandom } from "../../../src/domain/random/ChaChaRandom.js";
import { P1, P2, catalog, effects, rulesWith } from "./fixtures.js";

/**
 * @typedef {object} PlayerSpec
 * @property {readonly string[]} [hand] definition ids
 * @property {readonly string[]} [battlefield] definition ids
 * @property {readonly string[]} [library] definition ids (top first)
 * @property {number} [life]
 * @property {number} [resources] resources available once the engine has started
 */

/**
 * @param {{ p1?: PlayerSpec, p2?: PlayerSpec, rules?: import("../../../src/domain/game/GameRules.js").GameRules, seed?: number }} [spec]
 */
export function createScenario(spec = {}) {
  const rules = spec.rules ?? rulesWith();
  const ids = { next: 1 };
  /** @type {Record<string, string[]>} instance ids per player and zone, in order */
  const placed = {};

  const buildPlayer = (id, name, playerSpec, isActive) => {
    const resources = playerSpec.resources ?? 10;
    const startValue = isActive ? Math.max(0, resources - rules.resource.gainPerTurn) : resources;
    const player = new Player({ id, name, life: playerSpec.life ?? rules.startingLife, resources: new ResourcePool({ current: startValue, max: startValue }) });
    const place = (zoneType, definitionIds) => {
      placed[`${id}.${zoneType}`] = [];
      for (const definitionId of definitionIds) {
        const definition = catalog.get(definitionId);
        if (definition === undefined) {
          throw new Error(`scenario: unknown card "${definitionId}"`);
        }
        const card = new CardInstance({ instanceId: `c${ids.next}`, definition, ownerId: id, zone: zoneType });
        ids.next += 1;
        player.zone(zoneType).add(card);
        placed[`${id}.${zoneType}`].push(card.instanceId);
      }
    };
    place(ZoneType.HAND, playerSpec.hand ?? []);
    place(ZoneType.BATTLEFIELD, playerSpec.battlefield ?? []);
    place(ZoneType.LIBRARY, playerSpec.library ?? Array(10).fill("ember_imp"));
    return player;
  };

  const players = [buildPlayer(P1, "Alice", spec.p1 ?? {}, true), buildPlayer(P2, "Bob", spec.p2 ?? {}, false)];
  const state = new GameState({ players, activePlayerId: P1, rng: ChaChaRandom.fromSeed(spec.seed ?? 1), nextInstanceNumber: ids.next });
  const resourceSystem = createResourceSystem(rules);
  const engine = new GameEngine({
    state,
    rules,
    catalog,
    effects,
    commands: createCoreCommandRegistry(),
    turnManager: GameEngine.createTurnManager(rules, resourceSystem),
  });
  const startResult = engine.start();
  if (!startResult.ok) {
    throw new Error(`scenario: start failed ${JSON.stringify(startResult)}`);
  }
  /** Instance id of the n-th card placed in a player's zone. */
  const id = (playerId, zone, index = 0) => placed[`${playerId}.${zone}`][index];
  return { engine, id, rules };
}
