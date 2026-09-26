/**
 * Verifies a Magic8 game from the STEEM chain, on your own computer.
 *
 *   node tools/verify-game.js <gameId> [options]
 *
 * Options:
 *   --root <account>    the project's root account: the trust anchor whose
 *                       manifests say which broadcasters may sign
 *                       (default: verdu.green). Do not take it from the server.
 *   --server <origin>   a game server: used only as an index of the blocks
 *                       holding the game and to download the content by hash
 *                       (both are checked; a server can hide records, which
 *                       shows up as a gap, but cannot forge any)
 *   --scan              ignore any index: find the records by reading every
 *                       authorised broadcaster's history (slower)
 *   --content <file>    the content payload, instead of downloading it
 *   --acks <file>       signed acks a player kept (a JSON array): each is
 *                       checked against the published game (docs/tcg/11)
 *   --nodes <urls>      STEEM API nodes, comma-separated
 *   --json              print the full result as JSON
 *
 * Exit code: 0 VALID, 1 not valid (or not finished, or an ack the chain
 * contradicts), 2 could not verify.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { AckStatus, GAME_ID_PATTERN, Verdict, verifyGameOnChain } from "@magic8/protocol";
import { SteemBlockchainProvider, SteemPublicationReader, SteemRpcClient, recoverSigner, verifySessionSignature } from "@magic8/steem";

export const DEFAULT_ROOT = "verdu.green";
export const DEFAULT_NODES = Object.freeze(["https://api.moecki.online", "https://api.justyy.com", "https://api.steemit.com"]);

const USAGE = "usage: node tools/verify-game.js <gameId> [--root account] [--server origin] [--scan] [--content file] [--acks file] [--nodes urls] [--json]";

/** What an ack status means for the player who kept it. */
const ACK_MEANING = Object.freeze({
  [AckStatus.CONSISTENT]: "the chain agrees",
  [AckStatus.DIVERGENT]: "PROOF: the published game differs from what the server acknowledged",
  [AckStatus.OMITTED]: "PROOF: the published game ended without this acknowledged move",
  [AckStatus.NOT_PUBLISHED]: "not on the chain yet",
  [AckStatus.BAD_SIGNATURE]: "the signature does not match: this ack proves nothing",
  [AckStatus.UNTRUSTED_KEY]: "signed by a key the root had not named: this ack proves nothing",
  [AckStatus.INVALID]: "malformed, or for another game",
});
const CONTRADICTED = new Set([AckStatus.DIVERGENT, AckStatus.OMITTED]);

class UsageError extends Error {}

/**
 * @param {readonly string[]} argv
 */
function parse(argv) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { root: { type: "string" }, server: { type: "string" }, scan: { type: "boolean" }, content: { type: "string" }, acks: { type: "string" }, nodes: { type: "string" }, json: { type: "boolean" } },
  });
  const gameId = positionals[0];
  if (positionals.length !== 1 || !GAME_ID_PATTERN.test(gameId)) {
    throw new UsageError("expected exactly one game id (26 lowercase characters)");
  }
  return { gameId, ...values };
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 */
async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Where the records came from and what was left out.
 * @param {Awaited<ReturnType<typeof verifyGameOnChain>>} result
 * @param {{ gameId: string, root: string, blocks: readonly number[] | null }} context
 */
function describeSources(result, { gameId, root, blocks }) {
  const broadcasters = result.broadcasters.length === 0 ? "none" : result.broadcasters.map((account) => `@${account}`).join(", ");
  const lines = [`game ${gameId}`, `root account: @${root}; authorised broadcasters: ${broadcasters}`];
  lines.push(blocks === null ? "records: found by scanning the broadcasters' histories" : `records: read from ${blocks.length} block(s) given by the index`);
  if (result.pendingBlocks.length > 0) {
    lines.push(`not yet irreversible: blocks ${result.pendingBlocks.join(", ")}`);
  }
  if (result.missingBlocks.length > 0) {
    lines.push(`blocks the node could not return: ${result.missingBlocks.join(", ")}`);
  }
  for (const rejection of result.rejected) {
    lines.push(`ignored operation ${rejection.txId}: ${rejection.reason} (${rejection.message})`);
  }
  return lines;
}

/**
 * What was checked, and the verdict.
 * @param {Awaited<ReturnType<typeof verifyGameOnChain>>} result
 */
function describeChecks({ history, replay, content, verdict }) {
  const problem = history.problem === null ? "" : ` — ${history.problem.message}`;
  const lines = [`history: ${history.status}, ${history.records.length} record(s), ${history.events.length} event(s)${problem}`];
  if (content.declared !== null) {
    const state = content.verified ? "downloaded and checked" : `not available (this verifier runs engine ${content.localEngine})`;
    lines.push(`content ${content.declared.hash} (engine ${content.declared.engineVersion}): ${state}`);
  }
  if (replay !== null) {
    const outcome = replay.outcome === null ? "" : `; winner ${replay.outcome.winner ?? "none"} (${replay.outcome.reason})`;
    const message = replay.message === null ? "" : ` — ${replay.message}`;
    lines.push(`replay: ${replay.status}${message}${outcome}`);
  }
  lines.push(`VERDICT: ${verdict}`);
  return lines;
}

const SIGNATURE_LINES = Object.freeze({
  NOT_REQUIRED: "moves: protocol v1, moves are not signed",
  VALID: "moves: every player move is signed by the player's session key",
});

/**
 * Signed moves (protocol v2): the moves, then who authorised each session key.
 * @param {Awaited<ReturnType<typeof verifyGameOnChain>>} result
 */
function describeSignatures({ signatures, sessions }) {
  const lines = [SIGNATURE_LINES[signatures.status] ?? `moves: ${signatures.status} — ${signatures.message}`];
  for (const session of sessions) {
    const signer = session.signer === null ? "" : ` (signed by ${session.signer})`;
    lines.push(`session ${session.seat} @${session.account}: ${session.status}${signer}`);
  }
  return lines;
}

/**
 * One line per kept ack.
 * @param {Awaited<ReturnType<typeof verifyGameOnChain>>} result
 */
function describeAcks({ acks }) {
  return acks.map((ack) => `ack ${ack.commandId ?? "?"} (event ${ack.seq ?? "?"}): ${ack.status} — ${ACK_MEANING[ack.status]}`);
}

/**
 * @param {Awaited<ReturnType<typeof verifyGameOnChain>>} result
 * @param {{ gameId: string, root: string, blocks: readonly number[] | null }} context
 */
export function describeResult(result, context) {
  return [...describeSources(result, context), ...describeSignatures(result), ...describeChecks(result), ...describeAcks(result)].join("\n");
}

/**
 * The server's index of blocks, unless scanning (or no server).
 * @param {ReturnType<typeof parse>} options
 * @param {string} root
 * @param {{ fetch: typeof fetch, write: (text: string) => void }} io
 * @returns {Promise<readonly number[] | null>}
 */
async function indexedBlocks(options, root, { fetch: fetchImpl, write }) {
  if (options.scan || options.server === undefined) {
    return null;
  }
  const index = await getJson(fetchImpl, `${options.server}/api/games/${options.gameId}/chain`);
  if (index.rootAccount !== root) {
    write(`note: the server names @${index.rootAccount} as root; verifying against @${root}\n`);
  }
  return index.blocks;
}

/**
 * @param {ReturnType<typeof parse>} options
 * @param {typeof fetch} fetchImpl
 * @returns {(hash: string) => Promise<string | null>}
 */
function contentSource(options, fetchImpl) {
  if (options.content !== undefined) {
    return () => readFile(/** @type {string} */ (options.content), "utf8");
  }
  if (options.server === undefined) {
    return async () => null;
  }
  return async (hash) => {
    const response = await fetchImpl(`${options.server}/api/content/${hash}`);
    return response.ok ? response.text() : null;
  };
}

/**
 * @param {ReturnType<typeof parse>} options
 * @returns {Promise<readonly unknown[]>}
 */
async function keptAcks(options) {
  if (options.acks === undefined) {
    return [];
  }
  const parsed = JSON.parse(await readFile(options.acks, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new UsageError("--acks: expected a JSON array of acks");
  }
  return parsed;
}

/** @param {ReturnType<typeof parse>} options */
function nodeReader(options) {
  const nodes = options.nodes === undefined ? DEFAULT_NODES : options.nodes.split(",");
  return new SteemPublicationReader({ chain: new SteemBlockchainProvider({ rpc: new SteemRpcClient({ nodes }) }) });
}

/**
 * 0 only for a VALID game that no kept ack contradicts.
 * @param {Awaited<ReturnType<typeof verifyGameOnChain>>} result
 */
function exitCodeOf(result) {
  const contradicted = result.acks.some((ack) => CONTRADICTED.has(ack.status));
  return result.verdict === Verdict.VALID && !contradicted ? 0 : 1;
}

/**
 * @param {readonly string[]} argv
 * @param {{ fetch?: typeof fetch, reader?: import("@magic8/protocol").ChainReader, write?: (text: string) => void }} [deps] tests inject a reader and fetch
 * @returns {Promise<number>} exit code
 */
export async function verifyCommand(argv, { fetch: fetchImpl = globalThis.fetch, reader, write = (text) => process.stdout.write(text) } = {}) {
  let options;
  try {
    options = parse(argv);
  } catch (error) {
    write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    return 2;
  }
  const root = options.root ?? DEFAULT_ROOT;
  try {
    const blocks = await indexedBlocks(options, root, { fetch: fetchImpl, write });
    const acks = await keptAcks(options);
    const result = await verifyGameOnChain({ gameId: options.gameId, reader: reader ?? nodeReader(options), rootAccount: root, blocks, fetchContent: contentSource(options, fetchImpl), acks, recoverSigner, verifyMoveSignature: verifySessionSignature });
    write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${describeResult(result, { gameId: options.gameId, root, blocks })}\n`);
    return exitCodeOf(result);
  } catch (error) {
    write(`could not verify: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await verifyCommand(process.argv.slice(2));
}
