/**
 * Verifies a Magic8 game from the STEEM chain, on your own computer.
 *
 *   node tools/verify-game.js <gameId> [options]
 *
 * Options:
 *   --root <account>    the project's root account: the trust anchor whose
 *                       manifests say which broadcasters may sign
 *                       (default: luciojolly). Do not take it from the server.
 *   --server <origin>   a game server: used only as an index of the blocks
 *                       holding the game and to download the content by hash
 *                       (both are checked; a server can hide records, which
 *                       shows up as a gap, but cannot forge any)
 *   --scan              ignore any index: find the records by reading every
 *                       authorised broadcaster's history (slower)
 *   --content <file>    the content payload, instead of downloading it
 *   --nodes <urls>      STEEM API nodes, comma-separated
 *   --json              print the full result as JSON
 *
 * Exit code: 0 VALID, 1 not valid (or not finished), 2 could not verify.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { GAME_ID_PATTERN, Verdict, verifyGameOnChain } from "@magic8/protocol";
import { SteemBlockchainProvider, SteemPublicationReader, SteemRpcClient } from "@magic8/steem";

export const DEFAULT_ROOT = "luciojolly";
export const DEFAULT_NODES = Object.freeze(["https://api.moecki.online", "https://api.justyy.com", "https://api.steemit.com"]);

const USAGE = "usage: node tools/verify-game.js <gameId> [--root account] [--server origin] [--scan] [--content file] [--nodes urls] [--json]";

class UsageError extends Error {}

/**
 * @param {readonly string[]} argv
 */
function parse(argv) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { root: { type: "string" }, server: { type: "string" }, scan: { type: "boolean" }, content: { type: "string" }, nodes: { type: "string" }, json: { type: "boolean" } },
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
  const lines = [`history: ${history.status}, ${history.records.length} record(s), ${history.events.length} event(s)${history.problem === null ? "" : ` — ${history.problem.message}`}`];
  if (content.declared !== null) {
    lines.push(`content ${content.declared.hash} (engine ${content.declared.engineVersion}): ${content.verified ? "downloaded and checked" : `not available (this verifier runs engine ${content.localEngine})`}`);
  }
  if (replay !== null) {
    const outcome = replay.outcome === null ? "" : `; winner ${replay.outcome.winner ?? "none"} (${replay.outcome.reason})`;
    lines.push(`replay: ${replay.status}${replay.message === null ? "" : ` — ${replay.message}`}${outcome}`);
  }
  lines.push(`VERDICT: ${verdict}`);
  return lines;
}

/**
 * @param {Awaited<ReturnType<typeof verifyGameOnChain>>} result
 * @param {{ gameId: string, root: string, blocks: readonly number[] | null }} context
 */
export function describeResult(result, context) {
  return [...describeSources(result, context), ...describeChecks(result)].join("\n");
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

/** @param {ReturnType<typeof parse>} options */
function nodeReader(options) {
  const nodes = options.nodes === undefined ? DEFAULT_NODES : options.nodes.split(",");
  return new SteemPublicationReader({ chain: new SteemBlockchainProvider({ rpc: new SteemRpcClient({ nodes }) }) });
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
    const result = await verifyGameOnChain({ gameId: options.gameId, reader: reader ?? nodeReader(options), rootAccount: root, blocks, fetchContent: contentSource(options, fetchImpl) });
    write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${describeResult(result, { gameId: options.gameId, root, blocks })}\n`);
    return result.verdict === Verdict.VALID ? 0 : 1;
  } catch (error) {
    write(`could not verify: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await verifyCommand(process.argv.slice(2));
}
