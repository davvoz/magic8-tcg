/**
 * The shop, in three shelves chosen with tabs on the left:
 *
 *   Packs    boosters of cards you do not know in advance, at a fixed price
 *   Decks    complete preconstructed decks, priced at the sum of their cards
 *   Singles  every card, priced by its rarity; filterable by faction,
 *            rarity and type
 *
 * (plus Offers, only when the server sells something else). On the right,
 * the selected item: a pack's odds, a deck's card-by-card price, a card at
 * full size with the price list by rarity; then the
 * quantity, Buy and Add to cart. The cart (header) lists what was added from
 * any shelf, lets the player change or remove it, and pays for all of it
 * with one transfer. Paying goes through the wallet (Keychain shows the
 * exact transfer); when the order is fulfilled the cards received are
 * revealed, pack by pack. Every price shown is the server's.
 */
import { ANY, NO_CARD_FILTER, cardFilterOptions, describeCardFilter, isFiltering, matchesCardFilter } from "../../application/content/CardFilter.js";
import { BUSY_STAGES, PurchaseStage, ShopStatus } from "../../application/shop/ShopService.js";
import { deckMix } from "../../application/decks/deckMix.js";
import { ShopCategory, cartSummary, deckBreakdown, multiplyAmount, priceOf, shelvesOf } from "../../application/shop/shopCatalog.js";
import { mixBands, mixText } from "../cards/deckStripe.js";
import { CARD_FILTER_BAR_HEIGHT, buildCardFilterBar } from "../cards/cardFilterBar.js";
import { CardDetail } from "../cards/CardDetail.js";
import { CardFan } from "../cards/CardFan.js";
import { CardStrip } from "../cards/CardStrip.js";
import { CardThumb } from "../cards/CardThumb.js";
import { buildCardInfoModal, rarityOf } from "../cards/cardInfo.js";
import { rarityColorKey, rarityLabel } from "../theme/rarity.js";
import { unknownCard } from "../cards/unknownCard.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { ACTION, COLUMNS, HEADER, INSET, ROW, rowY, rowsHeight } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const LIST_ID = "shop.list";
const LINE = 28;
const TABS = Object.freeze({ top: 20, height: 40, gap: 8 });
const FILTER_TOP = 72;
const LIST_TOP = Object.freeze({ plain: 76, filtered: FILTER_TOP + CARD_FILTER_BAR_HEIGHT + 12 });
const PRICE_WIDTH = 170;
const QUANTITY = Object.freeze({ height: 52, width: 80 });
const BUY = Object.freeze({ height: 60, width: 420 });
const SINGLE = Object.freeze({ card: Object.freeze({ width: 300, height: 442 }), legendColumn: 120 });
/** A deck's cards as thumbnails: the card, "copies × price each", its rarity. */
const DECK_THUMB = Object.freeze({ width: 84, gap: 12, rarity: 20 });
const REVEAL = Object.freeze({ width: 1100, height: 780, row: 44, gap: 6, packGap: 16 });
/** The cart: a grid of tiles, each the product's cards over its name, price and quantity. */
/** `step`: the − and + buttons (wide enough for their sign past the button's padding). */
const CART = Object.freeze({ width: 1100, height: 860, footer: 56, perRow: 3, gap: 16, tile: 300, fan: 170, step: Object.freeze({ width: 56, height: 44 }), remove: 48 });
const CART_LIST_ID = "cart.lines";
const DETAIL_WIDTH = COLUMNS.right.width - 2 * INSET;
/** Where the purchase controls start in the detail panel; everything else fits above. */
const PURCHASE_TOP = COLUMNS.height - INSET - 2 * LINE - 8 - BUY.height - INSET - QUANTITY.height;

const TAB_TITLES = Object.freeze({ [ShopCategory.PACKS]: "Packs", [ShopCategory.DECKS]: "Decks", [ShopCategory.SINGLES]: "Singles", [ShopCategory.OFFERS]: "Offers" });
/** Rarities drawn in theme colours, commonest to rarest. */
const EMPTY_SHELVES = shelvesOf({ products: [], dropTables: [], rarities: [], priceList: { asset: "", singles: [] } });

/** What the player sees at each step of a purchase. */
const STAGE_TEXT = Object.freeze({
  [PurchaseStage.ORDERING]: () => "Creating your order…",
  [PurchaseStage.SIGNING]: (purchase) => `Approve the transfer in Keychain: ${purchase.order.payment.amount} ${purchase.order.payment.asset} to @${purchase.order.payment.to}.`,
  [PurchaseStage.CONFIRMING]: () => "Payment sent. The STEEM blockchain makes it final in about a minute: keep playing, you will be notified when your cards arrive.",
  [PurchaseStage.DONE]: () => "Done: your cards are in your collection.",
});

/**
 * @typedef {import("../../application/ports/MarketApi.contract.js").Product} Product
 * @typedef {import("../../application/shop/shopCatalog.js").SingleOffer} SingleOffer
 * @typedef {import("../../application/shop/shopCatalog.js").Shelves} Shelves
 */

/** @param {string | null} rarity */
const rarityColor = (rarity) => rarityColorKey(rarity);
/** @param {Product} product */
const priceText = (product) => `${priceOf(product).amount} ${priceOf(product).asset}`;
/** @param {number} count */
const cardsText = (count) => `${count} card${count === 1 ? "" : "s"}`;

export class ShopScene extends Scene {
  #app;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** The shelf shown (a ShopCategory). @type {string} */
  #category = ShopCategory.PACKS;
  /** Singles shown. @type {import("../../application/content/CardFilter.js").CardFilter} */
  #filter = NO_CARD_FILTER;
  /** The selected entry of each shelf: a product id, or a card id among singles. @type {Record<string, string | null>} */
  #selected = { [ShopCategory.PACKS]: null, [ShopCategory.DECKS]: null, [ShopCategory.SINGLES]: null, [ShopCategory.OFFERS]: null };
  #quantity = 1;
  /** The list starts from the top on the next rebuild (another shelf or filter). */
  #scrollToTop = false;
  /** The reveal of the last fulfilled order was closed. */
  #revealClosed = false;
  /** The cart is open (it stays open across rebuilds, behind a reveal). */
  #cartShown = false;
  /** What the last Add to cart did, until the next choice. @type {{ text: string, colorKey: string } | null} */
  #notice = null;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#app = app;
  }

  enter() {
    const shop = this.#shop();
    this.#unsubscribe = shop.subscribe(() => this.#rebuild());
    this.#revealClosed = false;
    if (shop.state.status === ShopStatus.IDLE || shop.state.status === ShopStatus.FAILED) {
      shop.load();
    }
    this.#rebuild();
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.exit();
  }

  onCancel() {
    if (this.modal !== null) {
      super.onCancel();
      return;
    }
    this.services.navigate(SceneId.MAIN_MENU);
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    const { theme, viewport } = this.services;
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "shop" });
    super.render(context);
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    const scrollY = this.#takeScroll();
    const cartList = this.modal?.findById(CART_LIST_ID);
    const cartScrollY = cartList instanceof ScrollList ? cartList.scrollY : 0;
    this.closeModal();
    this.root.clear();
    const shelves = this.#shelves();
    const back = this.#buildHeader();
    const listPanel = this.root.add(new Panel({ x: COLUMNS.left.x, y: COLUMNS.top, width: COLUMNS.left.width, height: COLUMNS.height }));
    const firstControl = this.#buildShelfControls(listPanel, shelves);
    const firstRow = this.#buildList(listPanel, shelves, scrollY);
    const buy = this.#buildDetail(shelves);
    const modalFocus = this.#openRevealIfDone() ?? this.#openCartIfShown(focusedId, cartScrollY);
    this.focus(modalFocus ?? this.root.findById(focusedId) ?? buy ?? firstRow ?? firstControl ?? back);
    this.services.requestRender();
  }

  /** Where the list was scrolled, or the top after a change of shelf or filter. */
  #takeScroll() {
    const list = this.root.findById(LIST_ID);
    const scrollY = list instanceof ScrollList && !this.#scrollToTop ? list.scrollY : 0;
    this.#scrollToTop = false;
    return scrollY;
  }

  /** The listing's shelves; the Offers shelf is left when it empties. */
  #shelves() {
    const listing = this.#shop().state.listing;
    const shelves = listing === null ? EMPTY_SHELVES : shelvesOf(listing);
    if (this.#category === ShopCategory.OFFERS && shelves.offers.length === 0) {
      this.#category = ShopCategory.PACKS;
    }
    return shelves;
  }

  /**
   * The tabs, and the card filter on the Singles shelf.
   * @param {Panel} panel
   * @param {Shelves} shelves
   * @returns {Button | null} the first filter, else the first tab
   */
  #buildShelfControls(panel, shelves) {
    const firstTab = this.#buildTabs(panel, shelves);
    if (this.#category !== ShopCategory.SINGLES) {
      return firstTab;
    }
    // Singles are priced by the server's rarities: offer those when the listing names them.
    const options = cardFilterOptions(this.#app);
    const rarities = this.#shop().state.listing?.rarities ?? [];
    const shelfOptions = rarities.length === 0 ? options : Object.freeze({ ...options, rarity: Object.freeze([ANY, ...rarities]) });
    return buildCardFilterBar(panel, { id: "shop.filter", x: INSET, y: FILTER_TOP, width: COLUMNS.left.width - 2 * INSET, filter: this.#filter, options: shelfOptions, onChange: (filter) => this.#changeFilter(filter) });
  }

  /** @returns {Button} */
  #buildHeader() {
    const { viewport } = this.services;
    const account = this.#app.account?.state.account ?? null;
    this.root.add(new Label({ x: HEADER.sideMargin, y: HEADER.y, width: 200, height: HEADER.height, text: "Shop", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const note = account === null ? "Sign in with Keychain to buy. Prices are paid in STEEM, straight from your wallet." : `Buying as @${account}. Payments go straight from your wallet; nothing is stored in the game.`;
    const market = this.services.hasScene(SceneId.MARKET);
    const buttons = market ? 3 : 2;
    this.root.add(new Label({ x: HEADER.sideMargin + 200, y: HEADER.y, width: viewport.logicalWidth - 2 * HEADER.sideMargin - 200 - buttons * (HEADER.backWidth + 16), height: HEADER.height, text: note, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    const inCart = this.#shop().state.cart.reduce((sum, line) => sum + line.quantity, 0);
    this.root.add(
      new Button({
        id: "shop.cart",
        x: viewport.logicalWidth - HEADER.sideMargin - buttons * HEADER.backWidth - (buttons - 1) * 16,
        y: HEADER.y + 4,
        width: HEADER.backWidth,
        height: HEADER.height - 8,
        text: inCart === 0 ? "Cart" : `Cart (${inCart})`,
        variant: inCart === 0 ? "secondary" : "primary",
        onActivate: () => this.#showCart(true),
      }),
    );
    if (market) {
      this.root.add(new Button({ id: "shop.market", x: viewport.logicalWidth - HEADER.sideMargin - 2 * HEADER.backWidth - 16, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: "Player market", onActivate: () => this.services.navigate(SceneId.MARKET, { from: SceneId.SHOP }) }));
    }
    return this.root.add(new Button({ id: "shop.back", x: viewport.logicalWidth - HEADER.sideMargin - HEADER.backWidth, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: "Back to menu", onActivate: () => this.services.navigate(SceneId.MAIN_MENU) }));
  }

  /**
   * @param {Panel} panel
   * @param {Shelves} shelves
   * @returns {Button | null} the first tab
   */
  #buildTabs(panel, shelves) {
    const categories = [ShopCategory.PACKS, ShopCategory.DECKS, ShopCategory.SINGLES, ...(shelves.offers.length > 0 ? [ShopCategory.OFFERS] : [])];
    const inner = COLUMNS.left.width - 2 * INSET;
    const width = (inner - (categories.length - 1) * TABS.gap) / categories.length;
    /** @type {Button | null} */
    let first = null;
    categories.forEach((category, index) => {
      const count = category === ShopCategory.SINGLES ? shelves.singles.length : shelves[/** @type {"packs" | "decks" | "offers"} */ (category)].length;
      const tab = panel.add(
        new Button({
          id: `shop.tab.${category}`,
          x: INSET + index * (width + TABS.gap),
          y: TABS.top,
          width,
          height: TABS.height,
          text: count > 0 ? `${TAB_TITLES[category]} (${count})` : TAB_TITLES[category],
          variant: category === this.#category ? "primary" : "secondary",
          onActivate: () => this.#show(category),
        }),
      );
      first ??= tab;
    });
    return first;
  }

  /**
   * The shelf's entries, keeping (or making) a selection among them.
   * @param {Panel} panel
   * @param {Shelves} shelves
   * @param {number} scrollY
   * @returns {Button | null} the first row
   */
  #buildList(panel, shelves, scrollY) {
    const top = this.#category === ShopCategory.SINGLES ? LIST_TOP.filtered : LIST_TOP.plain;
    const list = panel.add(new ScrollList({ id: LIST_ID, x: INSET, y: top, width: COLUMNS.left.width - 2 * INSET, height: COLUMNS.height - top - INSET }));
    const keys = this.#entryKeys(shelves);
    if (!keys.includes(this.#selected[this.#category] ?? "")) {
      this.#selected[this.#category] = keys[0] ?? null;
      this.#resetChoice();
    }
    if (keys.length === 0) {
      const { status, error } = this.#shop().state;
      const text = { [ShopStatus.FAILED]: `The shop could not be loaded: ${error?.message ?? "unknown error"}`, [ShopStatus.READY]: this.#emptyShelfText() }[status] ?? "Loading the shop…";
      list.add(new Label({ id: "shop.empty", x: 0, y: 0, width: list.rowWidth, height: ROW.height, text, colorKey: status === ShopStatus.FAILED ? "danger" : "textMuted", fit: true }));
      list.contentHeight = ROW.height;
      return null;
    }
    const rows = this.#category === ShopCategory.SINGLES ? this.#singleRows(list, this.#visibleSingles(shelves)) : this.#productRows(list, /** @type {readonly Product[]} */ (shelves[/** @type {"packs" | "decks" | "offers"} */ (this.#category)]));
    list.contentHeight = rowsHeight(keys.length);
    list.scrollTo(scrollY);
    return rows[0] ?? null;
  }

  #emptyShelfText() {
    return this.#category === ShopCategory.SINGLES && isFiltering(this.#filter) ? `No ${describeCardFilter(this.#filter)} cards on sale.` : "Nothing on sale here right now.";
  }

  /**
   * @param {ScrollList} list
   * @param {readonly Product[]} products
   */
  #productRows(list, products) {
    return products.map((product, index) => {
      const deck = this.#deckOf(product);
      const subtitle = {
        [ShopCategory.PACKS]: () => `${product.cards} unknown cards · ${priceText(product)}`,
        [ShopCategory.DECKS]: () => [cardsText(product.cards), priceText(product), deck === undefined ? "" : mixText(this.#mixOf(deck))].filter((part) => part.length > 0).join(" · "),
      }[this.#category] ?? (() => `${cardsText(product.cards)} · ${priceText(product)}`);
      return list.add(new OptionRow({ id: `shop.product.${product.id}`, x: 0, y: rowY(index), width: list.rowWidth, height: ROW.height, text: product.name, subtitle: subtitle(), stripe: this.#stripeOf(deck), selected: product.id === this.#selected[this.#category], onActivate: () => this.#select(product.id) }));
    });
  }

  /**
   * A deck's row is striped with its faction mix, a pack's in gold.
   * @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList | undefined} deck
   */
  #stripeOf(deck) {
    const { theme } = this.services;
    if (deck !== undefined) {
      return mixBands(theme, this.#mixOf(deck));
    }
    return this.#category === ShopCategory.PACKS ? [{ color: theme.colors.accent, weight: 1 }] : [];
  }

  /** @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} deck */
  #mixOf(deck) {
    return deckMix(this.#app.content, deck.entries);
  }

  /**
   * A card strip per single, with its price as the button that selects it.
   * @param {ScrollList} list
   * @param {readonly SingleOffer[]} singles
   */
  #singleRows(list, singles) {
    const stripWidth = list.rowWidth - PRICE_WIDTH - ACTION.gap;
    return singles.map((offer, index) => {
      const card = this.#app.content.catalog.get(offer.cardId);
      const selected = offer.cardId === this.#selected[ShopCategory.SINGLES];
      list.add(new CardStrip({ x: 0, y: rowY(index), width: stripWidth, height: ROW.height, card: card ?? unknownCard(offer.cardId), broken: card === undefined, muted: !selected, rarity: offer.rarity ?? rarityOf(this.#app, offer.cardId) }));
      return list.add(new Button({ id: `shop.card.${offer.cardId}`, x: stripWidth + ACTION.gap, y: rowY(index), width: PRICE_WIDTH, height: ROW.height, text: priceText(offer.product), variant: selected ? "primary" : "secondary", textSize: "small", onActivate: () => this.#select(offer.cardId) }));
    });
  }

  /**
   * @param {Shelves} shelves
   * @returns {Button | null} the Buy button
   */
  #buildDetail(shelves) {
    const panel = this.root.add(new Panel({ x: COLUMNS.right.x, y: COLUMNS.top, width: COLUMNS.right.width, height: COLUMNS.height }));
    const selected = this.#selected[this.#category];
    if (this.#category === ShopCategory.SINGLES) {
      const offer = shelves.singles.find((candidate) => candidate.cardId === selected);
      return offer === undefined ? null : this.#buildSingleDetail(panel, offer);
    }
    const products = /** @type {readonly Product[]} */ (shelves[/** @type {"packs" | "decks" | "offers"} */ (this.#category)]);
    const product = products.find((candidate) => candidate.id === selected);
    if (product === undefined) {
      return null;
    }
    this.#buildTitle(panel, product);
    const deck = this.#deckOf(product);
    if (deck !== undefined) {
      this.#buildDeckContents(panel, product, deck, shelves.singles);
    } else {
      const lines = [...this.#contentLines(product), ...this.#oddsLines(product)];
      lines.forEach((line, index) => panel.add(new Label({ x: INSET, y: 150 + index * LINE, width: DETAIL_WIDTH, height: LINE, text: line.text, size: "small", align: "left", colorKey: line.colorKey, fit: true })));
    }
    return this.#buildPurchase(panel, product);
  }

  /**
   * @param {Panel} panel
   * @param {Product} product
   */
  #buildTitle(panel, product) {
    panel.add(new Label({ x: INSET, y: 14, width: DETAIL_WIDTH, height: 40, text: product.name, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    panel.add(new TextBlock({ x: INSET, y: 62, width: DETAIL_WIDTH, height: 3 * LINE, text: product.description, size: "small", colorKey: "textMuted" }));
  }

  /**
   * A deck's cards with what each costs as a single; the deck costs their sum.
   * @param {Panel} panel
   * @param {Product} product
   * @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} deck
   * @param {readonly SingleOffer[]} singles
   */
  #buildDeckContents(panel, product, deck, singles) {
    const { lines, total } = deckBreakdown(deck.entries, singles);
    const top = 150;
    const bottom = PURCHASE_TOP - INSET - LINE;
    panel.add(new Label({ x: INSET, y: top, width: DETAIL_WIDTH, height: LINE, text: `${mixText(this.#mixOf(deck))} · ${cardsText(product.cards)}, ${lines.length} different · copies × price as a single · tap a card for its details`, size: "small", align: "left", colorKey: "accentLight", fit: true }));
    const list = panel.add(new ScrollList({ id: "shop.deckCards", x: INSET, y: top + LINE + 6, width: DETAIL_WIDTH, height: bottom - top - LINE - 6 }));
    const perRow = Math.max(1, Math.floor((list.rowWidth + DECK_THUMB.gap) / (DECK_THUMB.width + DECK_THUMB.gap)));
    const cellHeight = CardThumb.heightFor(DECK_THUMB.width) + DECK_THUMB.rarity + DECK_THUMB.gap;
    lines.forEach((line, index) => {
      const x = (index % perRow) * (DECK_THUMB.width + DECK_THUMB.gap);
      const y = Math.floor(index / perRow) * cellHeight;
      const card = this.#app.content.catalog.get(line.cardId);
      const rarity = line.rarity ?? rarityOf(this.#app, line.cardId);
      list.add(
        new CardThumb({
          id: `shop.deckCard.${line.cardId}`,
          x,
          y,
          width: DECK_THUMB.width,
          card: card ?? { ...unknownCard(line.cardId), text: "" },
          caption: `${line.count} × ${line.unit ?? "—"}`,
          rarity,
          onActivate: card === undefined ? null : () => this.#showDeckCard(line, product),
        }),
      );
      list.add(new Label({ x, y: y + CardThumb.heightFor(DECK_THUMB.width), width: DECK_THUMB.width, height: DECK_THUMB.rarity, text: rarityLabel(rarity), size: "tiny", weight: "bold", colorKey: rarityColor(rarity), fit: true }));
    });
    list.contentHeight = Math.ceil(lines.length / perRow) * cellHeight - DECK_THUMB.gap;
    const sum = total === null ? "" : `Sum of the cards: ${total} ${priceOf(product).asset} · `;
    panel.add(new Label({ id: "shop.deckTotal", x: INSET, y: bottom, width: DETAIL_WIDTH, height: LINE, text: `${sum}Deck price: ${priceText(product)}`, size: "small", weight: "bold", align: "right", colorKey: "accentLight", fit: true }));
  }

  /**
   * One card of a deck on sale, in detail: how many the deck holds and what they cost as singles.
   * @param {ReturnType<typeof deckBreakdown>["lines"][number]} line
   * @param {Product} product
   */
  #showDeckCard(line, product) {
    const card = this.#app.content.catalog.get(line.cardId);
    if (card === undefined) {
      return;
    }
    const { asset } = priceOf(product);
    const lines = [`In this deck: ${line.count}`];
    if (line.unit === null) {
      lines.push("Not sold as a single");
    } else {
      lines.push(`As a single: ${line.unit} ${asset} each`, `${line.count} in the deck: ${line.amount} ${asset}`);
    }
    this.openModal(buildCardInfoModal({ viewport: this.services.viewport, card, rarity: line.rarity ?? rarityOf(this.#app, line.cardId), lines, onClose: () => this.closeModal() }));
  }

  /**
   * A single: the card at full size; beside it its rarity, how many you own
   * and the price list by rarity.
   * @param {Panel} panel
   * @param {SingleOffer} offer
   * @returns {Button} the Buy button
   */
  #buildSingleDetail(panel, offer) {
    const card = this.#app.content.catalog.get(offer.cardId);
    if (card !== undefined) {
      panel.add(new CardDetail({ id: "shop.cardDetail", x: INSET, y: INSET, width: SINGLE.card.width, height: SINGLE.card.height, card, rarity: offer.rarity ?? rarityOf(this.#app, offer.cardId) }));
    }
    const x = INSET + SINGLE.card.width + INSET;
    const width = COLUMNS.right.width - x - INSET;
    panel.add(new Label({ x, y: INSET, width, height: 40, text: card?.name ?? offer.cardId, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    panel.add(new Label({ id: "shop.rarity", x, y: INSET + 44, width, height: LINE, text: rarityLabel(offer.rarity), weight: "bold", align: "left", colorKey: rarityColor(offer.rarity) }));
    const owned = this.#ownedCopies(offer.cardId);
    if (owned !== null) {
      panel.add(new Label({ id: "shop.owned", x, y: INSET + 44 + LINE, width, height: LINE, text: owned === 0 ? "Not in your collection yet" : `You own ${owned}`, size: "small", align: "left", colorKey: "textMuted" }));
    }
    this.#buildPriceLegend(panel, { x, y: INSET + 44 + 2 * LINE + 16, width }, offer.rarity);
    return this.#buildPurchase(panel, offer.product);
  }

  /**
   * What a single costs, by rarity (the server's price list).
   * @param {Panel} panel
   * @param {{ x: number, y: number, width: number }} area
   * @param {string | null} current the rarity of the card shown
   */
  #buildPriceLegend(panel, { x, y, width }, current) {
    const priceList = this.#shop().state.listing?.priceList;
    if (priceList === undefined) {
      return;
    }
    const column = SINGLE.legendColumn;
    /** @type {readonly { width: number, align: CanvasTextAlign }[]} */
    const columns = [
      { width: width - column, align: "left" },
      { width: column, align: "right" },
    ];
    panel.add(new Label({ x, y, width, height: LINE, text: `Single prices (${priceList.asset})`, size: "small", weight: "bold", align: "left", colorKey: "accentLight" }));
    /** @type {{ text: string, colorKey: string, weight: "normal" | "bold" }[][]} */
    const rows = [
      ["Rarity", "Price"].map((text) => ({ text, colorKey: "textMuted", weight: /** @type {const} */ ("normal") })),
      ...priceList.singles.map((price) => {
        /** @type {"normal" | "bold"} */
        const weight = price.rarity === current ? "bold" : "normal";
        return [
          { text: price.rarity, colorKey: rarityColor(price.rarity), weight },
          { text: price.price, colorKey: "text", weight },
        ];
      }),
    ];
    rows.forEach((cells, row) => {
      let cellX = x;
      cells.forEach((cell, index) => {
        const { width: cellWidth, align } = columns[index];
        panel.add(new Label({ x: cellX, y: y + (row + 1) * LINE, width: cellWidth, height: LINE, text: cell.text, size: "small", align, colorKey: cell.colorKey, weight: cell.weight }));
        cellX += cellWidth;
      });
    });
  }

  /**
   * Quantity, Buy and the purchase's progress, at the bottom of the detail panel.
   * @param {Panel} panel
   * @param {Product} product
   * @returns {Button} the Buy button
   */
  #buildPurchase(panel, product) {
    const shop = this.#shop();
    const { purchase } = shop.state;
    const quantityY = PURCHASE_TOP;
    panel.add(new Button({ id: "shop.less", x: INSET, y: quantityY, width: ACTION.small, height: QUANTITY.height, text: "−", enabled: this.#quantity > 1, onActivate: () => this.#changeQuantity(-1, product) }));
    panel.add(new Label({ id: "shop.quantity", x: INSET + ACTION.small, y: quantityY, width: QUANTITY.width, height: QUANTITY.height, text: String(this.#quantity), size: "heading", weight: "bold" }));
    panel.add(new Button({ id: "shop.more", x: INSET + ACTION.small + QUANTITY.width, y: quantityY, width: ACTION.small, height: QUANTITY.height, text: "+", enabled: this.#quantity < product.perOrder, onActivate: () => this.#changeQuantity(1, product) }));
    const each = this.#quantity > 1 ? `${this.#quantity} × ${priceText(product)}` : `Up to ${product.perOrder} per order`;
    panel.add(new Label({ id: "shop.each", x: INSET + 2 * ACTION.small + QUANTITY.width + INSET, y: quantityY, width: DETAIL_WIDTH - 2 * ACTION.small - QUANTITY.width - INSET, height: QUANTITY.height, text: each, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    const price = priceOf(product);
    const buyY = quantityY + QUANTITY.height + INSET;
    const buy = panel.add(
      new Button({
        id: "shop.buy",
        x: INSET,
        y: buyY,
        width: BUY.width,
        height: BUY.height,
        text: `Buy for ${multiplyAmount(price.amount, this.#quantity)} ${price.asset}`,
        variant: "primary",
        enabled: this.#canBuy(),
        onActivate: () => {
          this.#notice = null;
          shop.buy({ productId: product.id, quantity: this.#quantity, asset: price.asset });
        },
      }),
    );
    const status = this.#statusLine(purchase);
    panel.add(new TextBlock({ id: "shop.status", x: INSET, y: buyY + BUY.height + 8, width: DETAIL_WIDTH, height: 2 * LINE, text: status.text, size: "small", colorKey: status.colorKey }));
    const x = INSET + BUY.width + INSET;
    const side = COLUMNS.right.width - x - INSET;
    if (purchase.stage === PurchaseStage.FAILED && purchase.order?.payment) {
      const half = (side - ACTION.gap) / 2;
      panel.add(new Button({ id: "shop.payAgain", x, y: buyY, width: half, height: BUY.height, text: "Pay again", onActivate: () => shop.payAgain() }));
      panel.add(new Button({ id: "shop.cancel", x: x + half + ACTION.gap, y: buyY, width: half, height: BUY.height, text: "Cancel order", variant: "danger", textSize: "small", onActivate: () => shop.cancel() }));
    } else {
      panel.add(new Button({ id: "shop.addToCart", x, y: buyY, width: side, height: BUY.height, text: "Add to cart", enabled: shop.state.status === ShopStatus.READY, onActivate: () => this.#addToCart(product) }));
    }
    return buy;
  }

  #canBuy() {
    const shop = this.#shop();
    const busy = BUSY_STAGES.includes(shop.state.purchase.stage);
    return shop.state.status === ShopStatus.READY && (this.#app.account?.state.account ?? null) !== null && !busy;
  }

  /**
   * @param {import("../../application/shop/ShopService.js").Purchase} purchase
   * @returns {{ text: string, colorKey: string }}
   */
  #statusLine(purchase) {
    if (purchase.error !== null) {
      return { text: purchase.error.message, colorKey: purchase.stage === PurchaseStage.FAILED ? "danger" : "accent" };
    }
    const text = STAGE_TEXT[/** @type {keyof typeof STAGE_TEXT} */ (purchase.stage)];
    if (text !== undefined) {
      return { text: text(purchase), colorKey: purchase.stage === PurchaseStage.DONE ? "success" : "accent" };
    }
    if (this.#notice !== null) {
      return this.#notice;
    }
    return (this.#app.account?.state.account ?? null) === null ? { text: "Sign in to buy.", colorKey: "textMuted" } : { text: "Keychain will show the exact transfer before anything is paid.", colorKey: "textMuted" };
  }

  /**
   * What a pack or an offer contains.
   * @param {Product} product
   */
  #contentLines(product) {
    const { content } = this.#app;
    const listing = this.#shop().state.listing;
    /** @type {Record<string, (item: import("../../application/ports/MarketApi.contract.js").ProductContent) => string>} */
    const describe = {
      card: (item) => content.catalog.get(item.ref)?.name ?? item.ref,
      pack: (item) => `pack of ${listing?.dropTables.find((table) => table.id === item.ref)?.size ?? 0} unknown cards, drawn when your payment is final`,
      deck: (item) => {
        const deck = content.preconDecks.find((candidate) => candidate.id === item.ref);
        return `complete deck: ${deck?.name ?? item.ref} (${deck?.totalCards ?? "?"} cards), saved to your account`;
      },
      product: (item) => listing?.products.find((candidate) => candidate.id === item.ref)?.name ?? item.ref,
    };
    return product.contents.map((item) => ({ text: `${item.count} × ${(describe[item.type] ?? (() => item.ref))(item)}`, colorKey: "text" }));
  }

  /**
   * Pack odds, as the server publishes them (products may nest packs in bundles).
   * @param {Product} product
   */
  #oddsLines(product) {
    const listing = this.#shop().state.listing;
    const tableIds = new Set(packTablesOf(product, listing?.products ?? []));
    return [...tableIds].flatMap((tableId) => {
      const table = listing?.dropTables.find((candidate) => candidate.id === tableId);
      if (table === undefined) {
        return [];
      }
      const slots = table.slots.map((slot, index) => {
        const odds = Object.entries(slot.odds)
          .sort(([left], [right]) => (listing?.rarities.indexOf(left) ?? 0) - (listing?.rarities.indexOf(right) ?? 0))
          .map(([rarity, chance]) => `${rarity} ${percent(chance)}`)
          .join(" · ");
        return { text: `Slot ${index + 1} (${cardsText(slot.count)}): ${odds}`, colorKey: "textMuted" };
      });
      return [{ text: "Pack odds", colorKey: "accentLight" }, ...slots, { text: "Packs are provably fair: see /api/pack-epochs.", colorKey: "textMuted" }];
    });
  }

  /** @returns {import("../ui/UiNode.js").UiNode | null} the node to focus in the reveal */
  #openRevealIfDone() {
    const { purchase } = this.#shop().state;
    const fulfilment = purchase.order?.fulfilment;
    if (purchase.stage !== PurchaseStage.DONE) {
      // The fulfilled order is behind us (closing the reveal dismisses it): the next purchase reveals its own cards.
      this.#revealClosed = false;
      return null;
    }
    if (fulfilment === null || fulfilment === undefined || this.#revealClosed) {
      return null;
    }
    const { viewport } = this.services;
    const close = () => {
      this.#revealClosed = true;
      this.#shop().dismiss();
    };
    const modal = new Modal({ id: "reveal", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: REVEAL.width, panelHeight: REVEAL.height, onDismiss: close });
    const { panel } = modal;
    const width = REVEAL.width - 2 * INSET;
    const total = fulfilment.cards.length + fulfilment.packs.reduce((sum, pack) => sum + pack.cards.length, 0);
    panel.add(new Label({ x: INSET, y: INSET, width, height: 44, text: `You received ${cardsText(total)}`, size: "heading", weight: "bold", colorKey: "accentLight", glow: true }));
    this.#buildRevealList(panel.add(new ScrollList({ id: "reveal.cards", x: INSET, y: 80, width, height: REVEAL.height - 80 - 2 * INSET - 56 })), fulfilment);
    const buttonWidth = (width - ACTION.gap) / 2;
    const buttonsY = REVEAL.height - INSET - 56;
    const view = panel.add(
      new Button({
        id: "reveal.collection",
        x: INSET,
        y: buttonsY,
        width: buttonWidth,
        height: 56,
        text: "View collection",
        variant: "primary",
        enabled: this.services.hasScene(SceneId.COLLECTION),
        onActivate: () => {
          close();
          this.services.navigate(SceneId.COLLECTION);
        },
      }),
    );
    panel.add(new Button({ id: "reveal.close", x: INSET + buttonWidth + ACTION.gap, y: buttonsY, width: buttonWidth, height: 56, text: "Keep shopping", onActivate: close }));
    this.openModal(modal);
    return view;
  }

  /**
   * The cart, when it is open: each line with its quantity, amount and
   * Remove; the total; Empty cart, Keep shopping and Pay.
   * @param {string} focusedId the node focused before the rebuild, kept when it is in the cart
   * @param {number} scrollY where the list of lines was scrolled
   * @returns {import("../ui/UiNode.js").UiNode | null} the node to focus in the cart
   */
  #openCartIfShown(focusedId, scrollY) {
    if (!this.#cartShown) {
      return null;
    }
    const shop = this.#shop();
    const summary = cartSummary(shop.state.cart, shop.state.listing?.products ?? []);
    const { viewport } = this.services;
    const modal = new Modal({ id: "cart", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: CART.width, panelHeight: CART.height, onDismiss: () => this.#showCart(false) });
    const { panel } = modal;
    const width = CART.width - 2 * INSET;
    panel.add(new Label({ x: INSET, y: INSET, width: width / 2, height: 44, text: "Your cart", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    panel.add(new Label({ id: "cart.count", x: INSET + width / 2, y: INSET, width: width / 2, height: 44, text: cartCountText(summary), size: "small", align: "right", colorKey: "textMuted" }));
    const footerY = CART.height - INSET - CART.footer;
    const totalY = footerY - INSET - 2 * LINE;
    this.#buildCartLines(panel.add(new ScrollList({ id: CART_LIST_ID, x: INSET, y: INSET + 60, width, height: totalY - INSET - 60 - INSET })), summary, scrollY);
    panel.add(new Label({ id: "cart.total", x: INSET, y: totalY, width, height: LINE, text: summary.asset === null ? "" : `Total: ${summary.total} ${summary.asset}`, size: "body", weight: "bold", align: "right", colorKey: "accentLight" }));
    const hint = this.#cartHint(summary);
    panel.add(new Label({ id: "cart.status", x: INSET, y: totalY + LINE, width, height: LINE, text: hint.text, size: "small", align: "right", colorKey: hint.colorKey, fit: true }));
    const buttons = this.#buildCartButtons(panel, summary, footerY);
    this.openModal(modal);
    const kept = modal.findById(focusedId);
    return [kept, ...buttons].find((node) => node?.isEffectivelyEnabled) ?? null;
  }

  /**
   * The cart's tiles, three to a row, or what to do when it is empty.
   * @param {ScrollList} list
   * @param {import("../../application/shop/shopCatalog.js").CartSummary} summary
   * @param {number} scrollY
   */
  #buildCartLines(list, summary, scrollY) {
    if (summary.lines.length === 0) {
      list.add(new TextBlock({ id: "cart.empty", x: 0, y: 0, width: list.rowWidth, height: 2 * LINE, text: "Your cart is empty. Choose packs, decks or cards on any shelf and press Add to cart: you pay for all of them at once.", size: "body", colorKey: "textMuted" }));
      list.contentHeight = 2 * LINE;
      return;
    }
    const width = Math.floor((list.rowWidth - (CART.perRow - 1) * CART.gap) / CART.perRow);
    summary.lines.forEach((line, index) => {
      const column = index % CART.perRow;
      const row = Math.floor(index / CART.perRow);
      this.#buildCartTile(list, line, { x: column * (width + CART.gap), y: row * (CART.tile + CART.gap), width });
    });
    const rows = Math.ceil(summary.lines.length / CART.perRow);
    list.contentHeight = rows * (CART.tile + CART.gap) - CART.gap;
    list.scrollTo(scrollY);
  }

  /**
   * One product in the cart: its cards fanned out with the quantity, ✕ to
   * remove it; its name, price each, − quantity + and its amount.
   * @param {ScrollList} list
   * @param {import("../../application/shop/shopCatalog.js").CartSummaryLine} line
   * @param {{ x: number, y: number, width: number }} tile
   */
  #buildCartTile(list, line, { x, y, width }) {
    const shop = this.#shop();
    const { productId, quantity, product } = line;
    const inner = width - 2 * 10;
    list.add(new Panel({ id: `cart.line.${productId}`, x, y, width, height: CART.tile }));
    list.add(new CardFan({ id: `cart.visual.${productId}`, x: x + 10, y: y + 10, width: inner, height: CART.fan, ...this.#fanOf(product, productId), badge: `×${quantity}` }));
    list.add(new Button({ id: `cart.remove.${productId}`, x: x + width - 8 - CART.remove, y: y + 8, width: CART.remove, height: CART.remove, text: "×", variant: "danger", onActivate: () => shop.removeFromCart(productId) }));
    list.add(new Label({ id: `cart.name.${productId}`, x: x + 10, y: y + CART.fan + 16, width: inner, height: 26, text: product?.name ?? productId, weight: "bold", colorKey: product === null ? "danger" : "text", fit: true }));
    const each = product === null ? "No longer on sale: remove it" : `${priceText(product)} each · ${cardsText(product.cards)}`;
    list.add(new Label({ x: x + 10, y: y + CART.fan + 42, width: inner, height: 22, text: each, size: "small", colorKey: product === null ? "danger" : "textMuted", fit: true }));
    const controlsY = y + CART.tile - 12 - CART.step.height;
    const step = { width: CART.step.width, height: CART.step.height };
    const limit = product?.perOrder ?? quantity;
    list.add(new Button({ id: `cart.less.${productId}`, x: x + 10, y: controlsY, ...step, text: "−", enabled: quantity > 1, onActivate: () => shop.setCartQuantity(productId, quantity - 1) }));
    list.add(new Label({ id: `cart.quantity.${productId}`, x: x + 10 + step.width, y: controlsY, ...step, text: String(quantity), weight: "bold" }));
    list.add(new Button({ id: `cart.more.${productId}`, x: x + 10 + 2 * step.width, y: controlsY, ...step, text: "+", enabled: quantity < limit, onActivate: () => shop.setCartQuantity(productId, quantity + 1) }));
    const amountX = x + 10 + 3 * step.width + 8;
    const amount = line.amount === null ? "—" : `${line.amount} ${priceOf(/** @type {Product} */ (product)).asset}`;
    list.add(new Label({ id: `cart.amount.${productId}`, x: amountX, y: controlsY, width: x + width - 10 - amountX, height: step.height, text: amount, weight: "bold", align: "right", colorKey: "accentLight", fit: true }));
  }

  /**
   * What a product's tile shows: the card of a single, the rarest cards of a
   * deck or of an offer, card backs for packs (unknown until opened).
   * @param {Product | null} product
   * @param {string} productId
   * @returns {{ cards: import("../cards/CardFan.js").FanCard[], backs: number }}
   */
  #fanOf(product, productId) {
    if (product === null) {
      return { cards: [{ card: { ...unknownCard(productId), text: "" }, rarity: null }], backs: 0 };
    }
    const cardIds = product.contents.flatMap((item) => {
      if (item.type === "card") {
        return [item.ref];
      }
      const deck = item.type === "deck" ? this.#app.content.preconDecks.find((candidate) => candidate.id === item.ref) : undefined;
      return deck?.entries.map((entry) => entry.cardId) ?? [];
    });
    const rarities = this.#shop().state.listing?.rarities ?? [];
    const rank = (cardId) => rarities.indexOf(rarityOf(this.#app, cardId) ?? "");
    const cards = [...new Set(cardIds)]
      .sort((left, right) => rank(right) - rank(left))
      .slice(0, 3)
      .reverse()
      .map((cardId) => ({ card: this.#app.content.catalog.get(cardId) ?? { ...unknownCard(cardId), text: "" }, rarity: rarityOf(this.#app, cardId) }));
    return { cards, backs: cards.length === 0 ? 3 : 0 };
  }

  /**
   * Empty cart, Keep shopping and Pay.
   * @param {Panel} panel
   * @param {import("../../application/shop/shopCatalog.js").CartSummary} summary
   * @param {number} y
   * @returns {Button[]} the buttons to focus first, in order of preference
   */
  #buildCartButtons(panel, summary, y) {
    const shop = this.#shop();
    const third = (CART.width - 2 * INSET - 2 * ACTION.gap) / 3;
    const clear = panel.add(new Button({ id: "cart.clear", x: INSET, y, width: third, height: CART.footer, text: "Empty cart", variant: "danger", enabled: summary.lines.length > 0, onActivate: () => shop.clearCart() }));
    const keep = panel.add(new Button({ id: "cart.close", x: INSET + third + ACTION.gap, y, width: third, height: CART.footer, text: "Keep shopping", onActivate: () => this.#showCart(false) }));
    const pay = panel.add(
      new Button({
        id: "cart.pay",
        x: INSET + 2 * (third + ACTION.gap),
        y,
        width: third,
        height: CART.footer,
        text: summary.payable ? `Pay ${summary.total} ${summary.asset}` : "Pay",
        variant: "primary",
        enabled: summary.payable && this.#canBuy(),
        onActivate: () => this.#checkout(/** @type {string} */ (summary.asset)),
      }),
    );
    return [pay, clear, keep];
  }

  /**
   * What stands between the cart and paying, if anything.
   * @param {import("../../application/shop/shopCatalog.js").CartSummary} summary
   * @returns {{ text: string, colorKey: string }}
   */
  #cartHint(summary) {
    const shop = this.#shop();
    if (summary.lines.length === 0) {
      return { text: "", colorKey: "textMuted" };
    }
    if (!summary.payable) {
      return { text: summary.lines.some((line) => line.product === null) ? "Remove what is no longer on sale to pay." : "These products cannot be paid in one asset: buy them separately.", colorKey: "danger" };
    }
    if ((this.#app.account?.state.account ?? null) === null) {
      return { text: "Sign in to pay.", colorKey: "textMuted" };
    }
    if (BUSY_STAGES.includes(shop.state.purchase.stage)) {
      return { text: "A purchase is in progress: pay for the cart when it is over.", colorKey: "accent" };
    }
    return { text: "One payment for everything: Keychain shows the exact transfer before anything is paid.", colorKey: "textMuted" };
  }

  /** @param {boolean} shown */
  #showCart(shown) {
    this.#cartShown = shown;
    this.#rebuild();
  }

  /**
   * Pays for the cart; the purchase's progress shows under Buy, the cards in the reveal.
   * @param {string} asset
   */
  #checkout(asset) {
    this.#cartShown = false;
    this.#notice = null;
    this.#shop().checkout(asset);
  }

  /**
   * Adds the chosen quantity of a product to the cart, and says so.
   * @param {Product} product
   */
  #addToCart(product) {
    const added = this.#shop().addToCart(product.id, this.#quantity);
    this.#notice = added.ok ? { text: `Added ${this.#quantity} × ${product.name} to your cart.`, colorKey: "success" } : { text: added.error.message, colorKey: "danger" };
    this.#quantity = 1;
    this.#rebuild();
  }

  /**
   * The cards received, the order's own first, then pack by pack.
   * @param {ScrollList} list
   * @param {import("../../application/ports/MarketApi.contract.js").Fulfilment} fulfilment
   */
  #buildRevealList(list, fulfilment) {
    let y = 0;
    const groups = [...(fulfilment.cards.length > 0 ? [{ title: null, cards: fulfilment.cards }] : []), ...fulfilment.packs.map((pack) => ({ title: `Pack ${pack.index + 1}`, cards: pack.cards }))];
    for (const group of groups) {
      if (group.title !== null) {
        list.add(new Label({ x: 0, y, width: list.rowWidth, height: 30, text: group.title, size: "small", weight: "bold", align: "left", colorKey: "accent" }));
        y += 30;
      }
      for (const card of group.cards) {
        const definition = this.#app.content.catalog.get(card.definitionId);
        list.add(new CardStrip({ x: 0, y, width: list.rowWidth - 220, height: REVEAL.row, card: definition ?? unknownCard(card.definitionId), broken: definition === undefined, rarity: rarityOf(this.#app, card.definitionId) }));
        list.add(new Label({ x: list.rowWidth - 210, y, width: 210, height: REVEAL.row, text: `#${card.serial}`, size: "small", align: "left", colorKey: "textMuted" }));
        y += REVEAL.row + REVEAL.gap;
      }
      y += REVEAL.packGap;
    }
    list.contentHeight = y;
  }

  /**
   * Keys of the current shelf's entries, in list order.
   * @param {Shelves} shelves
   * @returns {string[]}
   */
  #entryKeys(shelves) {
    if (this.#category === ShopCategory.SINGLES) {
      return this.#visibleSingles(shelves).map((offer) => offer.cardId);
    }
    return shelves[/** @type {"packs" | "decks" | "offers"} */ (this.#category)].map((product) => product.id);
  }

  /** @param {Shelves} shelves */
  #visibleSingles(shelves) {
    return shelves.singles.filter((offer) => matchesCardFilter(this.#filter, this.#app.content.catalog.get(offer.cardId), offer.rarity ?? rarityOf(this.#app, offer.cardId)));
  }

  /**
   * The preconstructed deck a product sells, if it sells exactly one.
   * @param {Product} product
   */
  #deckOf(product) {
    const [only] = product.contents;
    return product.contents.length === 1 && only.type === "deck" ? this.#app.content.preconDecks.find((deck) => deck.id === only.ref) : undefined;
  }

  /**
   * Copies of a card the signed-in player owns; null when signed out.
   * @param {string} cardId
   */
  #ownedCopies(cardId) {
    const account = this.#app.account;
    if (account === undefined || account.state.account === null) {
      return null;
    }
    return account.collection.state.cards.find((entry) => entry.definitionId === cardId)?.copies.length ?? 0;
  }

  /** @param {string} category */
  #show(category) {
    this.#category = category;
    this.#resetChoice();
    this.#scrollToTop = true;
    this.#rebuild();
  }

  /** @param {import("../../application/content/CardFilter.js").CardFilter} filter */
  #changeFilter(filter) {
    this.#filter = filter;
    this.#scrollToTop = true;
    this.#rebuild();
  }

  /** @param {string} key a product id, or a card id among singles */
  #select(key) {
    this.#selected[this.#category] = key;
    this.#resetChoice();
    this.#rebuild();
  }

  #resetChoice() {
    this.#quantity = 1;
    this.#notice = null;
  }

  /**
   * @param {number} delta
   * @param {Product} product
   */
  #changeQuantity(delta, product) {
    this.#quantity = Math.min(product.perOrder, Math.max(1, this.#quantity + delta));
    this.#rebuild();
  }

  #shop() {
    if (this.#app.shop === undefined) {
      throw new Error("ShopScene needs a shop service");
    }
    return this.#app.shop;
  }
}

/**
 * "3 items · 11 cards", or nothing for an empty cart.
 * @param {import("../../application/shop/shopCatalog.js").CartSummary} summary
 */
function cartCountText({ lines, quantity, cards }) {
  if (lines.length === 0) {
    return "";
  }
  return `${quantity} item${quantity === 1 ? "" : "s"} · ${cardsText(cards)}`;
}

/**
 * Drop tables a product's packs come from, following bundles.
 * @param {Product} product
 * @param {readonly Product[]} products
 * @param {number} [depth]
 * @returns {string[]}
 */
function packTablesOf(product, products, depth = 0) {
  if (depth > 4) {
    return [];
  }
  return product.contents.flatMap((item) => {
    if (item.type === "pack") {
      return [item.ref];
    }
    const nested = item.type === "product" ? products.find((candidate) => candidate.id === item.ref) : undefined;
    return nested === undefined ? [] : packTablesOf(nested, products, depth + 1);
  });
}

/** @param {{ numerator: number, denominator: number }} chance */
function percent({ numerator, denominator }) {
  const value = (100 * numerator) / denominator;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
