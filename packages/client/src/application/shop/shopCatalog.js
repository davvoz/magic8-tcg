/**
 * The listing as the shop presents it: packs of unknown cards, complete
 * decks, single cards (one entry per card) and anything else on sale
 * (special offers). Pure: the server's
 * listing in, the shelves out; prices are the server's, never computed here
 * except for display (a deck's card-by-card breakdown).
 */

export const ShopCategory = Object.freeze({ PACKS: "packs", DECKS: "decks", SINGLES: "singles", OFFERS: "offers" });

/**
 * @typedef {import("../ports/MarketApi.contract.js").Product} Product
 * @typedef {import("../ports/MarketApi.contract.js").Listing} Listing
 * @typedef {Readonly<{ cardId: string, rarity: string | null, product: Product }>} SingleOffer
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
  /** @type {Map<string, SingleOffer>} */
  const singles = new Map();
  for (const product of listing.products) {
    const [only] = product.contents;
    const single = product.contents.length === 1 && only.type === "card" && only.count === 1;
    if (single) {
      singles.set(only.ref, Object.freeze({ cardId: only.ref, rarity: product.rarity, product }));
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
    singles: Object.freeze([...singles.values()].sort((left, right) => rank(right.rarity) - rank(left.rarity) || left.product.name.localeCompare(right.product.name))),
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
 * What a deck's cards cost one by one as singles: the server prices a deck
 * at this sum (display only; the order's price is the server's).
 * @param {readonly Readonly<{ cardId: string, count: number }>[]} entries the deck's cards
 * @param {readonly SingleOffer[]} singles
 * @returns {Readonly<{ lines: readonly Readonly<{ cardId: string, count: number, rarity: string | null, unit: string | null, amount: string | null }>[], total: string | null }>} amounts null when a card is not on sale alone
 */
export function deckBreakdown(entries, singles) {
  const lines = entries.map(({ cardId, count }) => {
    const offer = singles.find((candidate) => candidate.cardId === cardId);
    const unit = offer === undefined ? null : priceOf(offer.product).amount;
    return Object.freeze({ cardId, count, rarity: offer?.rarity ?? null, unit, amount: unit === null ? null : multiplyAmount(unit, count) });
  });
  const total = lines.every((line) => line.amount !== null) ? lines.reduce((sum, line) => addAmounts(sum, /** @type {string} */ (line.amount)), "0") : null;
  return Object.freeze({ lines: Object.freeze(lines), total });
}

/**
 * @typedef {Readonly<{ productId: string, quantity: number, product: Product | null, amount: string | null }>} CartSummaryLine `product` null when it is no longer on sale
 * @typedef {Readonly<{ lines: readonly CartSummaryLine[], asset: string | null, total: string, quantity: number, cards: number, payable: boolean }>} CartSummary
 */

/**
 * The cart as the listing prices it, for display: each line and the total,
 * in the first asset every line can be paid in (the order's price is the
 * server's). Not payable when it is empty, when a product is no longer on
 * sale, or when no single asset pays for everything.
 * @param {readonly Readonly<{ productId: string, quantity: number }>[]} cart
 * @param {readonly Product[]} products the listing's
 * @returns {CartSummary}
 */
export function cartSummary(cart, products) {
  const found = cart.map(({ productId, quantity }) => ({ productId, quantity, product: products.find((candidate) => candidate.id === productId) ?? null }));
  const onSale = found.flatMap((line) => (line.product === null ? [] : [line.product]));
  const asset = onSale[0]?.prices.map((price) => price.asset).find((candidate) => onSale.every((product) => product.prices.some((price) => price.asset === candidate))) ?? null;
  const lines = found.map((line) => {
    const unit = line.product?.prices.find((price) => price.asset === asset)?.amount;
    return Object.freeze({ ...line, amount: unit === undefined ? null : multiplyAmount(unit, line.quantity) });
  });
  return Object.freeze({
    lines: Object.freeze(lines),
    asset,
    total: lines.reduce((sum, line) => (line.amount === null ? sum : addAmounts(sum, line.amount)), "0"),
    quantity: cart.reduce((sum, line) => sum + line.quantity, 0),
    cards: lines.reduce((sum, line) => sum + (line.product?.cards ?? 0) * line.quantity, 0),
    payable: lines.length > 0 && lines.every((line) => line.amount !== null),
  });
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
