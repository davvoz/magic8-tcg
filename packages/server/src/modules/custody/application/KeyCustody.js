/**
 * KeyCustody: the keys of the accounts the server keeps (docs/tcg/29-google.md).
 *
 * - keep: checks every key is a private key of the chain, seals them all
 *   with the data key (SecretBox, bound to the user's row) and stores them
 *   with the posting public key in clear (sessions name it).
 * - Nothing here logs or returns a private key.
 */
import { utf8 } from "@magic8/protocol";
import { AppError } from "../../../kernel/AppError.js";
import { assertImplements } from "../../../kernel/contracts.js";
import { CUSTODY_REPOSITORY_METHODS, KEYRING_METHODS } from "./ports.js";

const KEY_NAMES = Object.freeze(["owner", "active", "posting", "memo"]);
const MAX_PASSWORD_LENGTH = 200;

/** @param {string} userId */
export const custodyContext = (userId) => `custody_keys:${userId}`;

export class KeyCustody {
  #repository;
  #keyrings;
  #secrets;
  #clock;

  /**
   * @param {{
   *   repository: import("./ports.js").CustodyRepository,
   *   keyrings: ReadonlyMap<string, import("./ports.js").Keyring>,
   *   secrets: import("../../../kernel/crypto/SecretBox.js").SecretBox,
   *   clock: import("../../../kernel/time.js").Clock,
   * }} deps
   */
  constructor({ repository, keyrings, secrets, clock }) {
    assertImplements(repository, CUSTODY_REPOSITORY_METHODS, "CustodyRepository");
    for (const [network, keyring] of keyrings) {
      assertImplements(keyring, KEYRING_METHODS, `keyring "${network}"`);
    }
    this.#repository = repository;
    this.#keyrings = keyrings;
    this.#secrets = secrets;
    this.#clock = clock;
  }

  /**
   * Keeps the keys of a new account. Runs in the caller's unit of work.
   * @param {{ userId: string, network: string, account: string, keys: import("./ports.js").AccountKeys }} input
   * @returns {Promise<string>} the posting public key
   */
  async keep({ userId, network, account, keys }) {
    const keyring = this.#keyrings.get(network);
    if (keyring === undefined) {
      throw new AppError("UNSUPPORTED_NETWORK", "this network's keys cannot be kept");
    }
    const publicKeys = KEY_NAMES.map((name) => keyring.publicKeyOf(keys[name]));
    if (publicKeys.some((key) => key === null) || typeof keys.masterPassword !== "string" || keys.masterPassword.length === 0 || keys.masterPassword.length > MAX_PASSWORD_LENGTH) {
      throw new Error("KeyCustody: the account's keys are malformed");
    }
    const postingPublic = /** @type {string} */ (publicKeys[KEY_NAMES.indexOf("posting")]);
    const secret = JSON.stringify({ masterPassword: keys.masterPassword, owner: keys.owner, active: keys.active, posting: keys.posting, memo: keys.memo });
    const sealed = this.#secrets.seal(utf8(secret), custodyContext(userId));
    if (!(await this.#repository.insert({ userId, network, account, postingPublic, sealed, createdAt: this.#clock.now() }))) {
      throw new AppError("CONFLICT", "this account's keys are already kept");
    }
    return postingPublic;
  }

  /**
   * The account the server keeps for a user, and its posting public key: the key its Google sessions name.
   * @param {string} userId
   * @returns {Promise<Readonly<{ network: string, account: string, postingPublic: string }> | null>} null when the server keeps no keys for this user
   */
  async keptAccountOf(userId) {
    return this.#repository.find(userId);
  }
}
