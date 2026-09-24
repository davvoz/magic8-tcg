/**
 * Ports of the chain module.
 *
 * @typedef {import("@magic8/protocol").ChainOperation} ChainOperation
 * @typedef {Readonly<{ blockNum: number, blockId: string, time: number }>} BlockReference
 * @typedef {Readonly<{ headBlock: number, irreversibleBlock: number, time: number }>} ChainHead
 *
 * @typedef {object} TransactionProvider signs with the broadcaster keys it holds (callers never see a key)
 * @property {string} network
 * @property {readonly string[]} signers the broadcaster accounts it holds keys for
 * @property {() => Promise<BlockReference>} reference the head block, fetched once per round of signing
 * @property {(request: { reference: BlockReference, signer: string, id: string, json: string }) => Readonly<{ txId: string, expiration: number, transaction: Readonly<Record<string, unknown>> }>} signCustomJson
 * @property {(transaction: Readonly<Record<string, unknown>>) => Promise<void>} broadcast an error does not prove the chain refused it
 * @property {(account: string, at: number) => Promise<Readonly<{ account: string, basisPoints: number }>>} resourceLevel
 *
 * @typedef {object} PublicationReader reads what was published, as protocol operations
 * @property {string} network
 * @property {() => Promise<ChainHead>} head
 * @property {(account: string, after: number, limit: number) => Promise<readonly Readonly<{ index: number, operation: ChainOperation | null }>[]>} publications
 * @property {(blockNum: number) => Promise<readonly ChainOperation[] | null>} blockOperations
 */

export const TRANSACTION_PROVIDER_METHODS = Object.freeze(["reference", "signCustomJson", "broadcast", "resourceLevel"]);
export const PUBLICATION_READER_METHODS = Object.freeze(["head", "publications", "blockOperations"]);
