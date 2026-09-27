/**
 * A `custom_json` operation observed on a chain, as chain adapters produce
 * it: network-agnostic, so the protocol reads manifests and receipts the
 * same way on any network.
 *
 * @typedef {Readonly<{
 *   network: string,
 *   txId: string,
 *   blockNum: number,
 *   opIndex: number,
 *   id: string,
 *   requiredAuths: readonly string[],
 *   requiredPostingAuths: readonly string[],
 *   json: string,
 * }>} ChainOperation
 *
 * @typedef {object} ChainReader what a verifier reads from a chain
 * @property {() => Promise<Readonly<{ headBlock: number, irreversibleBlock: number, time: number }>>} head
 * @property {(account: string, after: number, limit: number) => Promise<readonly Readonly<{ index: number, operation: ChainOperation | null }>[]>} publications
 * @property {(blockNum: number) => Promise<readonly ChainOperation[] | null>} blockOperations
 */

export {};
