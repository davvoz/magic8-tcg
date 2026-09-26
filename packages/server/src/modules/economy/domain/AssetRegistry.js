/**
 * The assets the game accepts as payment, per network, with their
 * precision: data (data/economy/assets.json), validated at startup against
 * what the payment adapters support. SBD is deliberately absent
 * (docs/tcg/06-roadmap.md, decision 2).
 *
 * @typedef {Readonly<{ network: string, asset: string, precision: number }>} AcceptedAsset
 */
import { formatAmount, parseAmount } from "./Money.js";
import { Issues, checkArrayOf, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";

const FILE_KEYS = Object.freeze(["schemaVersion", "accepted"]);
const ASSET_KEYS = Object.freeze(["network", "asset", "precision"]);
const NETWORK_PATTERN = /^[a-z][a-z0-9-]{0,15}$/;
const ASSET_PATTERN = /^[A-Z][A-Z0-9]{0,9}$/;

export class AssetRegistry {
  /** @type {readonly AcceptedAsset[]} */
  #accepted;

  /** @param {readonly AcceptedAsset[]} accepted */
  constructor(accepted) {
    this.#accepted = Object.freeze(accepted.map((entry) => Object.freeze({ ...entry })));
  }

  /** @returns {readonly AcceptedAsset[]} */
  list() {
    return this.#accepted;
  }

  /**
   * The accepted asset with that symbol (symbols are unique across networks).
   * @param {string} asset
   * @returns {AcceptedAsset | undefined}
   */
  find(asset) {
    return this.#accepted.find((entry) => entry.asset === asset);
  }

  /**
   * @param {string} asset
   * @param {unknown} text a decimal amount
   * @returns {number | null} smallest units, or null when the asset is not accepted or the amount not exact
   */
  parse(asset, text) {
    const accepted = this.find(asset);
    return accepted === undefined ? null : parseAmount(text, accepted.precision);
  }

  /**
   * @param {string} asset an accepted asset
   * @param {number} units smallest units
   * @returns {string} the exact decimal amount, e.g. "12.500"
   */
  format(asset, units) {
    const accepted = this.find(asset);
    if (accepted === undefined) {
      throw new Error(`AssetRegistry.format: unknown asset ${asset}`);
    }
    return formatAmount(units, accepted.precision);
  }
}

/**
 * @param {unknown} raw
 * @param {(network: string) => readonly { asset: string, precision: number }[]} supportedBy what each network's payment adapter can verify
 * @returns {import("@magic8/engine/shared/Result.js").Ok<AssetRegistry> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validateAssets(raw, supportedBy) {
  const issues = new Issues();
  const file = checkObject(issues, raw, "assets", FILE_KEYS);
  if (file === undefined) {
    return issues.toResult(undefined);
  }
  checkInteger(issues, file.schemaVersion, "assets.schemaVersion", { min: 1, max: 1 });
  const accepted =
    checkArrayOf(issues, file.accepted, "assets.accepted", {
      minLength: 1,
      maxLength: 20,
      item: (item, path) => {
        const entry = checkObject(issues, item, path, ASSET_KEYS);
        if (entry === undefined) {
          return undefined;
        }
        const network = checkString(issues, entry.network, `${path}.network`, { pattern: NETWORK_PATTERN });
        const asset = checkString(issues, entry.asset, `${path}.asset`, { pattern: ASSET_PATTERN });
        const precision = checkInteger(issues, entry.precision, `${path}.precision`, { min: 0, max: 8 });
        if (network === undefined || asset === undefined || precision === undefined) {
          return undefined;
        }
        const supported = supportedBy(network).find((candidate) => candidate.asset === asset);
        if (supported === undefined || supported.precision !== precision) {
          return issues.add(path, `no payment adapter verifies ${asset} (precision ${precision}) on "${network}"`);
        }
        return Object.freeze({ network, asset, precision });
      },
    }) ?? [];
  const symbols = accepted.map((entry) => entry.asset);
  if (new Set(symbols).size !== symbols.length) {
    issues.add("assets.accepted", "an asset symbol may appear once");
  }
  return issues.toResult(new AssetRegistry(accepted));
}
