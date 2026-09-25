/**
 * Verifies a game from the chain (docs/tcg/03-game-blockchain-protocol.md
 * §14), network-neutral: the chain is read through a reader port, content
 * is fetched by hash from anywhere and accepted only if it hashes right.
 * The same function runs in the CLI, on the server and in the browser.
 *
 *   1. the trust anchor: every `m8tcg_manifest` of the root account (active
 *      authority) → which broadcasters were authorised at which block;
 *   2. the game's operations, only from irreversible blocks: either from
 *      block numbers someone gave us (an index: a server can omit blocks,
 *      which shows up as a gap, but cannot add or change anything), or by
 *      scanning every authorised broadcaster's history (no index needed);
 *   3. the content the game declared, by hash;
 *   4. verifyGame: signers, canonical JSON, schema, chain, lifecycle,
 *      reveals, replay.
 */
import { ENGINE_VERSION } from "@magic8/engine/version.js";
import { buildGameContent } from "@magic8/engine/domain/content/GameContent.js";
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { OperationId } from "../game/constants.js";
import { openContent } from "../game/content.js";
import { checkAck } from "../game/acks.js";
import { sessionAuthorization, sessionGrants } from "../game/sessions.js";
import { AckKeyRegistry, BroadcasterRegistry } from "../game/manifest.js";
import { decodeGameOperation } from "../game/OperationDecoder.js";
import { Verdict, verifyGame } from "../game/verifyGame.js";

const PAGE_SIZE = 1000;

/**
 * @typedef {import("../game/OperationDecoder.js").ChainOperation} ChainOperation
 * @typedef {object} ChainReader
 * @property {() => Promise<Readonly<{ headBlock: number, irreversibleBlock: number, time: number }>>} head
 * @property {(account: string, after: number, limit: number) => Promise<readonly Readonly<{ index: number, operation: ChainOperation | null }>[]>} publications
 * @property {(blockNum: number) => Promise<readonly ChainOperation[] | null>} blockOperations
 * @property {(account: string) => Promise<readonly string[] | null>} [postingKeys] the keys of the account's posting authority today (null: no such account)
 */

/**
 * The rules and cards of a content payload, ready for replay, or null when
 * the payload does not hash to `hash` or is not valid content for this engine.
 * @param {string} payload
 * @param {string} hash
 * @returns {import("../game/engineSetup.js").GameContent | null}
 */
export function replayContentOf(payload, hash) {
  const raw = openContent(payload, hash);
  if (raw === null) {
    return null;
  }
  const effects = createCoreEffectRegistry();
  const built = buildGameContent(/** @type {any} */ (raw), effects);
  return built.ok ? Object.freeze({ rules: built.value.gameRules, catalog: built.value.catalog, effects, createCommands: createCoreCommandRegistry }) : null;
}

/**
 * Every custom_json with `id` in an account's history, up to `irreversibleBlock`.
 * @param {ChainReader} reader
 * @param {string} account
 * @param {string} id
 * @param {{ irreversibleBlock: number, maxPages: number }} limits
 */
async function operationsOf(reader, account, id, { irreversibleBlock, maxPages }) {
  const found = [];
  let cursor = -1;
  for (let page = 0; page < maxPages; page += 1) {
    const entries = await reader.publications(account, cursor, PAGE_SIZE);
    for (const { operation } of entries) {
      if (operation !== null && operation.id === id && operation.blockNum <= irreversibleBlock) {
        found.push(operation);
      }
    }
    if (entries.length < PAGE_SIZE) {
      return { operations: found, complete: true };
    }
    cursor = entries[entries.length - 1].index;
  }
  return { operations: found, complete: false };
}

/**
 * @param {ChainReader} reader
 * @param {readonly number[]} blocks
 * @param {number} irreversibleBlock
 */
async function operationsInBlocks(reader, blocks, irreversibleBlock) {
  const operations = [];
  const pending = [];
  const missing = [];
  for (const blockNum of [...new Set(blocks)].sort((left, right) => left - right)) {
    if (blockNum > irreversibleBlock) {
      pending.push(blockNum);
      continue;
    }
    const found = await reader.blockOperations(blockNum);
    if (found === null) {
      missing.push(blockNum);
      continue;
    }
    operations.push(...found.filter((operation) => operation.id === OperationId.GAME));
  }
  return { operations, pending, missing };
}

/**
 * The content hash and engine version GAME_CREATED declares, read from authorised operations.
 * @param {string} gameId
 * @param {readonly ChainOperation[]} operations
 * @param {BroadcasterRegistry} registry
 */
function declaredContent(gameId, operations, registry) {
  for (const operation of operations) {
    const decoded = decodeGameOperation(operation, registry.asPolicy());
    const created = decoded.ok ? decoded.records.find(({ record }) => record.g === gameId && record.s === 0) : undefined;
    const event = created?.record.e[0];
    if (event !== undefined && event.k === "GAME_CREATED") {
      return { hash: String(event.d.content), engineVersion: String(event.d.eng) };
    }
  }
  return null;
}

/**
 * @param {{
 *   gameId: string,
 *   reader: ChainReader,
 *   rootAccount: string,
 *   blocks?: readonly number[] | null,
 *   fetchContent: (hash: string) => Promise<string | null>,
 *   maxHistoryPages?: number,
 *   acks?: readonly unknown[],
 *   recoverSigner?: import("../game/acks.js").RecoverSigner,
 *   verifyMoveSignature?: import("../game/sessions.js").MoveSignatureVerifier,
 * }} input `blocks`: an index of the blocks holding the game's records; null to scan the broadcasters' histories.
 *   `acks`: signed acks a player kept, checked against the published game (needs `recoverSigner`).
 *   `verifyMoveSignature` and `recoverSigner`: needed for v2 games (signed moves and their session keys).
 */
export async function verifyGameOnChain({ gameId, reader, rootAccount, blocks = null, fetchContent, maxHistoryPages = 200, acks = [], recoverSigner, verifyMoveSignature }) {
  const head = await reader.head();
  const limits = { irreversibleBlock: head.irreversibleBlock, maxPages: maxHistoryPages };
  const manifests = await operationsOf(reader, rootAccount, OperationId.MANIFEST, limits);
  const { registry } = BroadcasterRegistry.fromOperations(manifests.operations, rootAccount);
  let collected;
  if (blocks === null) {
    const operations = [];
    let complete = manifests.complete;
    for (const account of registry.accounts()) {
      const scanned = await operationsOf(reader, account, OperationId.GAME, limits);
      operations.push(...scanned.operations.filter((operation) => operation.json.includes(gameId)));
      complete &&= scanned.complete;
    }
    collected = { operations, pending: [], missing: [], complete };
  } else {
    collected = { ...(await operationsInBlocks(reader, blocks, head.irreversibleBlock)), complete: manifests.complete };
  }
  const declared = declaredContent(gameId, collected.operations, registry);
  let content = null;
  if (declared !== null && declared.engineVersion === ENGINE_VERSION) {
    const payload = await fetchContent(declared.hash);
    content = payload === null ? null : replayContentOf(payload, declared.hash);
  }
  const verification = verifyGame({
    gameId,
    operations: collected.operations,
    isAuthorizedBroadcaster: registry.asPolicy(),
    resolveContent: (hash, engineVersion) => (declared !== null && hash === declared.hash && engineVersion === declared.engineVersion ? content : null),
    verifyMoveSignature,
  });
  const sessions = await checkSessions({ history: verification.history, reader, recoverSigner });
  return Object.freeze({
    ...verification,
    verdict: sessions.some((session) => session.status === SessionStatus.FORGED) ? Verdict.INVALID : verification.verdict,
    sessions,
    acks: checkAcks({ acks, recoverSigner, history: verification.history, manifests: manifests.operations, rootAccount, fallbackBlock: head.irreversibleBlock }),
    head,
    broadcasters: registry.accounts(),
    content: Object.freeze({ declared, verified: content !== null, localEngine: ENGINE_VERSION }),
    pendingBlocks: Object.freeze(collected.pending),
    missingBlocks: Object.freeze(collected.missing),
    complete: collected.complete,
  });
}

/**
 * Checks a player's signed acks against the published game. An ack key must
 * be authorised at the block where the game was created (or, for a game
 * not published at all, at the last irreversible block).
 * @param {{
 *   acks: readonly unknown[],
 *   recoverSigner: import("../game/acks.js").RecoverSigner | undefined,
 *   history: import("../game/GameHistory.js").GameHistory,
 *   manifests: readonly ChainOperation[],
 *   rootAccount: string,
 *   fallbackBlock: number,
 * }} input
 */
function checkAcks({ acks, recoverSigner, history, manifests, rootAccount, fallbackBlock }) {
  if (acks.length === 0) {
    return Object.freeze([]);
  }
  if (recoverSigner === undefined) {
    throw new TypeError("checking acks needs recoverSigner");
  }
  const { registry } = AckKeyRegistry.fromOperations(manifests, rootAccount);
  const created = history.records.find(({ record }) => record.s === 0)?.source?.blockNum;
  const anchor = typeof created === "number" ? created : fallbackBlock;
  return Object.freeze(acks.map((ack) => checkAck(ack, { history, recoverSigner, isTrustedKey: (key) => registry.isAuthorized(key, anchor) })));
}

export const SessionStatus = Object.freeze({
  /** Signed by a key that satisfies the account's posting authority today. */
  AUTHORIZED: "AUTHORIZED",
  /** A valid signature by a key the account does not use today: rotated since, or never its key. */
  KEY_NOT_CURRENT: "KEY_NOT_CURRENT",
  /** The authorisation is not a signature at all: nobody authorised this key. */
  FORGED: "FORGED",
  /** The chain reader cannot tell which keys the account uses. */
  UNCHECKED: "UNCHECKED",
});

/**
 * Who authorised each session key of a v2 game: the authorisation must be a
 * signature by one of the seat account's posting keys.
 * @param {{ history: import("../game/GameHistory.js").GameHistory, reader: ChainReader, recoverSigner: import("../game/acks.js").RecoverSigner | undefined }} input
 */
async function checkSessions({ history, reader, recoverSigner }) {
  const grants = sessionGrants(history);
  if (grants.length === 0) {
    return Object.freeze([]);
  }
  if (recoverSigner === undefined) {
    throw new TypeError("checking session keys needs recoverSigner");
  }
  /** @type {Map<string, readonly string[] | null>} */
  const postingKeys = new Map();
  const checked = [];
  for (const grant of grants) {
    const signer = recoverSigner(sessionAuthorization(history.gameId, grant.key), grant.authorization);
    if (!postingKeys.has(grant.account)) {
      postingKeys.set(grant.account, typeof reader.postingKeys === "function" ? await reader.postingKeys(grant.account) : null);
    }
    const known = postingKeys.get(grant.account) ?? null;
    let status = SessionStatus.UNCHECKED;
    if (signer === null) {
      status = SessionStatus.FORGED;
    } else if (known !== null) {
      status = known.includes(signer) ? SessionStatus.AUTHORIZED : SessionStatus.KEY_NOT_CURRENT;
    }
    checked.push(Object.freeze({ seat: grant.seat, account: grant.account, eventSeq: grant.eventSeq, signer, status }));
  }
  return Object.freeze(checked);
}
