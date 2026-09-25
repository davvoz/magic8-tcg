/**
 * Plays a complete game the way the authoritative server will: engine for
 * the rules, GameRecorder for protocol events (a checkpoint after every
 * turn), records sealed per turn and packed into envelopes, then turned into
 * the chain operations a verifier would read. Tests tamper with the result.
 */
import { createHash } from "node:crypto";

import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { validateCommandShape } from "@magic8/engine/domain/commands/validateCommandShape.js";
import { ChaChaRandom } from "@magic8/engine/domain/random/ChaChaRandom.js";
import { catalog, effects, emberDeck, ironDeck, rulesWith } from "@magic8/engine/testing/fixtures.js";

import { GameRecorder, OperationId, SEATS, createGameEngine, genesisHead, moveMessage, packEnvelopes, sealRecords } from "../../src/index.js";

export const GAME_ID = "01j8x3r6h2qkq4w0v7m5a9c1dz";
export const CONTENT_HASH = "c0".repeat(32);
export const ENGINE_VERSION = "0.1.0";
export const BROADCASTER = "m8tcg.b1";
export const ACCOUNTS = Object.freeze(["alice", "bob.cards"]);
export const NETWORK = "steem";

/** @param {string} label */
export function testHex(label, bytes = 32) {
  return createHash("sha256").update(label).digest("hex").slice(0, bytes * 2);
}

/** Content resolver for the bundled content, under a fixed fake hash. */
export function resolveContent(contentHash, engineVersion) {
  if (contentHash !== CONTENT_HASH || engineVersion !== ENGINE_VERSION) {
    return null;
  }
  return { rules: rulesWith(), catalog, effects, createCommands: createCoreCommandRegistry };
}

/**
 * A deterministic, legal but varied move for the awaited seat.
 * @param {ChaChaRandom} rng
 * @param {any} snapshot omniscient snapshot
 * @param {any} moves legal moves of the awaited seat
 */
function chooseMove(rng, snapshot, moves) {
  const seat = snapshot.awaitingPlayerId;
  const playable = moves.playableCardIds.filter((cardId) => (moves.targetOptions[cardId] ?? []).every((group) => group.length > 0));
  if (playable.length > 0 && rng.nextInt(3) > 0) {
    const cardId = playable[rng.nextInt(playable.length)];
    const targets = (moves.targetOptions[cardId] ?? []).map((group) => group[rng.nextInt(group.length)]);
    return { type: CommandType.PLAY_CARD, playerId: seat, cardId, targets };
  }
  if (snapshot.phase === "COMBAT_ATTACKERS") {
    return { type: CommandType.DECLARE_ATTACKERS, playerId: seat, attackerIds: moves.attackerIds.filter(() => rng.nextInt(10) < 7) };
  }
  if (snapshot.phase === "COMBAT_BLOCKERS") {
    // One blocker per attacker (the bundled rules): pair chosen blockers with distinct attackers.
    const attackers = rng.shuffle(snapshot.combat.attackerIds);
    const blockers = moves.blockerIds.filter(() => rng.nextInt(2) === 0).slice(0, attackers.length);
    const blocks = blockers.map((blockerId, index) => ({ attackerId: attackers[index], blockerId }));
    return { type: CommandType.DECLARE_BLOCKERS, playerId: seat, blocks };
  }
  return moves.canEndPhase ? { type: CommandType.END_PHASE, playerId: seat } : { type: CommandType.END_TURN, playerId: seat };
}

/** A clock that advances one second per event. */
function createClock() {
  let ms = 0;
  return () => {
    ms += 1000;
    return ms;
  };
}

/**
 * Builds the engine exactly as the server does: through createGameEngine.
 * @param {GameRecorder} recorder
 */
function createEngineFor(recorder) {
  const engine = createGameEngine({
    content: /** @type {any} */ (resolveContent(CONTENT_HASH, ENGINE_VERSION)),
    accounts: ACCOUNTS,
    decks: recorder.decks,
    firstSeat: recorder.firstSeat,
    engineSeed: recorder.engineSeed,
  });
  if (!engine.ok) {
    throw new Error(engine.error.message);
  }
  return engine.value;
}

/**
 * v2: how each seat signs its moves, and what may happen on the way.
 * @typedef {{
 *   keys: Readonly<Record<string, { key: string, sign: (message: string) => string }>>,
 *   authorize: (seat: string, key: string) => string,
 *   sign?: (seat: string, message: string, index: number, honest: string) => string,
 *   rotate?: { atCommand: number, seat: string, session: { key: string, sign: (message: string) => string } },
 * }} Signing
 */

/**
 * The fields a v2 MOVE carries: the player's signature over the command.
 * @param {{ recorder: GameRecorder, signing: Signing, keys: Map<string, { key: string, sign: (message: string) => string }>, seat: string, command: Record<string, unknown>, expectedVersion: number, index: number }} input
 */
function signedFields({ recorder, signing, keys, seat, command, expectedVersion, index }) {
  const commandId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const bare = Object.fromEntries(Object.entries(command).filter(([field]) => field !== "playerId"));
  const message = moveMessage({ gameId: recorder.gameId, commandId, expectedVersion, command: bare });
  // A seat without a session key cannot sign: its move carries a signature of nobody's.
  const honest = keys.get(seat)?.sign(message) ?? "00".repeat(64);
  return { commandId, expectedVersion, signature: signing.sign === undefined ? honest : signing.sign(seat, message, index, honest) };
}

/**
 * The SESSION event of a planned key rotation, when its time has come.
 * @param {{ recorder: GameRecorder, signing: Signing | null, keys: Map<string, { key: string, sign: (message: string) => string }>, commands: number, clock: { turn: number, ms: number } }} input
 */
function rotation({ recorder, signing, keys, commands, clock }) {
  const rotate = signing?.rotate;
  if (rotate === undefined || rotate.atCommand !== commands) {
    return [];
  }
  keys.set(rotate.seat, rotate.session);
  return [recorder.session({ seat: rotate.seat, key: rotate.session.key, authorization: signing.authorize(rotate.seat, rotate.session.key), clock })];
}

/**
 * Plays commands until the game ends, recording a MOVE per command and a checkpoint per turn.
 * @param {{ game: import("@magic8/engine/domain/game/GameEngine.js").GameEngine, recorder: GameRecorder, rng: ChaChaRandom, tick: () => number, maxCommands: number, concedeAt: number | null, signing: Signing | null }} input
 * @returns {{ groups: import("../../src/game/EventChain.js").ChainedEvent[][], commands: number }}
 */
function playUntilOver({ game, recorder, rng, tick, maxCommands, concedeAt, signing }) {
  const keys = new Map(Object.entries(signing?.keys ?? {}));
  const groups = [];
  let turn = [];
  let commands = 0;
  while (!game.isOver) {
    const snapshot = game.getSnapshot(null);
    const seat = snapshot.awaitingPlayerId;
    const shouldConcede = commands === concedeAt || commands >= maxCommands;
    const raw = shouldConcede ? { type: CommandType.CONCEDE, playerId: seat } : chooseMove(rng, snapshot, game.getLegalMoves(seat));
    const command = validateCommandShape(raw);
    const expectedVersion = game.version;
    const result = game.execute(command.value);
    if (!result.ok) {
      throw new Error(`reference game produced an illegal move: ${JSON.stringify(raw)} ${result.error.message}`);
    }
    commands += 1;
    const clock = { turn: game.getSnapshot(null).turnNumber, ms: tick() };
    turn.push(...rotation({ recorder, signing, keys, commands, clock }));
    const signed = signing === null ? undefined : signedFields({ recorder, signing, keys, seat, command: command.value, expectedVersion, index: commands });
    turn.push(recorder.move({ seat, command: command.value, clock, signed }));
    if (!game.isOver && game.getSnapshot(null).turnNumber !== snapshot.turnNumber) {
      turn.push(recorder.checkpoint({ engineVersion: game.version, digest: game.getStateDigest(), clock }));
      groups.push(turn);
      turn = [];
    }
  }
  groups.push(turn);
  return { groups, commands };
}

/**
 * @param {{ label?: string, gameId?: string, maxCommands?: number, concedeAt?: number | null, signing?: Signing | null }} [options]
 *   `signing`: a v2 game, whose seats authorise session keys and sign their moves
 */
export function playReferenceGame({ label = "reference", gameId = GAME_ID, maxCommands = 600, concedeAt = null, signing = null } = {}) {
  const secret = testHex(`${label}:secret`);
  const decks = [emberDeck, ironDeck];
  const recorder = new GameRecorder({ gameId, secret, decks: decks.map((deck) => deck.entries), version: signing === null ? 1 : 2 });
  const tick = createClock();
  const opening = [recorder.created({ mode: "casual", network: NETWORK, engineVersion: ENGINE_VERSION, contentHash: CONTENT_HASH, accounts: ACCOUNTS, ms: 0 })];
  for (const [seat, session] of Object.entries(signing?.keys ?? {})) {
    opening.push(recorder.session({ seat, key: session.key, authorization: signing.authorize(seat, session.key), clock: { turn: 0, ms: tick() } }));
  }
  opening.push(recorder.joined({ seat: SEATS[0], entropy: testHex(`${label}:e0`, 16), ms: tick() }));
  opening.push(recorder.joined({ seat: SEATS[1], entropy: testHex(`${label}:e1`, 16), ms: tick() }));
  opening.push(recorder.started({ ms: tick() }));

  const game = createEngineFor(recorder);
  game.start();
  const rng = ChaChaRandom.fromSeed(testHex(`${label}:moves`));
  const { groups, commands } = playUntilOver({ game, recorder, rng, tick, maxCommands, concedeAt, signing });
  const final = game.getSnapshot(null);
  groups[groups.length - 1].push(
    recorder.finished({ winner: final.winnerId, reason: final.endReason, engineVersion: game.version, digest: game.getStateDigest(), clock: { turn: final.turnNumber, ms: tick() } }),
  );
  const allGroups = [opening, ...groups];
  const records = sealGroups(allGroups, gameId, recorder.version);
  const envelopes = packEnvelopes(records);
  const operations = envelopes.map((envelope, index) => operation(envelope.json, { blockNum: 1000 + index, txId: testHex(`${label}:tx${index}`, 20) }));
  return {
    secret,
    recorder,
    events: allGroups.flat(),
    records,
    envelopes,
    operations,
    outcome: { winner: final.winnerId, reason: final.endReason, commands, turns: final.turnNumber },
  };
}

/**
 * Seals each group (lifecycle, then one group per turn) into records, like the server's batching policy.
 * @param {readonly (readonly import("../../src/game/EventChain.js").ChainedEvent[])[]} groups
 * @param {string} [gameId]
 */
export function sealGroups(groups, gameId = GAME_ID, version = 1) {
  const records = [];
  let previousHead = genesisHead(gameId);
  for (const group of groups.filter((candidate) => candidate.length > 0)) {
    const sealed = sealRecords({ gameId, firstRecordSeq: records.length, previousHead, chained: group, ts: 1_790_000_000_000 + records.length, version });
    records.push(...sealed);
    previousHead = sealed[sealed.length - 1].head;
  }
  return records;
}

/**
 * @param {string} json
 * @param {{ blockNum: number, txId: string, signer?: string, id?: string, requiredAuths?: string[] }} options
 */
export function operation(json, { blockNum, txId, signer = BROADCASTER, id = OperationId.GAME, requiredAuths = [] }) {
  return Object.freeze({ network: NETWORK, txId, blockNum, opIndex: 0, id, requiredAuths, requiredPostingAuths: [signer], json });
}

/** Policy authorising only BROADCASTER. */
export const onlyBroadcaster = (account) => account === BROADCASTER;
