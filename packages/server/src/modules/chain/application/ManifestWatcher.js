/**
 * ManifestWatcher: which broadcasters the root account has authorised
 * (docs/tcg/03 §11), read from the chain like a verifier reads it.
 *
 * A manifest never authorises records retroactively: a record included
 * before its signer's authorisation is invalid forever. So a broadcaster
 * publishes only once the root's manifest authorises it at the last
 * irreversible block — anything it publishes afterwards lands in a later
 * block and verifies. Until then its records wait in the outbox, and the
 * log says why.
 */
import { BroadcasterRegistry, OperationId } from "@magic8/protocol";

const PAGE_SIZE = 1000;

export class ManifestWatcher {
  #reader;
  #rootAccount;
  #logger;
  #maxPagesPerRound;
  /** @type {import("@magic8/protocol").ChainOperation[]} */
  #manifests = [];
  #cursor = -1;
  #registry = new BroadcasterRegistry([]);
  #irreversibleBlock = 0;
  /** @type {Set<string>} signers already reported as unauthorised */
  #reported = new Set();

  /**
   * @param {{
   *   reader: import("./ports.js").PublicationReader,
   *   rootAccount: string,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   maxPagesPerRound?: number,
   * }} deps
   */
  constructor({ reader, rootAccount, logger, maxPagesPerRound = 20 }) {
    this.#reader = reader;
    this.#rootAccount = rootAccount;
    this.#logger = logger;
    this.#maxPagesPerRound = maxPagesPerRound;
  }

  /**
   * Whether `signer` may publish now; logs once when it may not.
   * @param {string} signer
   */
  isAuthorized(signer) {
    const authorized = this.#registry.isAuthorized(signer, this.#irreversibleBlock);
    if (authorized) {
      this.#reported.delete(signer);
    } else if (!this.#reported.has(signer)) {
      this.#reported.add(signer);
      this.#logger.warn("broadcaster not authorised by the root account's manifest (yet): its records wait", { signer, root: this.#rootAccount, irreversibleBlock: this.#irreversibleBlock });
    }
    return authorized;
  }

  /** Reads the root's new operations; only manifests in irreversible blocks count. */
  async runOnce() {
    const head = await this.#reader.head();
    for (let page = 0; page < this.#maxPagesPerRound; page += 1) {
      const entries = await this.#reader.publications(this.#rootAccount, this.#cursor, PAGE_SIZE);
      for (const { operation } of entries) {
        if (operation !== null && operation.id === OperationId.MANIFEST) {
          this.#manifests.push(operation);
        }
      }
      if (entries.length > 0) {
        this.#cursor = entries[entries.length - 1].index;
      }
      if (entries.length < PAGE_SIZE) {
        break;
      }
    }
    const irreversible = this.#manifests.filter((operation) => operation.blockNum <= head.irreversibleBlock);
    this.#registry = BroadcasterRegistry.fromOperations(irreversible, this.#rootAccount).registry;
    this.#irreversibleBlock = head.irreversibleBlock;
  }
}
