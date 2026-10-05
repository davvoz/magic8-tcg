/**
 * The shop, in three shelves chosen with tabs on the left:
 *
 *   Packs    boosters of cards you do not know in advance, at a fixed price
 *   Decks    complete preconstructed decks, priced at the sum of their cards
 *   Singles  every card, priced by its rarity; filterable by faction,
 *            rarity and type
 *
 * (plus Ranked, the entries ranked games take, and Offers, only when the
 * server sells them). On the right,
 * the selected item: a pack's odds, a deck's card-by-card price, a card at
 * full size with the price list by rarity; then the
 * quantity, Buy and Add to cart. The cart (header) lists what was added from
 * any shelf, lets the player change or remove it, and pays for all of it
 * with one transfer. Paying goes through the wallet (Keychain shows the
 * exact transfer); when the order is fulfilled the cards received are
 * revealed, pack by pack, to a rising chime (and a sweep of light when a
 * card of one of the top rarities is among them). Every price shown is the server's. The header
 * shows the player's budget, what their wallet holds in STEEM: what it
 * cannot pay for is not offered for payment.
 *
 * On a compact screen (a phone in landscape) the same two columns are
 * tighter: the card filter is one button, a single's card is small (tap it
 * to read it), the purchase controls are two rows under the status line,
 * and the cart and the reveal fill the screen.
 */
import { SoundCue } from "../../application/audio/SoundCue.js";
import { ANY, NO_CARD_FILTER, cardFilterOptions, describeCardFilter, isFiltering, matchesCardFilter } from "../../application/content/CardFilter.js";
import { BUSY_STAGES, OrdersStatus, PurchaseStage, ShopStatus } from "../../application/shop/ShopService.js";
import { deckMix } from "../../application/decks/deckMix.js";
import { ShopCategory, cartSummary, deckBreakdown, multiplyAmount, priceOf, shelvesOf } from "../../application/shop/shopCatalog.js";
import { RANKED_ENTRY } from "../../application/ports/EntriesApi.contract.js";
import { rankedEntriesText } from "../../application/entries/EntryService.js";
import { mixBands, mixText } from "../cards/deckStripe.js";
import { CARD_FILTER_BAR_HEIGHT, CARD_FILTER_BUTTON_HEIGHT, buildCardFilterBar, buildCardFilterButton } from "../cards/cardFilterBar.js";
import { CardDetail } from "../cards/CardDetail.js";
import { CardFan } from "../cards/CardFan.js";
import { CardStrip } from "../cards/CardStrip.js";
import { CardThumb } from "../cards/CardThumb.js";
import { buildCardInfoModal, rarityOf } from "../cards/cardInfo.js";
import { rarityColorKey, rarityLabel } from "../theme/rarity.js";
import { unknownCard } from "../cards/unknownCard.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Hotspot } from "../ui/Hotspot.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { ActiveKeyDialog } from "./ActiveKeyDialog.js";
import { SceneId } from "./sceneIds.js";
import { approveTransferText, transferPreviewText } from "./walletText.js";

const LIST_ID = "shop.list";
/** A rare card received: which rarities count (the top ones), how long after the chime its sweep comes, and how loud it is for the very rarest (a step softer for each rarity below). */
const RARE_REVEAL = Object.freeze({ topRarities: 3, delayMs: 650, gain: 1.15, step: 0.2 });
/**
 * Every size of the shop, wide and compact.
 * @typedef {Readonly<{
 *   line: number, tabs: { top: number, height: number, gap: number }, filterTop: number, listTop: { plain: number, filtered: number }, filterButton: boolean,
 *   priceWidth: number, quantity: { height: number, width: number }, buy: { height: number, width: number }, rowGap: number, compactPurchase: boolean,
 *   single: { card: { width: number, height: number }, legendColumn: number, legend: boolean, nameHeight: number },
 *   deckThumb: { width: number, gap: number, rarity: number }, top: { title: number, titleHeight: number, description: number, content: number }, descriptionLines: number,
 *   reveal: { width: number, height: number, row: number, gap: number, packGap: number, title: number, button: number, serial: number },
 *   cart: { width: number, height: number, footer: number, perRow: number, gap: number, tile: number, fan: number, step: { width: number, height: number }, remove: number, title: number },
 *   orders: { width: number, height: number, footer: number, row: number, gap: number, button: number, title: number },
 * }>} ShopMetrics `compactPurchase`: the status line on top, then quantity, then Buy beside Add to cart;
 *   cart `step`: the − and + buttons (wide enough for their sign past the button's padding); `0` sizes in `reveal`/`cart` mean "as large as the screen allows"
 */
/** @type {ShopMetrics} */
const WIDE = Object.freeze({
  line: 28,
  tabs: Object.freeze({ top: 20, height: 40, gap: 8 }),
  filterTop: 72,
  listTop: Object.freeze({ plain: 76, filtered: 72 + CARD_FILTER_BAR_HEIGHT + 12 }),
  filterButton: false,
  priceWidth: 170,
  quantity: Object.freeze({ height: 52, width: 80 }),
  buy: Object.freeze({ height: 60, width: 420 }),
  rowGap: 0,
  compactPurchase: false,
  single: Object.freeze({ card: Object.freeze({ width: 300, height: 442 }), legendColumn: 120, legend: true, nameHeight: 40 }),
  /** A deck's cards as thumbnails: the card, "copies × price each", its rarity. */
  deckThumb: Object.freeze({ width: 84, gap: 12, rarity: 20 }),
  top: Object.freeze({ title: 14, titleHeight: 40, description: 62, content: 150 }),
  descriptionLines: 3,
  reveal: Object.freeze({ width: 1100, height: 780, row: 44, gap: 6, packGap: 16, title: 80, button: 56, serial: 210 }),
  /** The cart: a grid of tiles, each the product's cards over its name, price and quantity. */
  cart: Object.freeze({ width: 1100, height: 860, footer: 56, perRow: 3, gap: 16, tile: 300, fan: 170, step: Object.freeze({ width: 56, height: 44 }), remove: 48, title: 60 }),
  /** The unpaid orders: one row each, what it holds and how long is left to pay, with Pay and Cancel. */
  orders: Object.freeze({ width: 1000, height: 700, footer: 56, row: 96, gap: 10, button: 150, title: 60 }),
});
/** @type {ShopMetrics} */
const COMPACT = Object.freeze({
  line: 22,
  tabs: Object.freeze({ top: 12, height: 46, gap: 6 }),
  filterTop: 66,
  listTop: Object.freeze({ plain: 68, filtered: 66 + CARD_FILTER_BUTTON_HEIGHT + 10 }),
  filterButton: true,
  priceWidth: 124,
  quantity: Object.freeze({ height: 46, width: 52 }),
  buy: Object.freeze({ height: 46, width: 0 }),
  rowGap: 6,
  compactPurchase: true,
  single: Object.freeze({ card: Object.freeze({ width: 112, height: 157 }), legendColumn: 0, legend: false, nameHeight: 34 }),
  deckThumb: Object.freeze({ width: 56, gap: 8, rarity: 16 }),
  top: Object.freeze({ title: 8, titleHeight: 34, description: 42, content: 88 }),
  descriptionLines: 2,
  reveal: Object.freeze({ width: 0, height: 0, row: 44, gap: 6, packGap: 12, title: 56, button: 46, serial: 90 }),
  cart: Object.freeze({ width: 0, height: 0, footer: 46, perRow: 3, gap: 10, tile: 196, fan: 84, step: Object.freeze({ width: 48, height: 40 }), remove: 40, title: 50 }),
  orders: Object.freeze({ width: 0, height: 0, footer: 46, row: 84, gap: 8, button: 104, title: 50 }),
});
/** How far a compact dialog (the cart, the reveal) keeps from the screen's edges. */
const COMPACT_DIALOG_MARGIN = 8;
const CART_LIST_ID = "cart.lines";
const ORDERS_LIST_ID = "orders.list";
const MINUTE = 60_000;
/** An unpaid order is offered for payment only while this much of its time is left: a transfer the chain sees after the deadline is refunded, not fulfilled. */
const PAY_MARGIN_MS = 2 * MINUTE;

const TAB_TITLES = Object.freeze({ [ShopCategory.PACKS]: "Packs", [ShopCategory.DECKS]: "Decks", [ShopCategory.SINGLES]: "Singles", [ShopCategory.RANKED]: "Ranked", [ShopCategory.OFFERS]: "Offers" });
/** Shelves shown only while something is on them. */
/** @type {readonly string[]} */
const OPTIONAL_SHELVES = Object.freeze([ShopCategory.RANKED, ShopCategory.OFFERS]);
/** Rarities drawn in theme colours, commonest to rarest. */
const EMPTY_SHELVES = shelvesOf({ products: [], dropTables: [], rarities: [], priceList: { asset: "", singles: [] } });

/** What the player sees at each step of a purchase. */
const STAGE_TEXT = Object.freeze({
  [PurchaseStage.ORDERING]: () => "Creating your order…",
  [PurchaseStage.SIGNING]: (purchase, app) => `${approveTransferText(app)}: ${purchase.order.payment.amount} ${purchase.order.payment.asset} to @${purchase.order.payment.to}.`,
  [PurchaseStage.CONFIRMING]: () => "Payment sent. The STEEM blockchain makes it final in about a minute: keep playing, you will be notified when your cards arrive.",
  [PurchaseStage.DONE]: (purchase) => doneText(purchase.order?.fulfilment ?? null),
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

/**
 * An unpaid order's amount, age and time left to pay, and whether it may
 * still be paid (PAY_MARGIN_MS before its deadline).
 * @param {import("../../application/ports/MarketApi.contract.js").Order} order
 * @param {number} now
 */
function describeUnpaid(order, now) {
  const left = (order.payment?.expiresAt ?? 0) - now;
  const payable = left > PAY_MARGIN_MS;
  const age = Math.max(0, Math.floor((now - order.createdAt) / MINUTE));
  const ordered = age < 1 ? "just now" : `${age} min ago`;
  const when = payable ? `${Math.ceil(left / MINUTE)} min left to pay` : "time to pay is over: it closes on its own";
  return { detail: `${order.total.amount} ${order.total.asset} · ordered ${ordered} · ${when}`, payable };
}

export class ShopScene extends Scene {
  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return screenLayout(this.services.viewport);
  }

  /** @returns {ShopMetrics} */
  get #m() {
    return this.#screen.compact ? COMPACT : WIDE;
  }

  /** The width of the detail panel's content. */
  get #detailWidth() {
    const screen = this.#screen;
    return screen.columns.right.width - 2 * screen.inset;
  }

  /** Where the purchase controls start in the detail panel; everything else fits above. */
  get #purchaseTop() {
    const { columns, inset } = this.#screen;
    const { line, buy, quantity, rowGap, compactPurchase } = this.#m;
    if (compactPurchase) {
      return columns.height - inset - buy.height - rowGap - quantity.height - rowGap - 2 * line;
    }
    return columns.height - inset - 2 * line - 8 - buy.height - inset - quantity.height;
  }

  /**
   * A dialog's size: the metrics' own, or (compact) the screen's less a margin.
   * @param {{ width: number, height: number }} size
   */
  #dialogSize({ width, height }) {
    const { viewport } = this.services;
    return { width: width || viewport.logicalWidth - 2 * COMPACT_DIALOG_MARGIN, height: height || viewport.logicalHeight - 2 * COMPACT_DIALOG_MARGIN };
  }

  #app;
  #now;
  /** The active key a payment with the player's own keys needs, asked for over the shop. @type {ActiveKeyDialog | null} */
  #activeKey = null;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** The shelf shown (a ShopCategory). @type {string} */
  #category = ShopCategory.PACKS;
  /** Singles shown. @type {import("../../application/content/CardFilter.js").CardFilter} */
  #filter = NO_CARD_FILTER;
  /** The selected entry of each shelf: a product id, or a card id among singles. @type {Record<string, string | null>} */
  #selected = { [ShopCategory.PACKS]: null, [ShopCategory.DECKS]: null, [ShopCategory.SINGLES]: null, [ShopCategory.RANKED]: null, [ShopCategory.OFFERS]: null };
  /** Where Back goes: the screen that opened the shop. @type {string} */
  #from = SceneId.MAIN_MENU;
  #quantity = 1;
  /** The list starts from the top on the next rebuild (another shelf or filter). */
  #scrollToTop = false;
  /** The reveal of the last fulfilled order was closed. */
  #revealClosed = false;
  /** The fulfilment whose reveal was last heard: a reveal reopened by a rebuild is not heard again. @type {unknown} */
  #heardFulfilment = null;
  /** The cart is open (it stays open across rebuilds, behind a reveal). */
  #cartShown = false;
  /** The unpaid orders are open. */
  #ordersShown = false;
  /** What the last Add to cart did, until the next choice. @type {{ text: string, colorKey: string } | null} */
  #notice = null;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {() => number} [now] the time, for how long an unpaid order has left
   */
  constructor(services, app, now = () => Date.now()) {
    super(services);
    this.#app = app;
    this.#now = now;
  }

  /** @param {{ category?: string, from?: string }} [params] `category`: the shelf to open (e.g. Ranked, from the lobby); `from`: where Back returns */
  enter(params = {}) {
    if (params.category !== undefined && /** @type {readonly string[]} */ (Object.values(ShopCategory)).includes(params.category)) {
      this.#category = params.category;
      this.#resetChoice();
    }
    this.#from = params.from ?? SceneId.MAIN_MENU;
    const shop = this.#shop();
    const unsubscribe = shop.subscribe(() => this.#rebuild());
    const unwatch = this.#app.balance?.subscribe(() => this.#rebuild());
    this.#unsubscribe = () => {
      unsubscribe();
      unwatch?.();
    };
    if (this.#signedIn()) {
      void this.#app.balance?.refresh();
      void shop.loadOrders();
    }
    this.#revealClosed = false;
    if (shop.state.status === ShopStatus.IDLE || shop.state.status === ShopStatus.FAILED) {
      shop.load();
    }
    this.#rebuild();
    this.#activeKey = this.#app.activeKeys === undefined ? null : new ActiveKeyDialog(this, this.#app.activeKeys);
    this.#activeKey?.start();
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#activeKey?.stop();
    this.#activeKey = null;
    super.exit();
  }

  onCancel() {
    if (this.modal !== null) {
      super.onCancel();
      return;
    }
    this.services.navigate(this.#from);
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    const { theme, viewport } = this.services;
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "shop" });
    super.render(context);
  }

  relayout() {
    this.#rebuild();
    this.#activeKey?.relayout();
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    const scrollY = this.#takeScroll();
    const cartScrollY = this.#dialogScroll(CART_LIST_ID);
    const ordersScrollY = this.#dialogScroll(ORDERS_LIST_ID);
    this.closeModal();
    this.root.clear();
    const shelves = this.#shelves();
    const back = this.#buildHeader();
    const listPanel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.left.x, y: this.#screen.columns.top, width: this.#screen.columns.left.width, height: this.#screen.columns.height }));
    const firstControl = this.#buildShelfControls(listPanel, shelves);
    const firstRow = this.#buildList(listPanel, shelves, scrollY);
    const buy = this.#buildDetail(shelves);
    const modalFocus = this.#openRevealIfDone() ?? this.#openCartIfShown(focusedId, cartScrollY) ?? this.#openOrdersIfShown(focusedId, ordersScrollY);
    this.focus(modalFocus ?? this.root.findById(focusedId) ?? buy ?? firstRow ?? firstControl ?? back);
    this.services.requestRender();
  }

  /**
   * Where a list in the open dialog was scrolled (0 when it is not open).
   * @param {string} id
   */
  #dialogScroll(id) {
    const list = this.modal?.findById(id);
    return list instanceof ScrollList ? list.scrollY : 0;
  }

  /** Where the list was scrolled, or the top after a change of shelf or filter. */
  #takeScroll() {
    const list = this.root.findById(LIST_ID);
    const scrollY = list instanceof ScrollList && !this.#scrollToTop ? list.scrollY : 0;
    this.#scrollToTop = false;
    return scrollY;
  }

  /** The listing's shelves; an optional shelf (Ranked, Offers) is left when it is empty, once the shop is loaded. */
  #shelves() {
    const listing = this.#shop().state.listing;
    const shelves = listing === null ? EMPTY_SHELVES : shelvesOf(listing);
    if (listing !== null && OPTIONAL_SHELVES.includes(this.#category) && productsOn(shelves, this.#category).length === 0) {
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
    const bar = { id: "shop.filter", x: this.#screen.inset, y: this.#m.filterTop, width: this.#screen.columns.left.width - 2 * this.#screen.inset, filter: this.#filter, options: shelfOptions, onChange: (/** @type {import("../../application/content/CardFilter.js").CardFilter} */ filter) => this.#changeFilter(filter) };
    if (this.#m.filterButton) {
      return buildCardFilterButton(panel, { ...bar, dialog: { viewport: this.services.viewport, open: (modal) => this.openModal(modal), close: () => this.closeModal() } });
    }
    return buildCardFilterBar(panel, bar);
  }

  /** @returns {Button} */
  #buildHeader() {
    const { viewport } = this.services;
    const account = this.#app.account?.state.account ?? null;
    const { header } = this.#screen;
    const title = this.#screen.compact ? 90 : 200;
    this.root.add(new Label({ x: header.sideMargin, y: header.y, width: title, height: header.height, text: "Shop", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const market = this.services.hasScene(SceneId.MARKET);
    const unpaid = this.#shop().state.orders.open.length;
    const cartSlot = market ? 3 : 2;
    const buttons = unpaid > 0 ? cartSlot + 1 : cartSlot;
    const noteX = header.sideMargin + title;
    const noteWidth = viewport.logicalWidth - 2 * header.sideMargin - title - buttons * (header.backWidth + 16);
    if (account === null) {
      this.root.add(new Label({ x: noteX, y: header.y, width: noteWidth, height: header.height, text: "Sign in to buy. Prices are paid in STEEM, straight from your wallet.", size: "small", align: "left", colorKey: "textMuted", fit: true }));
    } else {
      const budget = this.#budgetLine();
      this.root.add(new Label({ id: "shop.budget", x: noteX, y: header.y, width: noteWidth, height: header.height / 2, text: budget.text, weight: "bold", align: "left", colorKey: budget.colorKey, fit: true }));
      this.root.add(new Label({ x: noteX, y: header.y + header.height / 2, width: noteWidth, height: header.height / 2, text: `Buying as @${account}. Payments go straight from your wallet; nothing is stored in the game.`, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    }
    const inCart = this.#shop().state.cart.reduce((sum, line) => sum + line.quantity, 0);
    this.root.add(
      new Button({
        id: "shop.cart",
        keepPlate: true,
        x: viewport.logicalWidth - this.#screen.header.sideMargin - cartSlot * this.#screen.header.backWidth - (cartSlot - 1) * 16,
        y: this.#screen.header.y + 4,
        width: this.#screen.header.backWidth,
        height: this.#screen.header.height - 8,
        text: inCart === 0 ? "Cart" : `Cart (${inCart})`,
        variant: inCart === 0 ? "secondary" : "primary",
        onActivate: () => this.#showCart(true),
      }),
    );
    this.#buildOrdersButton(unpaid, buttons);
    if (market) {
      this.root.add(new Button({ keepPlate: true, id: "shop.market", x: viewport.logicalWidth - this.#screen.header.sideMargin - 2 * this.#screen.header.backWidth - 16, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: "Player market", onActivate: () => this.services.navigate(SceneId.MARKET, { from: SceneId.SHOP }) }));
    }
    return this.root.add(new Button({ keepPlate: true, id: "shop.back", x: viewport.logicalWidth - this.#screen.header.sideMargin - this.#screen.header.backWidth, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: this.#screen.backText, onActivate: () => this.services.navigate(this.#from) }));
  }

  /**
   * "Orders (n)", left of the other header buttons, while the player has unpaid orders.
   * @param {number} unpaid how many
   * @param {number} slot its place, counted from the right
   */
  #buildOrdersButton(unpaid, slot) {
    if (unpaid === 0) {
      return;
    }
    const { header } = this.#screen;
    const x = this.services.viewport.logicalWidth - header.sideMargin - slot * header.backWidth - (slot - 1) * 16;
    this.root.add(new Button({ id: "shop.orders", x, y: header.y + 4, width: header.backWidth, height: header.height - 8, text: `Orders (${unpaid})`, variant: "danger", keepPlate: true, onActivate: () => this.#showOrders(true) }));
  }

  /**
   * @param {Panel} panel
   * @param {Shelves} shelves
   * @returns {Button | null} the first tab
   */
  #buildTabs(panel, shelves) {
    const categories = [ShopCategory.PACKS, ShopCategory.DECKS, ShopCategory.SINGLES, ...OPTIONAL_SHELVES.filter((category) => productsOn(shelves, category).length > 0)];
    const inner = this.#screen.columns.left.width - 2 * this.#screen.inset;
    const TABS = this.#m.tabs;
    const width = (inner - (categories.length - 1) * TABS.gap) / categories.length;
    /** @type {Button | null} */
    let first = null;
    categories.forEach((category, index) => {
      const count = category === ShopCategory.SINGLES ? shelves.singles.length : productsOn(shelves, category).length;
      const tab = panel.add(
        new Button({
          id: `shop.tab.${category}`,
          x: this.#screen.inset + index * (width + TABS.gap),
          y: TABS.top,
          width,
          height: TABS.height,
          // A phone's tabs have room for the shelf's name alone.
          text: count > 0 && !this.#screen.compact ? `${TAB_TITLES[category]} (${count})` : TAB_TITLES[category],
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
    const top = this.#category === ShopCategory.SINGLES ? this.#m.listTop.filtered : this.#m.listTop.plain;
    const list = panel.add(new ScrollList({ id: LIST_ID, x: this.#screen.inset, y: top, width: this.#screen.columns.left.width - 2 * this.#screen.inset, height: this.#screen.columns.height - top - this.#screen.inset }));
    const keys = this.#entryKeys(shelves);
    if (!keys.includes(this.#selected[this.#category] ?? "")) {
      this.#selected[this.#category] = keys[0] ?? null;
      this.#resetChoice();
    }
    if (keys.length === 0) {
      const { status, error } = this.#shop().state;
      const text = { [ShopStatus.FAILED]: `The shop could not be loaded: ${error?.message ?? "unknown error"}`, [ShopStatus.READY]: this.#emptyShelfText() }[status] ?? "Loading the shop…";
      list.add(new Label({ id: "shop.empty", x: 0, y: 0, width: list.rowWidth, height: this.#screen.row.height, text, colorKey: status === ShopStatus.FAILED ? "danger" : "textMuted", fit: true }));
      list.contentHeight = this.#screen.row.height;
      return null;
    }
    const rows = this.#category === ShopCategory.SINGLES ? this.#singleRows(list, this.#visibleSingles(shelves)) : this.#productRows(list, productsOn(shelves, this.#category));
    list.contentHeight = this.#screen.rowsHeight(keys.length);
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
        [ShopCategory.RANKED]: () => `${gamesText(rankedEntriesOf(product))} · ${priceText(product)} · into the jackpot`,
      }[this.#category] ?? (() => `${cardsText(product.cards)} · ${priceText(product)}`);
      return list.add(new OptionRow({ id: `shop.product.${product.id}`, x: 0, y: this.#screen.rowY(index), width: list.rowWidth, height: this.#screen.row.height, text: product.name, subtitle: subtitle(), stripe: this.#stripeOf(deck), selected: product.id === this.#selected[this.#category], onActivate: () => this.#select(product.id) }));
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
    return this.#category === ShopCategory.PACKS || this.#category === ShopCategory.RANKED ? [{ color: theme.colors.accent, weight: 1 }] : [];
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
    const PRICE_WIDTH = this.#m.priceWidth;
    const stripWidth = list.rowWidth - PRICE_WIDTH - this.#screen.action.gap;
    return singles.map((offer, index) => {
      const card = this.#app.content.catalog.get(offer.cardId);
      const selected = offer.cardId === this.#selected[ShopCategory.SINGLES];
      list.add(new CardStrip({ x: 0, y: this.#screen.rowY(index), width: stripWidth, height: this.#screen.row.height, card: card ?? unknownCard(offer.cardId), broken: card === undefined, muted: !selected, rarity: offer.rarity ?? rarityOf(this.#app, offer.cardId) }));
      return list.add(new Button({ id: `shop.card.${offer.cardId}`, x: stripWidth + this.#screen.action.gap, y: this.#screen.rowY(index), width: PRICE_WIDTH, height: this.#screen.row.height, text: priceText(offer.product), variant: selected ? "primary" : "secondary", textSize: "small", onActivate: () => this.#select(offer.cardId) }));
    });
  }

  /**
   * @param {Shelves} shelves
   * @returns {Button | null} the Buy button
   */
  #buildDetail(shelves) {
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.right.x, y: this.#screen.columns.top, width: this.#screen.columns.right.width, height: this.#screen.columns.height }));
    const selected = this.#selected[this.#category];
    if (this.#category === ShopCategory.SINGLES) {
      const offer = shelves.singles.find((candidate) => candidate.cardId === selected);
      return offer === undefined ? null : this.#buildSingleDetail(panel, offer);
    }
    const product = productsOn(shelves, this.#category).find((candidate) => candidate.id === selected);
    if (product === undefined) {
      return null;
    }
    const deck = this.#deckOf(product);
    this.#buildTitle(panel, product, deck === undefined || !this.#screen.compact);
    if (deck !== undefined) {
      this.#buildDeckContents(panel, product, deck, shelves.singles);
    } else {
      this.#buildContentLines(panel, [...this.#contentLines(product), ...this.#oddsLines(product)]);
    }
    return this.#buildPurchase(panel, product);
  }

  /**
   * What a pack or an offer holds and its odds, line by line; scrolling on a compact screen, where they may not fit above the purchase.
   * @param {Panel} panel
   * @param {{ text: string, colorKey: string }[]} lines
   */
  #buildContentLines(panel, lines) {
    const { line: LINE, top } = this.#m;
    const parent = this.#screen.compact ? panel.add(new ScrollList({ id: "shop.contents", x: this.#screen.inset, y: top.content, width: this.#detailWidth, height: this.#purchaseTop - 6 - top.content })) : panel;
    const x = this.#screen.compact ? 0 : this.#screen.inset;
    const y = this.#screen.compact ? 0 : top.content;
    const width = parent instanceof ScrollList ? parent.rowWidth : this.#detailWidth;
    lines.forEach((line, index) => parent.add(new Label({ x, y: y + index * LINE, width, height: LINE, text: line.text, size: "small", align: "left", colorKey: line.colorKey, fit: true })));
    if (parent instanceof ScrollList) {
      parent.contentHeight = lines.length * LINE;
    }
  }

  /**
   * @param {Panel} panel
   * @param {Product} product
   * @param {boolean} described whether its description is shown (a compact deck gives its room to the cards)
   */
  #buildTitle(panel, product, described) {
    const { top, line, descriptionLines } = this.#m;
    panel.add(new Label({ x: this.#screen.inset, y: top.title, width: this.#detailWidth, height: top.titleHeight, text: product.name, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    if (described) {
      panel.add(new TextBlock({ x: this.#screen.inset, y: top.description, width: this.#detailWidth, height: descriptionLines * line, text: product.description, size: "small", colorKey: "textMuted" }));
    }
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
    const { line: LINE, deckThumb: DECK_THUMB } = this.#m;
    const compact = this.#screen.compact;
    const top = compact ? this.#m.top.description : this.#m.top.content;
    const bottom = this.#purchaseTop - (compact ? 4 : this.#screen.inset) - LINE;
    panel.add(new Label({ x: this.#screen.inset, y: top, width: this.#detailWidth, height: LINE, text: `${mixText(this.#mixOf(deck))} · ${cardsText(product.cards)}, ${lines.length} different · copies × price as a single · tap a card for its details`, size: "small", align: "left", colorKey: "accentLight", fit: true }));
    const list = panel.add(new ScrollList({ id: "shop.deckCards", x: this.#screen.inset, y: top + LINE + 6, width: this.#detailWidth, height: bottom - top - LINE - 6 }));
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
    panel.add(new Label({ id: "shop.deckTotal", x: this.#screen.inset, y: bottom, width: this.#detailWidth, height: LINE, text: `${sum}Deck price: ${priceText(product)}`, size: "small", weight: "bold", align: "right", colorKey: "accentLight", fit: true }));
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
    const { single: SINGLE, line: LINE } = this.#m;
    const compact = this.#screen.compact;
    const top = compact ? this.#m.top.title : this.#screen.inset;
    const owned = this.#ownedCopies(offer.cardId);
    if (card !== undefined) {
      this.#buildSingleCard(panel, card, { offer, top, owned });
    }
    const x = this.#screen.inset + SINGLE.card.width + this.#screen.inset;
    const width = this.#screen.columns.right.width - x - this.#screen.inset;
    panel.add(new Label({ x, y: top, width, height: SINGLE.nameHeight, text: card?.name ?? offer.cardId, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const rarityY = top + SINGLE.nameHeight + 4;
    panel.add(new Label({ id: "shop.rarity", x, y: rarityY, width, height: LINE, text: rarityLabel(offer.rarity), weight: "bold", align: "left", colorKey: rarityColor(offer.rarity) }));
    if (owned !== null) {
      panel.add(new Label({ id: "shop.owned", x, y: rarityY + LINE, width, height: LINE, text: owned === 0 ? "Not in your collection yet" : `You own ${owned}`, size: "small", align: "left", colorKey: "textMuted" }));
    }
    if (SINGLE.legend) {
      this.#buildPriceLegend(panel, { x, y: rarityY + 2 * LINE + 16, width }, offer.rarity);
    } else if (card !== undefined) {
      panel.add(new Label({ x, y: rarityY + 2 * LINE + 4, width, height: LINE, text: "Tap the card to read it", size: "small", align: "left", colorKey: "accent", fit: true }));
    }
    return this.#buildPurchase(panel, offer.product);
  }

  /**
   * A single's card; on a compact screen, where it is too small to read, a tap shows it at full size.
   * @param {Panel} panel
   * @param {import("../cards/CardDetail.js").CardLike} card
   * @param {{ offer: SingleOffer, top: number, owned: number | null }} where its offer, where it goes, and how many the player owns
   */
  #buildSingleCard(panel, card, { offer, top, owned }) {
    const { card: size } = this.#m.single;
    const rarity = offer.rarity ?? rarityOf(this.#app, offer.cardId);
    const area = { x: this.#screen.inset, y: top, width: size.width, height: size.height };
    panel.add(new CardDetail({ id: "shop.cardDetail", ...area, card, rarity }));
    if (!this.#screen.compact) {
      return;
    }
    const lines = [[rarityLabel(rarity), ...(owned === null ? [] : [ownedText(owned)])].join(" · "), `Price: ${priceText(offer.product)}`];
    panel.add(new Hotspot({ id: "shop.cardInfo", ...area, onActivate: () => this.openModal(buildCardInfoModal({ viewport: this.services.viewport, card, rarity, lines, onClose: () => this.closeModal() })) }));
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
    const { line: LINE } = this.#m;
    const column = this.#m.single.legendColumn;
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
    if (this.#m.compactPurchase) {
      return this.#buildCompactPurchase(panel, product);
    }
    const { line: LINE, quantity: QUANTITY, buy: BUY } = this.#m;
    const quantityY = this.#purchaseTop;
    panel.add(new Button({ id: "shop.less", x: this.#screen.inset, y: quantityY, width: this.#screen.action.small, height: QUANTITY.height, text: "−", enabled: this.#quantity > 1, onActivate: () => this.#changeQuantity(-1, product) }));
    panel.add(new Label({ id: "shop.quantity", x: this.#screen.inset + this.#screen.action.small, y: quantityY, width: QUANTITY.width, height: QUANTITY.height, text: String(this.#quantity), size: "heading", weight: "bold" }));
    panel.add(new Button({ id: "shop.more", x: this.#screen.inset + this.#screen.action.small + QUANTITY.width, y: quantityY, width: this.#screen.action.small, height: QUANTITY.height, text: "+", enabled: this.#quantity < product.perOrder, onActivate: () => this.#changeQuantity(1, product) }));
    const each = this.#quantity > 1 ? `${this.#quantity} × ${priceText(product)}` : `Up to ${product.perOrder} per order`;
    panel.add(new Label({ id: "shop.each", x: this.#screen.inset + 2 * this.#screen.action.small + QUANTITY.width + this.#screen.inset, y: quantityY, width: this.#detailWidth - 2 * this.#screen.action.small - QUANTITY.width - this.#screen.inset, height: QUANTITY.height, text: each, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    const price = priceOf(product);
    const buyY = quantityY + QUANTITY.height + this.#screen.inset;
    const buy = panel.add(
      new Button({
        id: "shop.buy",
        x: this.#screen.inset,
        y: buyY,
        width: BUY.width,
        height: BUY.height,
        text: `Buy for ${multiplyAmount(price.amount, this.#quantity)} ${price.asset}`,
        variant: "primary",
        enabled: this.#canBuy() && !this.#isShort(multiplyAmount(price.amount, this.#quantity), price.asset),
        onActivate: () => {
          this.#notice = null;
          shop.buy({ productId: product.id, quantity: this.#quantity, asset: price.asset });
        },
      }),
    );
    const status = this.#statusLine(purchase, multiplyAmount(price.amount, this.#quantity), price.asset);
    panel.add(new TextBlock({ id: "shop.status", x: this.#screen.inset, y: buyY + BUY.height + 8, width: this.#detailWidth, height: 2 * LINE, text: status.text, size: "small", colorKey: status.colorKey }));
    const x = this.#screen.inset + BUY.width + this.#screen.inset;
    const side = this.#screen.columns.right.width - x - this.#screen.inset;
    if (purchase.stage === PurchaseStage.FAILED && purchase.order?.payment) {
      const half = (side - this.#screen.action.gap) / 2;
      panel.add(new Button({ id: "shop.payAgain", x, y: buyY, width: half, height: BUY.height, text: "Pay again", onActivate: () => shop.payAgain() }));
      panel.add(new Button({ id: "shop.cancel", x: x + half + this.#screen.action.gap, y: buyY, width: half, height: BUY.height, text: "Cancel order", variant: "danger", textSize: "small", onActivate: () => shop.cancel() }));
    } else {
      panel.add(new Button({ id: "shop.addToCart", x, y: buyY, width: side, height: BUY.height, text: "Add to cart", enabled: shop.state.status === ShopStatus.READY, onActivate: () => this.#addToCart(product) }));
    }
    return buy;
  }

  /**
   * The purchase on a compact screen: the status line, then − quantity +,
   * then Buy beside Add to cart (or Pay again and Cancel after a failed payment).
   * @param {Panel} panel
   * @param {Product} product
   * @returns {Button} the Buy button
   */
  #buildCompactPurchase(panel, product) {
    const shop = this.#shop();
    const { purchase } = shop.state;
    const { line, quantity, buy: buyRow, rowGap } = this.#m;
    const { inset, action } = this.#screen;
    const width = this.#detailWidth;
    const statusY = this.#purchaseTop;
    const price = priceOf(product);
    const amount = multiplyAmount(price.amount, this.#quantity);
    const status = this.#statusLine(purchase, amount, price.asset);
    panel.add(new TextBlock({ id: "shop.status", x: inset, y: statusY, width, height: 2 * line, text: status.text, size: "small", colorKey: status.colorKey }));
    const quantityY = statusY + 2 * line + rowGap;
    panel.add(new Button({ id: "shop.less", x: inset, y: quantityY, width: action.small, height: quantity.height, text: "−", enabled: this.#quantity > 1, onActivate: () => this.#changeQuantity(-1, product) }));
    panel.add(new Label({ id: "shop.quantity", x: inset + action.small, y: quantityY, width: quantity.width, height: quantity.height, text: String(this.#quantity), size: "heading", weight: "bold" }));
    panel.add(new Button({ id: "shop.more", x: inset + action.small + quantity.width, y: quantityY, width: action.small, height: quantity.height, text: "+", enabled: this.#quantity < product.perOrder, onActivate: () => this.#changeQuantity(1, product) }));
    const eachX = inset + 2 * action.small + quantity.width + action.gap;
    const each = this.#quantity > 1 ? `${this.#quantity} × ${priceText(product)}` : `Up to ${product.perOrder} per order`;
    panel.add(new Label({ id: "shop.each", x: eachX, y: quantityY, width: inset + width - eachX, height: quantity.height, text: each, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    const buyY = quantityY + quantity.height + rowGap;
    const buyWidth = Math.round(width * 0.6);
    const buy = panel.add(new Button({ id: "shop.buy", x: inset, y: buyY, width: buyWidth, height: buyRow.height, text: `Buy for ${amount} ${price.asset}`, variant: "primary", keepPlate: true, enabled: this.#canBuy() && !this.#isShort(amount, price.asset), onActivate: () => {
      this.#notice = null;
      shop.buy({ productId: product.id, quantity: this.#quantity, asset: price.asset });
    } }));
    const sideX = inset + buyWidth + action.gap;
    const side = inset + width - sideX;
    if (purchase.stage === PurchaseStage.FAILED && purchase.order?.payment) {
      const half = (side - action.gap) / 2;
      panel.add(new Button({ id: "shop.payAgain", x: sideX, y: buyY, width: half, height: buyRow.height, text: "Pay again", textSize: "small", keepPlate: true, onActivate: () => shop.payAgain() }));
      panel.add(new Button({ id: "shop.cancel", x: sideX + half + action.gap, y: buyY, width: half, height: buyRow.height, text: "Cancel", variant: "danger", textSize: "small", onActivate: () => shop.cancel() }));
    } else {
      panel.add(new Button({ id: "shop.addToCart", x: sideX, y: buyY, width: side, height: buyRow.height, text: "Add to cart", keepPlate: true, enabled: shop.state.status === ShopStatus.READY, onActivate: () => this.#addToCart(product) }));
    }
    return buy;
  }

  #canBuy() {
    const shop = this.#shop();
    const busy = BUSY_STAGES.includes(shop.state.purchase.stage);
    return shop.state.status === ShopStatus.READY && this.#signedIn() && !busy;
  }

  #signedIn() {
    return (this.#app.account?.state.account ?? null) !== null;
  }

  /** The asset the shop's prices are in. */
  #asset() {
    return this.#shop().state.listing?.priceList.asset || "STEEM";
  }

  /**
   * Whether the player's wallet is known to hold less than `amount`.
   * @param {string} amount
   * @param {string} asset
   */
  #isShort(amount, asset) {
    return this.#app.balance?.isShort(amount, asset) ?? false;
  }

  /** @returns {{ text: string, colorKey: string }} the player's budget, as far as it is known */
  #budgetLine() {
    const balance = this.#app.balance;
    const asset = this.#asset();
    const amount = balance?.amountOf(asset) ?? null;
    if (amount !== null) {
      return { text: `Your budget: ${amount} ${asset}`, colorKey: "accentLight" };
    }
    if (balance === undefined || balance.state.loading) {
      return { text: "Reading your wallet…", colorKey: "textMuted" };
    }
    return { text: balance.state.error === null ? "Your budget is not known" : `Your wallet could not be read: ${balance.state.error}`, colorKey: "danger" };
  }

  /**
   * "Not enough STEEM…", when the wallet is known to hold less than `amount`.
   * @param {string} amount
   * @param {string} asset
   * @returns {{ text: string, colorKey: string } | null}
   */
  #shortfall(amount, asset) {
    if (!this.#isShort(amount, asset)) {
      return null;
    }
    return { text: `Not enough ${asset}: this costs ${amount} ${asset}, your wallet holds ${this.#app.balance?.amountOf(asset)} ${asset}.`, colorKey: "danger" };
  }

  /**
   * @param {import("../../application/shop/ShopService.js").Purchase} purchase
   * @param {string} amount what Buy would pay
   * @param {string} asset
   * @returns {{ text: string, colorKey: string }}
   */
  #statusLine(purchase, amount, asset) {
    if (purchase.error !== null) {
      const where = purchase.error.code === "LIMIT_REACHED" && this.#shop().state.orders.open.length > 0 ? " (Orders, at the top)" : "";
      return { text: `${purchase.error.message}${where}`, colorKey: purchase.stage === PurchaseStage.FAILED ? "danger" : "accent" };
    }
    const text = STAGE_TEXT[/** @type {keyof typeof STAGE_TEXT} */ (purchase.stage)];
    if (text !== undefined) {
      return { text: text(purchase, this.#app), colorKey: purchase.stage === PurchaseStage.DONE ? "success" : "accent" };
    }
    if (this.#notice !== null) {
      return this.#notice;
    }
    if (!this.#signedIn()) {
      return { text: "Sign in to buy.", colorKey: "textMuted" };
    }
    const preview = transferPreviewText(this.#app);
    return this.#shortfall(amount, asset) ?? { text: `${preview[0].toUpperCase()}${preview.slice(1)} before anything is paid.`, colorKey: "textMuted" };
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
      entry: (item) => `${item.ref} entry: ${playsText(item.count)} of ${item.ref} play`,
    };
    const lines = product.contents.map((item) => ({ text: `${item.count} × ${(describe[item.type] ?? (() => item.ref))(item)}`, colorKey: "text" }));
    return rankedEntriesOf(product) > 0 ? [...lines, ...this.#rankedLines()] : lines;
  }

  /** What ranked entries are for, and how many the player holds. */
  #rankedLines() {
    const ranked = this.#app.entries?.ranked ?? null;
    const held = ranked === null ? [] : [{ text: `You have ${rankedEntriesText(ranked.balance)}.`, colorKey: "accentLight" }];
    const cost = ranked === null || ranked.perGame === 0 ? "Ranked games take entries during a season with an entry fee." : `Every ranked game takes ${feeText(ranked.perGame)} from each player.`;
    return [{ text: "Every entry goes into the season's jackpot.", colorKey: "accent" }, { text: cost, colorKey: "textMuted" }, ...held];
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
    if (fulfilment === null || fulfilment === undefined || this.#revealClosed || cardsReceived(fulfilment) === 0) {
      // Entries alone are not revealed: the status line says they arrived.
      return null;
    }
    const { viewport } = this.services;
    const close = () => {
      this.#revealClosed = true;
      this.#shop().dismiss();
    };
    const REVEAL = { ...this.#m.reveal, ...this.#dialogSize(this.#m.reveal) };
    const modal = new Modal({ id: "reveal", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: REVEAL.width, panelHeight: REVEAL.height, onDismiss: close });
    const { panel } = modal;
    const width = REVEAL.width - 2 * this.#screen.inset;
    const total = fulfilment.cards.length + fulfilment.packs.reduce((sum, pack) => sum + pack.cards.length, 0);
    panel.add(new Label({ x: this.#screen.inset, y: this.#screen.compact ? 8 : this.#screen.inset, width, height: 44, text: `You received ${cardsText(total)}`, size: "heading", weight: "bold", colorKey: "accentLight", glow: true }));
    this.#buildRevealList(panel.add(new ScrollList({ id: "reveal.cards", x: this.#screen.inset, y: REVEAL.title, width, height: REVEAL.height - REVEAL.title - 2 * this.#screen.inset - REVEAL.button })), fulfilment);
    const buttonWidth = (width - this.#screen.action.gap) / 2;
    const buttonsY = REVEAL.height - this.#screen.inset - REVEAL.button;
    const view = panel.add(
      new Button({
        id: "reveal.collection",
        x: this.#screen.inset,
        y: buttonsY,
        width: buttonWidth,
        height: REVEAL.button,
        text: "View collection",
        variant: "primary",
        enabled: this.services.hasScene(SceneId.COLLECTION),
        onActivate: () => {
          close();
          // The cards just received are lit in the collection, as from a notification.
          const fresh = [...fulfilment.cards, ...fulfilment.packs.flatMap((pack) => pack.cards)].map((card) => Object.freeze({ definitionId: card.definitionId, count: 1, serial: card.serial }));
          this.services.navigate(SceneId.COLLECTION, { fresh, from: SceneId.SHOP });
        },
      }),
    );
    panel.add(new Button({ id: "reveal.close", x: this.#screen.inset + buttonWidth + this.#screen.action.gap, y: buttonsY, width: buttonWidth, height: REVEAL.button, text: "Keep shopping", onActivate: close }));
    this.openModal(modal);
    this.#soundReveal(fulfilment);
    return view;
  }

  /**
   * The cards arriving, heard once per order: a chime, then a sweep of light
   * when one of them is of the top rarities — brighter the rarer the best of them.
   * @param {import("../../application/ports/MarketApi.contract.js").Fulfilment} fulfilment
   */
  #soundReveal(fulfilment) {
    if (fulfilment === this.#heardFulfilment) {
      return;
    }
    this.#heardFulfilment = fulfilment;
    this.services.sound?.play(SoundCue.PURCHASE_COMPLETE);
    const order = this.#app.rarities?.order ?? [];
    const cards = [...fulfilment.cards, ...fulfilment.packs.flatMap((pack) => pack.cards)];
    const best = Math.max(-1, ...cards.map((card) => order.indexOf(rarityOf(this.#app, card.definitionId) ?? "")));
    const fromTop = order.length - 1 - best;
    if (best >= 0 && fromTop < RARE_REVEAL.topRarities) {
      this.services.sound?.play(SoundCue.RARE_REVEAL, { delayMs: RARE_REVEAL.delayMs, gain: RARE_REVEAL.gain - fromTop * RARE_REVEAL.step });
    }
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
    const CART = { ...this.#m.cart, ...this.#dialogSize(this.#m.cart) };
    const { line: LINE } = this.#m;
    const modal = new Modal({ id: "cart", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: CART.width, panelHeight: CART.height, onDismiss: () => this.#showCart(false) });
    const { panel } = modal;
    const width = CART.width - 2 * this.#screen.inset;
    const titleY = this.#screen.compact ? 6 : this.#screen.inset;
    panel.add(new Label({ x: this.#screen.inset, y: titleY, width: width / 2, height: 44, text: "Your cart", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    panel.add(new Label({ id: "cart.count", x: this.#screen.inset + width / 2, y: titleY, width: width / 2, height: 44, text: cartCountText(summary), size: "small", align: "right", colorKey: "textMuted" }));
    const footerY = CART.height - this.#screen.inset - CART.footer;
    const totalY = footerY - (this.#screen.compact ? 4 : this.#screen.inset) - 2 * LINE;
    const listY = titleY + CART.title;
    this.#buildCartLines(panel.add(new ScrollList({ id: CART_LIST_ID, x: this.#screen.inset, y: listY, width, height: totalY - listY - 6 })), summary, scrollY);
    panel.add(new Label({ id: "cart.total", x: this.#screen.inset, y: totalY, width, height: LINE, text: summary.asset === null ? "" : `Total: ${summary.total} ${summary.asset}`, size: "body", weight: "bold", align: "right", colorKey: "accentLight" }));
    if (this.#signedIn()) {
      const budget = this.#budgetLine();
      panel.add(new Label({ id: "cart.budget", x: this.#screen.inset, y: totalY, width: width / 2, height: LINE, text: budget.text, size: "small", weight: "bold", align: "left", colorKey: budget.colorKey, fit: true }));
    }
    const hint = this.#cartHint(summary);
    panel.add(new Label({ id: "cart.status", x: this.#screen.inset, y: totalY + LINE, width, height: LINE, text: hint.text, size: "small", align: "right", colorKey: hint.colorKey, fit: true }));
    const buttons = this.#buildCartButtons(panel, summary, { y: footerY, width: CART.width, height: CART.footer });
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
    const { line: LINE, cart: CART } = this.#m;
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
    const { cart: CART } = this.#m;
    const inner = width - 2 * 10;
    list.add(new Panel({ id: `cart.line.${productId}`, x, y, width, height: CART.tile }));
    list.add(new CardFan({ id: `cart.visual.${productId}`, x: x + 10, y: y + 10, width: inner, height: CART.fan, ...this.#fanOf(product, productId), badge: `×${quantity}` }));
    list.add(new Button({ id: `cart.remove.${productId}`, x: x + width - 8 - CART.remove, y: y + 8, width: CART.remove, height: CART.remove, text: "×", variant: "danger", onActivate: () => shop.removeFromCart(productId) }));
    const nameY = y + CART.fan + (this.#screen.compact ? 10 : 16);
    list.add(new Label({ id: `cart.name.${productId}`, x: x + 10, y: nameY, width: inner, height: 26, text: product?.name ?? productId, weight: "bold", colorKey: product === null ? "danger" : "text", fit: true }));
    const each = product === null ? "No longer on sale: remove it" : `${priceText(product)} each · ${cardsText(product.cards)}`;
    list.add(new Label({ x: x + 10, y: nameY + 26, width: inner, height: 22, text: each, size: "small", colorKey: product === null ? "danger" : "textMuted", fit: true }));
    const controlsY = y + CART.tile - 12 - CART.step.height;
    const step = { width: CART.step.width, height: CART.step.height };
    const limit = product?.perOrder ?? quantity;
    list.add(new Button({ id: `cart.less.${productId}`, x: x + 10, y: controlsY, ...step, text: "−", enabled: quantity > 1, onActivate: () => shop.setCartQuantity(productId, quantity - 1) }));
    list.add(new Label({ id: `cart.quantity.${productId}`, x: x + 10 + step.width, y: controlsY, ...step, text: String(quantity), weight: "bold" }));
    list.add(new Button({ id: `cart.more.${productId}`, x: x + 10 + 2 * step.width, y: controlsY, ...step, text: "+", enabled: quantity < limit, onActivate: () => shop.setCartQuantity(productId, quantity + 1) }));
    const amountX = x + 10 + 3 * step.width + 8;
    const amount = line.amount === null ? "—" : `${line.amount} ${priceOf(/** @type {Product} */ (product)).asset}`;
    list.add(new Label({ id: `cart.amount.${productId}`, x: amountX, y: controlsY, width: x + width - 10 - amountX, height: step.height, text: amount, size: this.#screen.compact ? "small" : "body", weight: "bold", align: "right", colorKey: "accentLight", fit: true }));
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
   * @param {{ y: number, width: number, height: number }} footer where the row goes, the dialog's width and the buttons' height
   * @returns {Button[]} the buttons to focus first, in order of preference
   */
  #buildCartButtons(panel, summary, { y, width, height }) {
    const shop = this.#shop();
    const third = (width - 2 * this.#screen.inset - 2 * this.#screen.action.gap) / 3;
    const clear = panel.add(new Button({ id: "cart.clear", x: this.#screen.inset, y, width: third, height, text: "Empty cart", variant: "danger", enabled: summary.lines.length > 0, onActivate: () => shop.clearCart() }));
    const keep = panel.add(new Button({ id: "cart.close", x: this.#screen.inset + third + this.#screen.action.gap, y, width: third, height, text: "Keep shopping", onActivate: () => this.#showCart(false) }));
    const pay = panel.add(
      new Button({
        id: "cart.pay",
        x: this.#screen.inset + 2 * (third + this.#screen.action.gap),
        y,
        width: third,
        height,
        text: summary.payable ? `Pay ${summary.total} ${summary.asset}` : "Pay",
        variant: "primary",
        enabled: summary.payable && this.#canBuy() && !this.#isShort(summary.total, /** @type {string} */ (summary.asset)),
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
    return this.#shortfall(summary.total, /** @type {string} */ (summary.asset)) ?? { text: `One payment for everything: ${transferPreviewText(this.#app)} before anything is paid.`, colorKey: "textMuted" };
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

  /** @param {boolean} shown */
  #showOrders(shown) {
    this.#ordersShown = shown;
    if (shown) {
      void this.#shop().loadOrders();
    }
    this.#rebuild();
  }

  /**
   * The unpaid orders, over the shop: one row each with Pay and Cancel.
   * @param {string} focusedId the node focused before the rebuild, kept when it is in the dialog
   * @param {number} scrollY where the list was scrolled
   * @returns {import("../ui/UiNode.js").UiNode | null} the node to focus in the dialog
   */
  #openOrdersIfShown(focusedId, scrollY) {
    if (!this.#ordersShown) {
      return null;
    }
    const { orders } = this.#shop().state;
    const { viewport } = this.services;
    const { inset, compact } = this.#screen;
    const ORDERS = { ...this.#m.orders, ...this.#dialogSize(this.#m.orders) };
    const { line: LINE } = this.#m;
    const modal = new Modal({ id: "orders", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: ORDERS.width, panelHeight: ORDERS.height, onDismiss: () => this.#showOrders(false) });
    const { panel } = modal;
    const width = ORDERS.width - 2 * inset;
    const titleY = compact ? 6 : inset;
    panel.add(new Label({ x: inset, y: titleY, width, height: 44, text: "Your unpaid orders", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const footerY = ORDERS.height - inset - ORDERS.footer;
    const noteY = footerY - (compact ? 4 : inset) - LINE;
    const listY = titleY + ORDERS.title;
    const list = panel.add(new ScrollList({ id: ORDERS_LIST_ID, x: inset, y: listY, width, height: noteY - listY - 6 }));
    const pays = this.#buildOrderRows(list, orders.open, scrollY);
    const note = orders.error === null ? { text: "Nothing is paid until you approve the transfer. An unpaid order closes on its own when its time is up.", colorKey: "textMuted" } : { text: `Your orders could not be read: ${orders.error.message}`, colorKey: "danger" };
    panel.add(new Label({ id: "orders.note", x: inset, y: noteY, width, height: LINE, text: note.text, size: "small", align: "left", colorKey: note.colorKey, fit: true }));
    const close = panel.add(new Button({ id: "orders.close", x: inset + width - ORDERS.button * 1.5, y: footerY, width: ORDERS.button * 1.5, height: ORDERS.footer, text: "Close", onActivate: () => this.#showOrders(false) }));
    this.openModal(modal);
    const kept = modal.findById(focusedId);
    return [kept, ...pays, close].find((node) => node?.isEffectivelyEnabled) ?? null;
  }

  /**
   * One row per unpaid order, newest first, or a line saying there is none.
   * @param {ScrollList} list
   * @param {readonly import("../../application/ports/MarketApi.contract.js").Order[]} open
   * @param {number} scrollY
   * @returns {Button[]} the Pay buttons, in order
   */
  #buildOrderRows(list, open, scrollY) {
    const { line: LINE, orders: ORDERS } = this.#m;
    if (open.length === 0) {
      const loading = this.#shop().state.orders.status === OrdersStatus.LOADING;
      list.add(new TextBlock({ id: "orders.empty", x: 0, y: 0, width: list.rowWidth, height: 2 * LINE, text: loading ? "Reading your orders…" : "You have no unpaid orders.", size: "body", colorKey: "textMuted" }));
      list.contentHeight = 2 * LINE;
      return [];
    }
    const pays = open.map((order, index) => this.#buildOrderRow(list, order, index * (ORDERS.row + ORDERS.gap)));
    list.contentHeight = open.length * (ORDERS.row + ORDERS.gap) - ORDERS.gap;
    list.scrollTo(scrollY);
    return pays;
  }

  /**
   * An unpaid order: what it holds, its amount, how long ago it was made and
   * how long is left to pay; Pay while there is time, Cancel always.
   * @param {ScrollList} list
   * @param {import("../../application/ports/MarketApi.contract.js").Order} order
   * @param {number} y
   * @returns {Button} its Pay button
   */
  #buildOrderRow(list, order, y) {
    const shop = this.#shop();
    const { orders: ORDERS } = this.#m;
    const compact = this.#screen.compact;
    const pad = compact ? 8 : 12;
    const width = list.rowWidth;
    const gap = this.#screen.action.gap;
    const buttonY = y + pad;
    const buttonHeight = ORDERS.row - 2 * pad;
    const textSize = compact ? /** @type {const} */ ("small") : undefined;
    const textWidth = width - 2 * pad - 2 * ORDERS.button - 2 * gap;
    const { detail, payable } = describeUnpaid(order, this.#now());
    const paying = BUSY_STAGES.includes(shop.state.purchase.stage) && shop.state.purchase.order?.id === order.id;
    list.add(new Panel({ id: `orders.row.${order.id}`, x: 0, y, width, height: ORDERS.row }));
    const items = order.items.map((item) => `${item.quantity} × ${item.name}`).join(" · ");
    list.add(new Label({ id: `orders.items.${order.id}`, x: pad, y: y + pad, width: textWidth, height: (ORDERS.row - 2 * pad) / 2, text: items, weight: "bold", align: "left", fit: true }));
    list.add(new Label({ id: `orders.detail.${order.id}`, x: pad, y: y + ORDERS.row / 2, width: textWidth, height: (ORDERS.row - 2 * pad) / 2, text: detail, size: "small", align: "left", colorKey: payable ? "textMuted" : "danger", fit: true }));
    const payX = width - pad - 2 * ORDERS.button - gap;
    const pay = list.add(
      new Button({
        id: `orders.pay.${order.id}`,
        x: payX,
        y: buttonY,
        width: ORDERS.button,
        height: buttonHeight,
        text: paying ? "Paying…" : "Pay",
        variant: "primary",
        textSize,
        keepPlate: true,
        enabled: payable && this.#canBuy() && !this.#isShort(order.total.amount, order.total.asset),
        onActivate: () => {
          this.#ordersShown = false;
          this.#notice = null;
          void shop.payOpenOrder(order.id);
        },
      }),
    );
    list.add(new Button({ id: `orders.cancel.${order.id}`, x: payX + ORDERS.button + gap, y: buttonY, width: ORDERS.button, height: buttonHeight, text: "Cancel", variant: "danger", textSize, keepPlate: true, enabled: !paying, onActivate: () => void shop.cancelOpenOrder(order.id) }));
    return pay;
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
    const { reveal: REVEAL } = this.#m;
    let y = 0;
    const groups = [...(fulfilment.cards.length > 0 ? [{ title: null, cards: fulfilment.cards }] : []), ...fulfilment.packs.map((pack) => ({ title: `Pack ${pack.index + 1}`, cards: pack.cards }))];
    for (const group of groups) {
      if (group.title !== null) {
        list.add(new Label({ x: 0, y, width: list.rowWidth, height: 30, text: group.title, size: "small", weight: "bold", align: "left", colorKey: "accent" }));
        y += 30;
      }
      for (const card of group.cards) {
        const definition = this.#app.content.catalog.get(card.definitionId);
        list.add(new CardStrip({ x: 0, y, width: list.rowWidth - REVEAL.serial - 10, height: REVEAL.row, card: definition ?? unknownCard(card.definitionId), broken: definition === undefined, rarity: rarityOf(this.#app, card.definitionId) }));
        list.add(new Label({ x: list.rowWidth - REVEAL.serial, y, width: REVEAL.serial, height: REVEAL.row, text: `#${card.serial}`, size: "small", align: "left", colorKey: "textMuted" }));
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
    return productsOn(shelves, this.#category).map((product) => product.id);
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
 * The products on a shelf other than Singles.
 * @param {Shelves} shelves
 * @param {string} category
 * @returns {readonly Product[]}
 */
function productsOn(shelves, category) {
  return shelves[/** @type {"packs" | "decks" | "ranked" | "offers"} */ (category)] ?? [];
}

/**
 * The ranked entries one unit of a product gives.
 * @param {Product} product
 */
function rankedEntriesOf(product) {
  return product.contents.reduce((sum, item) => sum + (item.type === "entry" && item.ref === RANKED_ENTRY ? item.count : 0), 0);
}

/** "one game", "3 games" @param {number} count */
const playsText = (count) => (count === 1 ? "one game" : `${count} games`);

/** "one entry", "2 entries" @param {number} count */
const feeText = (count) => (count === 1 ? "one entry" : `${count} entries`);

/** "1 ranked game", "10 ranked games" @param {number} count */
const gamesText = (count) => `${count} ranked game${count === 1 ? "" : "s"}`;

/**
 * Cards an order gave, its own and its packs'.
 * @param {import("../../application/ports/MarketApi.contract.js").Fulfilment} fulfilment
 */
function cardsReceived(fulfilment) {
  return fulfilment.cards.length + fulfilment.packs.reduce((sum, pack) => sum + pack.cards.length, 0);
}

/**
 * What a fulfilled order gave, in a line.
 * @param {import("../../application/ports/MarketApi.contract.js").Fulfilment | null} fulfilment
 */
export function doneText(fulfilment) {
  const entries = fulfilment?.entries.reduce((sum, entry) => sum + entry.count, 0) ?? 0;
  if (fulfilment === null || entries === 0) {
    return "Done: your cards are in your collection.";
  }
  const added = `Done: ${entries} ranked ${entries === 1 ? "entry is" : "entries are"} yours, and in the season's jackpot.`;
  return cardsReceived(fulfilment) > 0 ? `${added} Your cards are in your collection.` : added;
}

/**
 * How many copies of a card the player owns, in words.
 * @param {number} owned
 */
function ownedText(owned) {
  return owned === 0 ? "not in your collection yet" : `you own ${owned}`;
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
