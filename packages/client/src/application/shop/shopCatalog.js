/**
 * The listing as the shop presents it: packs of unknown cards, complete
 * decks, single cards (one entry per card, with its standard and foil
 * offers) and anything else on sale (special offers). Pure: the server's
 * listing in, the shelves out; prices are the server's, never computed here
 * except for display (a deck's card-by-card breakdown).
 */

export const ShopCategory = Object.freeze({ PACKS: "packs", DECKS: "decks", SINGLES: "singles", OFFERS: "offers" });

/**
 * @typedef {import("../ports/MarketApi.contract.js").Product} Product
 * @typedef {import("../ports/MarketApi.contract.js").Listing} Listing
 * @typedef {Readonly<{ cardId: string, rarity: string | null, standard: Product | null, foil: Product | null }>} SingleOffer
 * @typedef {Readonly<{ packs: readonly Product[], decks: readonly Product[], singles: readonly SingleOffer[], offers: readonly Product[] }>} Shelves
 */

/**
 * @param {Listing} listing
 * @returns {Shelves}
 */
export function shelvesOf(listing) {
  /** @type {Product[]} */
  const packs = [];
  /** @type {Product[]} */
  const decks = [];
  /** @type {Product[]} */
  const offers = [];
  /** @type {Map<string, { cardId: string, rarity: string | null, standard: Product | null, foil: Product | null }>} */
  const singles = new Map();
  for (const product of listing.products) {
    const [only] = product.contents;
    const single = product.contents.length === 1 && only.type === "card" && only.count === 1;
    if (single) {
      const offer = singles.get(only.ref) ?? { cardId: only.ref, rarity: product.rarity, standard: null, foil: null };
      offer[only.finish === "foil" ? "foil" : "standard"] = product;
      singles.set(only.ref, offer);
    } else if (product.contents.length === 1 && only.type === "pack") {
      packs.push(product);
    } else if (product.contents.length === 1 && only.type === "deck" && only.count === 1) {
      decks.push(product);
    } else {
      offers.push(product);
    }
  }
  const rank = (rarity) => listing.rarities.indexOf(rarity ?? "");
  const byPrice = (left, right) => compareAmounts(priceOf(left).amount, priceOf(right).amount) || left.name.localeCompare(right.name);
  return Object.freeze({
    packs: Object.freeze(packs.sort(byPrice)),
    decks: Object.freeze(decks.sort(byPrice)),
    // Rarest first, then by name.
    singles: Object.freeze([...singles.values()].map((offer) => Object.freeze(offer)).sort((left, right) => rank(right.rarity) - rank(left.rarity) || nameOf(left).localeCompare(nameOf(right)))),
    offers: Object.freeze(offers.sort(byPrice)),
  });
}

/**
 * The price shown for a product: its first price (the server lists the asset it prefers first).
 * @param {Product} product
 */
export function priceOf(product) {
  return product.prices[0];
}

/**
 * The offer to show for a single: the standard one when on sale, otherwise the foil one.
 * @param {SingleOffer} offer
 * @returns {Product}
 */
export function mainOfferOf(offer) {
  return /** @type {Product} */ (offer.standard ?? offer.foil);
}

/** @param {SingleOffer} offer */
function nameOf(offer) {
  return offer.standard?.name ?? offer.foil?.name ?? offer.cardId;
}

/**
 * What a deck's cards cost one by one as singles: the server prices a deck
 * at this sum (display only; the order's price is the server's).
 * @param {readonly Readonly<{ cardId: string, count: number }>[]} entries the deck's cards
 * @param {readonly SingleOffer[]} singles
 * @returns {Readonly<{ lines: readonly Readonly<{ cardId: string, count: number, rarity: string | null, unit: string | null, amount: string | null }>[], total: string | null }>} amounts null when a card is not on sale alone
 */
export function deckBreakdown(entries, singles) {
  const lines = entries.map(({ cardId, count }) => {
    const offer = singles.find((candidate) => candidate.cardId === cardId);
    const unit = offer?.standard ? priceOf(offer.standard).amount : null;
    return Object.freeze({ cardId, count, rarity: offer?.rarity ?? null, unit, amount: unit === null ? null : multiplyAmount(unit, count) });
  });
  const total = lines.every((line) => line.amount !== null) ? lines.reduce((sum, line) => addAmounts(sum, /** @type {string} */ (line.amount)), "0") : null;
  return Object.freeze({ lines: Object.freeze(lines), total });
}

/**
 * Exact decimal arithmetic on amount strings, for display: "1.000" × 3 → "3.000".
 * @param {string} amount
 * @param {number} times
 */
export function multiplyAmount(amount, times) {
  const { units, decimals } = toUnits(amount);
  return fromUnits(units * BigInt(times), decimals);
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {string} the sum, with the larger number of decimals of the two
 */
export function addAmounts(left, right) {
  const decimals = Math.max(toUnits(left).decimals, toUnits(right).decimals);
  return fromUnits(toUnits(left, decimals).units + toUnits(right, decimals).units, decimals);
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number} negative, zero or positive
 */
function compareAmounts(left, right) {
  const decimals = Math.max(toUnits(left).decimals, toUnits(right).decimals);
  const difference = toUnits(left, decimals).units - toUnits(right, decimals).units;
  return difference === 0n ? 0 : Math.sign(Number(difference));
}

/**
 * @param {string} amount e.g. "12.5"
 * @param {number} [decimals] scale to this many decimals (at least the amount's own)
 */
function toUnits(amount, decimals) {
  const [whole, fraction = ""] = amount.split(".");
  const scale = decimals ?? fraction.length;
  return { units: BigInt(`${whole}${fraction.padEnd(scale, "0")}`), decimals: scale };
}

/**
 * @param {bigint} units
 * @param {number} decimals
 */
function fromUnits(units, decimals) {
  const digits = units.toString().padStart(decimals + 1, "0");
  return decimals === 0 ? digits : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
