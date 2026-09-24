/**
 * Builds the initial GameState from validated inputs: instantiates each
 * deck, shuffles with the injected RNG, draws opening hands. Deck-building
 * legality (size, copies, factions) is the application layer's concern via
 * DeckValidator; this module only refuses what would break the engine.
 */
import { LIMITS } from "../../shared/limits.js";
import { fail, ok } from "../../shared/Result.js";
import { CardInstance } from "../cards/CardInstance.js";
import { GameState } from "./GameState.js";
import { Player } from "./Player.js";
import { ZoneType } from "./ZoneType.js";

export const SetupError = Object.freeze({
  INVALID_PLAYERS: "INVALID_PLAYERS",
  UNKNOWN_CARD: "UNKNOWN_CARD",
  EMPTY_DECK: "EMPTY_DECK",
});

const PLAYER_ID_PATTERN = LIMITS.ID_PATTERN;

/**
 * @typedef {{ id: string, name: string, deckList: import("../decks/DeckList.js").DeckList }} PlayerSetup
 */

/**
 * @param {{ rules: import("./GameRules.js").GameRules, catalog: import("../cards/CardCatalog.js").CardCatalog, resourceSystem: import("../resources/ResourceSystem.contract.js").ResourceSystem, players: readonly PlayerSetup[], rng: import("../random/RandomSource.contract.js").RandomSource }} setup
 * @returns {import("../../shared/Result.js").Ok<GameState> | import("../../shared/Result.js").Fail}
 */
export function createInitialState({ rules, catalog, resourceSystem, players, rng }) {
  const playersProblem = validatePlayers(players);
  if (playersProblem !== null) {
    return fail(SetupError.INVALID_PLAYERS, playersProblem);
  }
  let nextInstanceNumber = 1;
  const allocateId = () => `c${nextInstanceNumber++}`;
  const built = [];
  for (const setup of players) {
    const result = buildPlayer(setup, { rules, catalog, resourceSystem, rng, allocateId });
    if (!result.ok) {
      return result;
    }
    built.push(result.value);
  }
  return ok(new GameState({ players: built, activePlayerId: players[0].id, rng, nextInstanceNumber }));
}

/**
 * @param {readonly PlayerSetup[]} players
 * @returns {string | null} problem description
 */
function validatePlayers(players) {
  if (!Array.isArray(players) || players.length !== 2) {
    return "exactly two players are required";
  }
  const ids = players.map((player) => player?.id);
  if (ids.some((id) => typeof id !== "string" || id.length > LIMITS.INSTANCE_ID_MAX_LENGTH || !PLAYER_ID_PATTERN.test(id))) {
    return "player ids must be short lowercase identifiers";
  }
  if (ids[0] === ids[1]) {
    return "player ids must be distinct";
  }
  if (players.some((player) => typeof player.name !== "string" || player.name.length === 0 || player.name.length > LIMITS.NAME_MAX_LENGTH)) {
    return "player names must be non-empty and bounded";
  }
  return null;
}

/**
 * @param {PlayerSetup} setup
 * @param {{ rules: import("./GameRules.js").GameRules, catalog: import("../cards/CardCatalog.js").CardCatalog, resourceSystem: import("../resources/ResourceSystem.contract.js").ResourceSystem, rng: import("../random/RandomSource.contract.js").RandomSource, allocateId: () => string }} deps
 * @returns {import("../../shared/Result.js").Ok<Player> | import("../../shared/Result.js").Fail}
 */
function buildPlayer(setup, { rules, catalog, resourceSystem, rng, allocateId }) {
  const instances = [];
  for (const entry of setup.deckList.entries) {
    const definition = catalog.get(entry.cardId);
    if (definition === undefined) {
      return fail(SetupError.UNKNOWN_CARD, `deck "${setup.deckList.id}" references unknown card "${entry.cardId}"`, { cardId: entry.cardId });
    }
    for (let copy = 0; copy < entry.count; copy += 1) {
      instances.push(new CardInstance({ instanceId: allocateId(), definition, ownerId: setup.id, zone: ZoneType.LIBRARY }));
    }
  }
  if (instances.length === 0) {
    return fail(SetupError.EMPTY_DECK, `deck "${setup.deckList.id}" is empty`);
  }
  const player = new Player({ id: setup.id, name: setup.name, life: rules.startingLife, resources: resourceSystem.createPool() });
  for (const card of rng.shuffle(instances)) {
    player.library.add(card);
  }
  for (let drawn = 0; drawn < rules.startingHandSize; drawn += 1) {
    const card = player.library.takeTop();
    if (card !== undefined) {
      player.hand.add(card);
    }
  }
  return ok(player);
}
