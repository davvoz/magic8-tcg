/**
 * Who owns a copy of a Magic8 card, and how it got there, from the STEEM
 * chain alone.
 *
 *   node tools/verify-card.js <copyId> [--root account] [--nodes urls] [--json]
 *
 * Reads the receipt that minted the copy and every trade that moved it from
 * the authorised broadcasters' histories, and checks that each trade was
 * given by whoever owned the copy then (docs/tcg/13-scambi.md).
 *
 * Exit code: 0 VALID, 1 not valid or unknown (a free card, or not published
 * yet), 2 could not verify.
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { ProvenanceVerdict, verifyCopyOnChain } from "@magic8/protocol";
import { SteemBlockchainProvider, SteemPublicationReader, SteemRpcClient } from "@magic8/steem";
import { DEFAULT_NODES, DEFAULT_ROOT } from "./verify-game.js";

const USAGE = "usage: node tools/verify-card.js <copyId> [--root account] [--nodes urls] [--json]";
const COPY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** @param {readonly string[]} argv */
function parse(argv) {
  const parsed = parseArgs({ args: [...argv], allowPositionals: true, options: { root: { type: "string" }, nodes: { type: "string" }, json: { type: "boolean" } } });
  if (parsed.positionals.length !== 1 || !COPY_ID.test(parsed.positionals[0])) {
    throw new Error("expected one copy id (a UUID)");
  }
  return { copyId: parsed.positionals[0], root: parsed.values.root ?? DEFAULT_ROOT, nodes: parsed.values.nodes, json: parsed.values.json === true };
}

/**
 * @param {Awaited<ReturnType<typeof verifyCopyOnChain>>} result
 * @param {string} copyId
 */
export function describeCopy(result, copyId) {
  const broadcasters = result.broadcasters.length === 0 ? "none" : result.broadcasters.map((account) => `@${account}`).join(", ");
  const lines = [`copy ${copyId}`, `authorised broadcasters: ${broadcasters}`];
  if (result.copy !== null) {
    lines.push(`card: ${result.copy.definitionId} #${result.copy.serial} (${result.copy.finish})`);
  }
  if (result.minted !== null) {
    lines.push(`minted for @${result.minted.account} by order ${result.minted.order} (block ${result.minted.blockNum})`);
  }
  for (const transfer of result.transfers) {
    lines.push(`@${transfer.from} → @${transfer.to} in trade ${transfer.tradeId} (block ${transfer.blockNum})`);
  }
  if (result.owner !== null && result.verdict === ProvenanceVerdict.VALID) {
    lines.push(`owner: @${result.owner}`);
  }
  if (!result.complete) {
    lines.push("note: a broadcaster's history was too long to read to the end");
  }
  if (result.problem !== null) {
    lines.push(result.problem);
  }
  lines.push(`VERDICT: ${result.verdict}`);
  return `${lines.join("\n")}\n`;
}

/** @param {string | undefined} nodes */
function nodeReader(nodes) {
  const list = nodes === undefined ? DEFAULT_NODES : nodes.split(",");
  return new SteemPublicationReader({ chain: new SteemBlockchainProvider({ rpc: new SteemRpcClient({ nodes: list }) }) });
}

/**
 * @param {readonly string[]} argv
 * @param {{ reader?: import("@magic8/protocol").ChainReader, write?: (text: string) => void }} [deps] tests inject a reader
 * @returns {Promise<number>} exit code
 */
export async function verifyCardCommand(argv, { reader, write = (text) => process.stdout.write(text) } = {}) {
  let options;
  try {
    options = parse(argv);
  } catch (error) {
    write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    return 2;
  }
  try {
    const result = await verifyCopyOnChain({ copyId: options.copyId, reader: reader ?? nodeReader(options.nodes), rootAccount: options.root });
    write(options.json ? `${JSON.stringify(result, null, 2)}\n` : describeCopy(result, options.copyId));
    return result.verdict === ProvenanceVerdict.VALID ? 0 : 1;
  } catch (error) {
    write(`could not verify: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await verifyCardCommand(process.argv.slice(2));
}
