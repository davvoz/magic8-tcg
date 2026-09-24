/**
 * EconomyService: what things cost. Prices come from the server's price
 * list (the products' data), never from the client; a quote is the exact
 * amount in the asset's smallest unit, and the marketplace freezes it into
 * the order (docs/tcg/05-threat-model.md T3).
 */
import { AppError } from "../../../kernel/AppError.js";
import { formatAmount, safeMultiply } from "../domain/Money.js";

/**
 * @typedef {Readonly<{ network: string, asset: string, precision: number, unitAmount: number, totalAmount: number }>} Quote
 */

export class EconomyService {
  #assets;

  /** @param {{ assets: import("../domain/AssetRegistry.js").AssetRegistry }} deps */
  constructor({ assets }) {
    this.#assets = assets;
  }

  acceptedAssets() {
    return this.#assets.list();
  }

  /**
   * @param {{ prices: ReadonlyMap<string, number> }} priced a product's price list (asset → units)
   * @param {number} quantity
   * @param {string} asset
   * @returns {Quote}
   */
  quote(priced, quantity, asset) {
    const accepted = this.#assets.find(asset);
    const unitAmount = priced.prices.get(asset);
    if (accepted === undefined || unitAmount === undefined) {
      throw new AppError("VALIDATION", `this product cannot be paid in ${asset}`);
    }
    const totalAmount = safeMultiply(unitAmount, quantity);
    if (totalAmount === null) {
      throw new AppError("VALIDATION", "order total too large");
    }
    return Object.freeze({ network: accepted.network, asset, precision: accepted.precision, unitAmount, totalAmount });
  }

  /**
   * @param {number} units
   * @param {string} asset
   * @returns {string} e.g. "12.500"
   */
  format(units, asset) {
    const accepted = this.#assets.find(asset);
    if (accepted === undefined) {
      throw new Error(`EconomyService.format: unknown asset ${asset}`);
    }
    return formatAmount(units, accepted.precision);
  }
}
