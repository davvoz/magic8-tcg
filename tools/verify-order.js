/**
 * Verifies the packs of a KIJAM order from the STEEM chain.
 *
 *   node tools/verify-order.js <orderId> --server <origin> [options]
 *
 * Reads the order's receipt and its pack epochs' commitment and reveal from
 * the authorised broadcasters' histories, then redraws every pack and checks
 * it against the cards the receipt says were minted.
 *
 * Options:
 *   --server <origin>        where to download the drop tables (each is
 *                            accepted only if it hashes to the receipt's)
 *   --root <account>         the trust anchor (default: verdu.green)
 *   --payment-block <n>      the block of the payment: the epoch must have
 *                            been committed before it
 *   --nodes <urls>           STEEM API nodes, comma-separated
 *
 * Exit code: 0 VALID, 1 not valid or not revealed yet, 2 could not verify.
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { PackVerdict, verifyOrderOnChain } from "@magic8/protocol";
import { SteemBlockchainProvider, SteemPublicationReader, SteemRpcClient } from "@magic8/steem";

/** The root account whose manifests authorise the broadcasters, and the STEEM nodes read by default. */
export const DEFAULT_ROOT = "verdu.green";
export const DEFAULT_NODES = Object.freeze(["https://api.moecki.online", "https://api.justyy.com", "https://api.steemit.com"]);

const USAGE = "usage: node tools/verify-order.js <orderId> --server origin [--root account] [--payment-block n] [--nodes urls]";
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** @param {readonly string[]} argv */
function parse(argv) {
  const parsed = parseArgs({ args: [...argv], allowPositionals: true, options: { server: { type: "string" }, root: { type: "string" }, "payment-block": { type: "string" }, nodes: { type: "string" } } });
  if (parsed.positionals.length !== 1 || !ORDER_ID.test(parsed.positionals[0]) || parsed.values.server === undefined) {
    throw new Error("expected one order id (a UUID) and --server");
  }
  return { orderId: parsed.positionals[0], server: parsed.values.server, root: parsed.values.root ?? DEFAULT_ROOT, nodes: parsed.values.nodes, paymentBlock: parsed.values["payment-block"] };
}

/**
 * @param {Awaited<ReturnType<typeof verifyOrderOnChain>>} result
 * @param {string} orderId
 */
function describe(result, orderId) {
  const broadcasters = result.broadcasters.length === 0 ? "none" : result.broadcasters.map((account) => `@${account}`).join(", ");
  const lines = [`order ${orderId}`, `authorised broadcasters: ${broadcasters}`];
  for (const pack of result.packs ?? []) {
    lines.push(`pack ${pack.index} (epoch ${pack.epoch}): ${pack.cards.join(", ")}`);
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
 * @param {{ fetch?: typeof fetch, reader?: import("@magic8/protocol").ChainReader, write?: (text: string) => void }} [deps]
 * @returns {Promise<number>} exit code
 */
export async function verifyOrderCommand(argv, { fetch: fetchImpl = globalThis.fetch, reader, write = (text) => process.stdout.write(text) } = {}) {
  let options;
  try {
    options = parse(argv);
  } catch (error) {
    write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    return 2;
  }
  try {
    const listing = await (await fetchImpl(`${options.server}/api/products`)).json();
    const dropTables = new Map(listing.dropTables.map((table) => [table.hash, table.table]));
    const paymentBlock = options.paymentBlock === undefined ? null : Number(options.paymentBlock);
    const result = await verifyOrderOnChain({ orderId: options.orderId, reader: reader ?? nodeReader(options.nodes), rootAccount: options.root, dropTables, paymentBlock });
    write(describe(result, options.orderId));
    return result.verdict === PackVerdict.VALID ? 0 : 1;
  } catch (error) {
    write(`could not verify: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await verifyOrderCommand(process.argv.slice(2));
}
