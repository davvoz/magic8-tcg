/**
 * The player market (docs/tcg/14-vendite.md): a board everyone sees, where
 * players sell copies of their cards for STEEM.
 *
 * On the left, the board (newest or cheapest first, filtered by faction,
 * rarity and type or one card only, page by page) or, signed in, the player's own listings and
 * purchases. On the right, the selected listing at full size with Buy (or
 * Withdraw, for one's own), the purchase in progress, or the composer of a
 * new listing: one of the player's tradeable copies and a price.
 *
 * Paying goes through the wallet (Keychain shows the exact transfer, to the
 * seller's own account); the card arrives once the chain makes it final.
 * Every price and status shown is the server's. Beside a card on sale, the
 * buyer sees their budget, what their wallet holds: a card it cannot pay
 * for cannot be bought.
 *
 * On a compact screen (a phone in landscape) the filters are one button
 * beside the sorts, the board has no seller column (the listing says who
 * sells it), and the card beside a listing is small: a tap shows it whole.
 */
import { NO_CARD_FILTER, cardFilterOptions, cardIdsMatching, describeCardFilter, isFiltering, matchesCardFilter } from "../../application/content/CardFilter.js";
import { BUSY_BUY_STAGES, BuyStage, PROBLEM_TEXT } from "../../application/sales/SalesService.js";
import { CARD_FILTER_BAR_HEIGHT, CARD_FILTER_BUTTON_HEIGHT, buildCardFilterBar, buildCardFilterButton } from "../cards/cardFilterBar.js";
import { CardDetail } from "../cards/CardDetail.js";
import { CardOption } from "../cards/CardOption.js";
import { CardStrip } from "../cards/CardStrip.js";
import { buildCardInfoModal, copyLabel, rarityOf } from "../cards/cardInfo.js";
import { rarityColorKey, rarityLabel } from "../theme/rarity.js";
import { unknownCard } from "../cards/unknownCard.js";
import { AvatarNode } from "../ui/AvatarNode.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Hotspot } from "../ui/Hotspot.js";
import { Label } from "../ui/Label.js";
import { capitalize } from "../text/textUtils.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { TextField } from "../ui/TextField.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { ActiveKeyDialog } from "./ActiveKeyDialog.js";
import { SceneId } from "./sceneIds.js";
import { approveTransferText } from "./walletText.js";

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
/**
 * Every size of the market, wide and compact (a phone in landscape).
 * @typedef {Readonly<{
 *   line: number, tabs: { top: number, height: number, gap: number }, sorts: { top: number, height: number, gap: number, width: number },
 *   filterTop: number, filterButton: boolean, listTop: number, copiesTop: number, composerFilterTop: number, pager: number,
 *   priceWidth: number, metaWidth: number, sellerAvatar: number, card: { width: number, height: number }, button: number, priceField: number, title: number,
 * }>} MarketMetrics `filterButton`: the card filter as one button (on the sorts' row, and under the composer's title);
 *   `copiesTop`: the composer's list of copies, below its title and filter; `metaWidth`: the seller column of the board (0: none),
 *   `sellerAvatar`: the seller's portrait at its start
 */
/** @type {MarketMetrics} */
const WIDE = Object.freeze({
  line: 30,
  tabs: Object.freeze({ top: 20, height: 40, gap: 8 }),
  sorts: Object.freeze({ top: 70, height: 38, gap: 6, width: 150 }),
  filterTop: 70 + 38 + 10,
  filterButton: false,
  listTop: 70 + 38 + 10 + CARD_FILTER_BAR_HEIGHT + 12,
  copiesTop: 48 + CARD_FILTER_BAR_HEIGHT + 12,
  composerFilterTop: 48,
  pager: 44,
  priceWidth: 170,
  metaWidth: 190,
  sellerAvatar: 40,
  card: Object.freeze({ width: 300, height: 442 }),
  button: 56,
  priceField: 52,
  title: 220,
});
/** @type {MarketMetrics} */
const COMPACT = Object.freeze({
  line: 22,
  tabs: Object.freeze({ top: 12, height: 46, gap: 6 }),
  sorts: Object.freeze({ top: 66, height: CARD_FILTER_BUTTON_HEIGHT, gap: 6, width: 92 }),
  filterTop: 66,
  filterButton: true,
  listTop: 66 + CARD_FILTER_BUTTON_HEIGHT + 10,
  copiesTop: 38 + CARD_FILTER_BUTTON_HEIGHT + 8,
  composerFilterTop: 38,
  pager: 44,
  priceWidth: 112,
  metaWidth: 0,
  sellerAvatar: 0,
  card: Object.freeze({ width: 140, height: 196 }),
  button: 46,
  priceField: 46,
  title: 120,
});
const PRICE_PATTERN = /^\d{1,6}(\.\d{1,3})?$/;
const Tab = Object.freeze({ BOARD: "board", MINE: "mine" });
/** @typedef {typeof Tab[keyof typeof Tab]} MarketTab */

/** What the buyer sees at each step of a purchase. */
const STAGE_TEXT = Object.freeze({
  [BuyStage.RESERVING]: () => "Reserving the card for you…",
  [BuyStage.SIGNING]: (purchase, app) => `${approveTransferText(app)}: ${purchase.payment.amount} ${purchase.payment.asset} to @${purchase.payment.to}, the seller.`,
  [BuyStage.CONFIRMING]: () => "Payment sent to the seller. The STEEM blockchain makes it final in about a minute: keep playing, you will be notified when the card is yours.",
  [BuyStage.DONE]: () => "Done: the card is in your collection.",
});

/**
 * One line about a listing for the lists.
 * @param {import("../../application/ports/SalesApi.contract.js").Listing} listing
 * @param {number} now
 */
export function listingSubtitle(listing, now) {
  const copy = `#${listing.card.serial}`;
  switch (listing.status) {
    case "SOLD":
      return listing.buyer === null ? `${copy} · sold` : `${copy} · sold to @${listing.buyer}`;
    case "ACTIVE": {
      const days = Math.max(0, Math.ceil((listing.expiresAt - now) / DAY));
      const state = listing.reserved ? "a buyer is paying" : `${days} day(s) left`;
      return `${copy} · @${listing.seller} · ${state}`;
    }
    default:
      return `${copy} · ${listing.status.toLowerCase()}`;
  }
}

/**
 * A line of the player's own activity, as its row shows it: what happened (`verb`, in `colorKey`), to whom or how long it
 * has left (`detail`), the other side (`avatar`) and whether it is over without a deal (`closed`, drawn dimmed).
 * @typedef {Readonly<{ verb: string, colorKey: string, detail: string, avatar: string, closed: boolean }>} Activity
 */

/**
 * One of the player's listings as its row tells it.
 * @param {import("../../application/ports/SalesApi.contract.js").Listing} listing
 * @param {number} now
 * @returns {Activity}
 */
export function saleActivity(listing, now) {
  switch (listing.status) {
    case "ACTIVE": {
      const days = Math.max(0, Math.ceil((listing.expiresAt - now) / DAY));
      return { verb: "On sale", colorKey: "accent", detail: listing.reserved ? "a buyer is paying" : `${days} day(s) left`, avatar: listing.seller, closed: false };
    }
    case "SOLD":
      return { verb: "Sold", colorKey: "success", detail: listing.buyer === null ? "to a player" : `to @${listing.buyer}`, avatar: listing.buyer ?? listing.seller, closed: false };
    default:
      return { verb: capitalize(listing.status.toLowerCase()), colorKey: "textMuted", detail: "not sold", avatar: listing.seller, closed: true };
  }
}

/**
 * One of the player's purchases as its row tells it.
 * @param {import("../../application/ports/SalesApi.contract.js").Purchase} purchase
 * @returns {Activity}
 */
export function purchaseActivity(purchase) {
  const detail = `from @${purchase.seller}`;
  switch (purchase.status) {
    case "COMPLETED":
      return { verb: "Bought", colorKey: "success", detail, avatar: purchase.seller, closed: false };
    case "PENDING":
    case "DETECTED":
      return { verb: "Buying", colorKey: "resource", detail, avatar: purchase.seller, closed: false };
    default:
      return { verb: `Purchase ${purchase.status.toLowerCase()}`, colorKey: "textMuted", detail, avatar: purchase.seller, closed: true };
  }
}

/**
 * What is happening to a purchase in progress, or what went wrong.
 * @param {string} stage
 * @param {import("../../application/ports/SalesApi.contract.js").Purchase} purchase
 * @param {Readonly<{ message: string }> | null} error
 * @param {import("../../application/AppContext.js").AppContext} app
 */
function stageText(stage, purchase, error, app) {
  const describe = STAGE_TEXT[/** @type {keyof typeof STAGE_TEXT} */ (stage)];
  return error?.message ?? (describe === undefined ? "" : describe(purchase, app));
}

/** @param {string} problem */
const problemText = (problem) => PROBLEM_TEXT[/** @type {keyof typeof PROBLEM_TEXT} */ (problem)] ?? problem;

export class MarketScene extends Scene {
  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return screenLayout(this.services.viewport);
  }

  /** @returns {MarketMetrics} */
  get #m() {
    return this.#screen.compact ? COMPACT : WIDE;
  }

  #app;
  /** The active key a payment with the player's own keys needs, asked for over the market. @type {ActiveKeyDialog | null} */
  #activeKey = null;
  #now;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** @type {MarketTab} */
  #tab = Tab.BOARD;
  /** @type {{ kind: "listing" | "purchase", id: string } | null} */
  #selected = null;
  #selling = false;
  /** @type {string | null} */
  #copy = null;
  #price = "";
  /** Cards on the board. @type {import("../../application/content/CardFilter.js").CardFilter} */
  #boardFilter = NO_CARD_FILTER;
  /** Copies offered for sale. @type {import("../../application/content/CardFilter.js").CardFilter} */
  #sellFilter = NO_CARD_FILTER;
  /** Where Back leads: the scene the player came from. @type {string} */
  #from = SceneId.MAIN_MENU;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {() => number} [now]
   */
  constructor(services, app, now = () => Date.now()) {
    super(services);
    this.#app = app;
    this.#now = now;
  }

  /** @param {{ from?: string }} [params] */
  enter(params = {}) {
    this.#from = params.from !== undefined && this.services.hasScene(params.from) ? params.from : SceneId.MAIN_MENU;
    const sales = this.#sales();
    const unsubscribe = sales.subscribe(() => this.#rebuild());
    // What other players list, buy or withdraw shows up while the board is on screen.
    const unwatch = sales.watchBoard();
    const unwatchBalance = this.#app.balance?.subscribe(() => this.#rebuild());
    this.#unsubscribe = () => {
      unsubscribe();
      unwatch();
      unwatchBalance?.();
    };
    if (this.#signedIn()) {
      void this.#app.balance?.refresh();
    }
    sales.loadBoard({ cards: cardIdsMatching(this.#boardFilter, this.#app) });
    sales.refreshMine();
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

  relayout() {
    this.#rebuild();
    this.#activeKey?.relayout();
  }

  onCancel() {
    if (this.modal !== null) {
      super.onCancel();
      return;
    }
    if (this.#selling) {
      this.#selling = false;
      this.#rebuild();
      return;
    }
    this.services.navigate(this.#from);
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "market" });
    super.render(context);
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.root.clear();
    const back = this.#buildHeader();
    const listPanel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.left.x, y: this.#screen.columns.top, width: this.#screen.columns.left.width, height: this.#screen.columns.height }));
    const firstTab = this.#buildTabs(listPanel);
    if (this.#tab === Tab.MINE && this.#signedIn()) {
      this.#buildMine(listPanel);
    } else {
      this.#buildBoard(listPanel);
    }
    const detailPanel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.right.x, y: this.#screen.columns.top, width: this.#screen.columns.right.width, height: this.#screen.columns.height }));
    this.#buildDetail(detailPanel);
    this.focus(this.root.findById(focusedId) ?? firstTab ?? back);
    this.services.requestRender();
  }

  #buildHeader() {
    const { viewport } = this.services;
    const state = this.#sales().state;
    const title = this.#m.title;
    this.root.add(new Label({ x: this.#screen.header.sideMargin, y: this.#screen.header.y, width: title, height: this.#screen.header.height, text: "Market", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const intro = this.#signedIn() ? "Cards sold by players. You pay the seller directly from your wallet; the card is yours once the chain confirms it." : "Cards sold by players, for STEEM. Sign in to buy or sell.";
    const message = state.error ?? state.notice ?? intro;
    const buttons = this.#signedIn() ? 2 : 1;
    const statusX = this.#screen.header.sideMargin + Math.min(200, title);
    this.root.add(new Label({ id: "market.status", x: statusX, y: this.#screen.header.y, width: viewport.logicalWidth - this.#screen.header.sideMargin - buttons * (this.#screen.header.backWidth + 16) - statusX, height: this.#screen.header.height, text: message, size: "small", colorKey: state.error === null ? "textMuted" : "danger", align: "left", fit: true }));
    if (this.#signedIn()) {
      this.root.add(new Button({ id: "market.sell", x: viewport.logicalWidth - this.#screen.header.sideMargin - 2 * this.#screen.header.backWidth - 16, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: this.#sellButtonText(), enabled: !this.#buyingBusy(), onActivate: () => this.#toggleSelling() }));
    }
    return this.root.add(new Button({ id: "market.back", x: viewport.logicalWidth - this.#screen.header.sideMargin - this.#screen.header.backWidth, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: "Back", onActivate: () => this.services.navigate(this.#from) }));
  }

  /**
   * @param {Panel} panel
   * @returns {Button | null} the first tab
   */
  #buildTabs(panel) {
    /** @type {{ tab: MarketTab, text: string }[]} */
    const tabs = [
      { tab: Tab.BOARD, text: "Board" },
      ...(this.#signedIn() ? [{ tab: Tab.MINE, text: "My sales & purchases" }] : []),
    ];
    const width = (this.#screen.columns.left.width - 2 * this.#screen.inset - (tabs.length - 1) * this.#m.tabs.gap) / tabs.length;
    /** @type {Button | null} */
    let first = null;
    tabs.forEach(({ tab, text }, index) => {
      const button = panel.add(new Button({ id: `market.tab.${tab}`, x: this.#screen.inset + index * (width + this.#m.tabs.gap), y: this.#m.tabs.top, width, height: this.#m.tabs.height, text, variant: this.#tab === tab ? "primary" : "secondary", onActivate: () => this.#switchTab(tab) }));
      first ??= button;
    });
    return first;
  }

  /** @param {Panel} panel */
  #buildBoard(panel) {
    const sales = this.#sales();
    const { listings, loading, total, pageSize, filter } = sales.state;
    const width = this.#screen.columns.left.width - 2 * this.#screen.inset;
    const sortWidth = this.#m.sorts.width;
    [
      { sort: /** @type {const} */ ("newest"), text: "Newest" },
      { sort: /** @type {const} */ ("cheapest"), text: "Cheapest" },
    ].forEach(({ sort, text }, index) => {
      panel.add(new Button({ id: `market.sort.${sort}`, x: this.#screen.inset + index * (sortWidth + this.#m.sorts.gap), y: this.#m.sorts.top, width: sortWidth, height: this.#m.sorts.height, text, textSize: "small", variant: filter.sort === sort ? "primary" : "secondary", onActivate: () => sales.loadBoard({ sort, offset: 0 }) }));
    });
    const cardFilter = { id: "market.filter", filter: this.#boardFilter, options: cardFilterOptions(this.#app), onChange: (/** @type {import("../../application/content/CardFilter.js").CardFilter} */ next) => this.#changeBoardFilter(next) };
    if (this.#m.filterButton) {
      // Beside the two sorts, on their row.
      const x = this.#screen.inset + 2 * (sortWidth + this.#m.sorts.gap);
      buildCardFilterButton(panel, { ...cardFilter, x, y: this.#m.filterTop, width: this.#screen.inset + width - x, dialog: this.#dialog() });
    } else {
      buildCardFilterBar(panel, { ...cardFilter, x: this.#screen.inset, y: this.#m.filterTop, width });
    }
    const pages = total > pageSize;
    const list = panel.add(new ScrollList({ id: "market.board", x: this.#screen.inset, y: this.#m.listTop, width, height: this.#screen.columns.height - this.#m.listTop - this.#screen.inset - (pages ? this.#m.pager + 8 : 0) }));
    if (listings.length === 0) {
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * this.#screen.row.height, text: loading ? "Loading…" : this.#emptyBoardText(), size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * this.#screen.row.height;
    } else {
      const meta = this.#m.metaWidth > 0;
      const stripWidth = list.rowWidth - this.#m.priceWidth - (meta ? this.#m.metaWidth + this.#screen.action.gap : 0) - this.#screen.action.gap;
      listings.forEach((listing, index) => {
        const card = this.#app.content.catalog.get(listing.card.definitionId);
        const selected = this.#selected?.kind === "listing" && this.#selected.id === listing.id;
        const rowTop = this.#screen.rowY(index);
        const rowHeight = this.#screen.row.height;
        list.add(new CardStrip({ x: 0, y: rowTop, width: stripWidth, height: rowHeight, card: card ?? unknownCard(listing.card.definitionId), broken: card === undefined, muted: !selected, rarity: rarityOf(this.#app, listing.card.definitionId) }));
        const metaX = stripWidth + this.#screen.action.gap;
        if (meta) {
          const copy = `#${listing.card.serial}`;
          const { metaWidth, sellerAvatar } = this.#m;
          list.add(new AvatarNode({ id: `market.seller.${listing.id}`, x: metaX, y: rowTop + (rowHeight - sellerAvatar) / 2, size: sellerAvatar, account: listing.seller }));
          const textX = metaX + sellerAvatar + 10;
          const textWidth = metaWidth - sellerAvatar - 10;
          list.add(new Label({ x: textX, y: rowTop + 4, width: textWidth, height: rowHeight / 2 - 4, text: `@${listing.seller}`, size: "small", colorKey: "text", align: "left", fit: true }));
          list.add(new Label({ x: textX, y: rowTop + rowHeight / 2, width: textWidth, height: rowHeight / 2 - 4, text: copy, size: "tiny", colorKey: "textMuted", align: "left", fit: true }));
        }
        const text = listing.reserved ? "reserved" : `${listing.price.amount} ${listing.price.asset}`;
        list.add(new Button({ id: `market.listing.${listing.id}`, x: meta ? metaX + this.#m.metaWidth + this.#screen.action.gap : metaX, y: this.#screen.rowY(index), width: this.#m.priceWidth, height: this.#screen.row.height, text, textSize: "small", variant: selected ? "primary" : "secondary", onActivate: () => this.#select("listing", listing.id) }));
      });
      list.contentHeight = this.#screen.rowsHeight(listings.length);
    }
    if (pages) {
      this.#buildPager(panel, width);
    }
  }

  #emptyBoardText() {
    return isFiltering(this.#boardFilter) ? `No ${describeCardFilter(this.#boardFilter)} cards on sale right now.` : "Nothing on sale yet. Sell one of your cards: other players will see it here.";
  }

  /**
   * @param {Panel} panel
   * @param {number} width
   */
  #buildPager(panel, width) {
    const sales = this.#sales();
    const { total, pageSize, filter } = sales.state;
    const y = this.#screen.columns.height - this.#screen.inset - this.#m.pager;
    const third = (width - 16) / 3;
    const page = Math.floor(filter.offset / pageSize) + 1;
    panel.add(new Button({ id: "market.page.previous", x: this.#screen.inset, y, width: third, height: this.#m.pager, text: "Previous", textSize: "small", enabled: filter.offset > 0, onActivate: () => sales.loadBoard({ offset: Math.max(0, filter.offset - pageSize) }) }));
    panel.add(new Label({ x: this.#screen.inset + third + 8, y, width: third, height: this.#m.pager, text: `page ${page} of ${Math.ceil(total / pageSize)}`, size: "small", colorKey: "textMuted" }));
    panel.add(new Button({ id: "market.page.next", x: this.#screen.inset + 2 * (third + 8), y, width: third, height: this.#m.pager, text: "Next", textSize: "small", enabled: filter.offset + pageSize < total, onActivate: () => sales.loadBoard({ offset: filter.offset + pageSize }) }));
  }

  /** @param {Panel} panel */
  #buildMine(panel) {
    const { listings, purchases } = this.#sales().state.mine;
    const list = panel.add(new ScrollList({ id: "market.mine", x: this.#screen.inset, y: this.#m.tabs.top + this.#m.tabs.height + 12, width: this.#screen.columns.left.width - 2 * this.#screen.inset, height: this.#screen.columns.height - this.#m.tabs.top - this.#m.tabs.height - 12 - this.#screen.inset }));
    const now = this.#now();
    // Each row shows the other side when there is one: the buyer of a sold card, the seller of a bought one.
    const rows = [
      ...listings.map((listing) => ({ kind: /** @type {const} */ ("listing"), id: listing.id, card: listing.card, price: listing.price, activity: saleActivity(listing, now) })),
      ...purchases.map((purchase) => ({ kind: /** @type {const} */ ("purchase"), id: purchase.id, card: purchase.card, price: purchase.price, activity: purchaseActivity(purchase) })),
    ];
    if (rows.length === 0) {
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * this.#screen.row.height, text: "You have not sold or bought anything yet.", size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * this.#screen.row.height;
      return;
    }
    rows.forEach((row, index) => this.#buildActivityRow(list, row, index));
    list.contentHeight = this.#screen.rowsHeight(rows.length);
  }

  /**
   * One of the player's sales or purchases, laid out like the board: the card's strip, who and how it stands, the price
   * (the row's button). A phone has no room for the middle column: what happened becomes the strip's badge.
   * @param {ScrollList} list
   * @param {{ kind: "listing" | "purchase", id: string, card: import("../../application/ports/SalesApi.contract.js").ListedCard, price: { amount: string, asset: string }, activity: Activity }} row
   * @param {number} index
   */
  #buildActivityRow(list, { kind, id, card: listed, price, activity }, index) {
    const selected = this.#selected?.kind === kind && this.#selected.id === id;
    const select = () => this.#select(kind, id);
    const top = this.#screen.rowY(index);
    const height = this.#screen.row.height;
    const { gap } = this.#screen.action;
    const { metaWidth, sellerAvatar, priceWidth } = this.#m;
    const meta = metaWidth > 0;
    const stripWidth = list.rowWidth - priceWidth - (meta ? metaWidth + gap : 0) - gap;
    const card = this.#app.content.catalog.get(listed.definitionId);
    list.add(new CardStrip({ x: 0, y: top, width: stripWidth, height, card: card ?? unknownCard(listed.definitionId), broken: card === undefined, rarity: rarityOf(this.#app, listed.definitionId), badge: meta ? `#${listed.serial}` : activity.verb, selected, muted: activity.closed && !selected }));
    const metaX = stripWidth + gap;
    if (meta) {
      list.add(new AvatarNode({ id: `market.mine.who.${id}`, x: metaX, y: top + (height - sellerAvatar) / 2, size: sellerAvatar, account: activity.avatar }));
      const textX = metaX + sellerAvatar + 10;
      const textWidth = metaWidth - sellerAvatar - 10;
      list.add(new Label({ x: textX, y: top + 4, width: textWidth, height: height / 2 - 4, text: activity.verb, size: "small", weight: "bold", colorKey: activity.colorKey, align: "left", fit: true }));
      list.add(new Label({ x: textX, y: top + height / 2, width: textWidth, height: height / 2 - 4, text: activity.detail, size: "tiny", colorKey: "textMuted", align: "left", fit: true }));
    }
    // The whole row picks it, as the price does; only the price takes the keyboard's focus.
    const area = list.add(new Hotspot({ x: 0, y: top, width: meta ? metaX + metaWidth : stripWidth, height, onActivate: select }));
    area.focusable = false;
    list.add(new Button({ id: `market.mine.${id}`, x: meta ? metaX + metaWidth + gap : metaX, y: top, width: priceWidth, height, text: `${price.amount} ${price.asset}`, textSize: "small", variant: selected ? "primary" : "secondary", onActivate: select }));
  }

  /** @param {Panel} panel */
  #buildDetail(panel) {
    const { buying } = this.#sales().state;
    if (buying.stage !== BuyStage.NONE) {
      this.#buildBuying(panel, buying);
      return;
    }
    if (this.#selling) {
      this.#buildComposer(panel);
      return;
    }
    const listing = this.#selectedListing();
    if (listing !== undefined) {
      this.#buildListing(panel, listing);
      return;
    }
    const purchase = this.#selected?.kind === "purchase" ? this.#sales().state.mine.purchases.find((candidate) => candidate.id === this.#selected?.id) : undefined;
    if (purchase !== undefined) {
      this.#buildPurchase(panel, purchase);
      return;
    }
    panel.add(new TextBlock({ x: this.#screen.inset, y: 20, width: this.#screen.columns.right.width - 2 * this.#screen.inset, height: 90, text: "Pick a card on the board to see it and buy it. Players set their own prices; the money goes straight to them.", size: "body", colorKey: "textMuted" }));
  }

  /**
   * The card at full size, and lines of text beside it (its rarity after the first, the name; a line about a player leads with their portrait); returns the x and width of the text column.
   * @param {Panel} panel
   * @param {string} definitionId
   * @param {readonly { text: string, colorKey?: string, bold?: boolean, avatar?: string | null }[]} named
   */
  #cardWithLines(panel, definitionId, named) {
    const card = this.#app.content.catalog.get(definitionId);
    const rarity = rarityOf(this.#app, definitionId);
    if (card !== undefined) {
      const area = { x: this.#screen.inset, y: this.#screen.inset, width: this.#m.card.width, height: this.#m.card.height };
      panel.add(new CardDetail({ id: "market.card", ...area, card, rarity }));
      if (this.#screen.compact) {
        // Too small to read here: a tap shows it whole.
        panel.add(new Hotspot({ id: "market.cardInfo", ...area, onActivate: () => this.#showCardInfo(definitionId, []) }));
      }
    }
    const lines = [...named.slice(0, 1), { text: rarity === null ? "Rarity unknown" : rarityLabel(rarity), colorKey: rarityColorKey(rarity), bold: true }, ...named.slice(1)];
    const x = this.#screen.inset + this.#m.card.width + this.#screen.inset;
    const width = this.#screen.columns.right.width - x - this.#screen.inset;
    lines.forEach((line, index) => {
      panel.add(new Label({ x, y: this.#screen.inset + index * this.#m.line, width, height: this.#m.line, text: line.text, size: line.bold === true ? "body" : "small", weight: line.bold === true ? "bold" : "normal", colorKey: line.colorKey ?? "text", align: "left", fit: true, avatar: line.avatar ?? null }));
    });
    return { x, width };
  }

  /**
   * @param {Panel} panel
   * @param {import("../../application/ports/SalesApi.contract.js").Listing} listing
   */
  #buildListing(panel, listing) {
    const sales = this.#sales();
    const account = this.#app.account?.state.account ?? null;
    const own = account === listing.seller;
    const now = this.#now();
    const buyable = account !== null && !own && listing.status === "ACTIVE";
    const lines = [
      { text: this.#cardName(listing.card.definitionId), bold: true, colorKey: "accentLight" },
      { text: copyLabel(listing.card) },
      { text: `Sold by @${listing.seller}`, avatar: listing.seller },
      { text: `${listing.price.amount} ${listing.price.asset}`, bold: true, colorKey: "accent" },
      { text: listingSubtitle(listing, now), colorKey: "textMuted", avatar: listing.status === "SOLD" ? listing.buyer : null },
      ...(buyable ? [this.#budgetLine(listing.price)] : []),
    ];
    this.#cardWithLines(panel, listing.card.definitionId, lines);
    const y = this.#screen.columns.height - this.#screen.inset - this.#m.button;
    const fullWidth = this.#screen.columns.right.width - 2 * this.#screen.inset;
    if (listing.status !== "ACTIVE") {
      return;
    }
    if (own) {
      panel.add(new Button({ id: "market.withdraw", x: this.#screen.inset, y, width: fullWidth, height: this.#m.button, text: listing.reserved ? "A buyer is paying: wait before withdrawing" : "Withdraw from the board", variant: "danger", enabled: !listing.reserved && !sales.state.busy, onActivate: () => sales.withdraw(listing.id) }));
      return;
    }
    if (account === null) {
      panel.add(new Button({ id: "market.signIn", x: this.#screen.inset, y, width: fullWidth, height: this.#m.button, text: "Sign in to buy", enabled: this.services.hasScene(SceneId.LOGIN), onActivate: () => this.services.navigate(SceneId.LOGIN) }));
      return;
    }
    this.#buildBuy(panel, listing, { y, width: fullWidth });
  }

  /**
   * Buy, unless someone else is paying for the card or the buyer's wallet cannot.
   * @param {Panel} panel
   * @param {import("../../application/ports/SalesApi.contract.js").Listing} listing
   * @param {{ y: number, width: number }} place
   */
  #buildBuy(panel, listing, { y, width }) {
    const { amount, asset } = listing.price;
    const short = this.#isShort(listing.price);
    let text = `Buy for ${amount} ${asset}`;
    if (listing.reserved) {
      text = "Someone is buying it: try again in a few minutes";
    } else if (short) {
      text = `Not enough ${asset} in your wallet`;
    }
    panel.add(new Button({ id: "market.buy", x: this.#screen.inset, y, width, height: this.#m.button, text, variant: "primary", enabled: !listing.reserved && !short && !this.#buyingBusy(), onActivate: () => this.#sales().buy(listing.id) }));
  }

  /** @param {Readonly<{ amount: string, asset: string }>} price */
  #isShort({ amount, asset }) {
    return this.#app.balance?.isShort(amount, asset) ?? false;
  }

  /**
   * The buyer's budget beside a card on sale, as far as it is known; in red when it cannot pay `price`.
   * @param {Readonly<{ amount: string, asset: string }>} price
   * @returns {{ text: string, colorKey: string, bold: boolean, avatar: null }}
   */
  #budgetLine(price) {
    const balance = this.#app.balance;
    const amount = balance?.amountOf(price.asset) ?? null;
    if (amount !== null) {
      return { text: `Your budget: ${amount} ${price.asset}`, colorKey: this.#isShort(price) ? "danger" : "accentLight", bold: true, avatar: null };
    }
    const text = balance === undefined || balance.state.loading ? "Reading your wallet…" : "Your budget is not known";
    return { text, colorKey: "textMuted", bold: false, avatar: null };
  }

  /**
   * @param {Panel} panel
   * @param {import("../../application/ports/SalesApi.contract.js").Purchase} purchase
   */
  #buildPurchase(panel, purchase) {
    const lines = [
      { text: this.#cardName(purchase.card.definitionId), bold: true, colorKey: "accentLight" },
      { text: `Copy #${purchase.card.serial}` },
      { text: `From @${purchase.seller} for ${purchase.price.amount} ${purchase.price.asset}`, avatar: purchase.seller },
      { text: `Status: ${purchase.status.toLowerCase()}`, bold: true },
      ...(purchase.txId === null ? [] : [{ text: `Payment ${purchase.txId.slice(0, 12)}…`, colorKey: "textMuted" }]),
      ...(purchase.problem === null ? [] : [{ text: problemText(purchase.problem), colorKey: "danger" }]),
    ];
    this.#cardWithLines(panel, purchase.card.definitionId, lines);
  }

  /**
   * The purchase in progress: what is happening and what the buyer can do.
   * @param {Panel} panel
   * @param {import("../../application/sales/SalesService.js").Buying} buying
   */
  #buildBuying(panel, buying) {
    const sales = this.#sales();
    const { purchase, stage, error } = buying;
    const fullWidth = this.#screen.columns.right.width - 2 * this.#screen.inset;
    if (purchase === null) {
      panel.add(new TextBlock({ id: "market.buying", x: this.#screen.inset, y: this.#screen.inset, width: fullWidth, height: 90, text: error?.message ?? STAGE_TEXT[BuyStage.RESERVING](), size: "body", colorKey: error === null ? "text" : "danger" }));
      panel.add(new Button({ id: "market.buying.close", x: this.#screen.inset, y: this.#screen.columns.height - this.#screen.inset - this.#m.button, width: fullWidth, height: this.#m.button, text: "Close", enabled: stage === BuyStage.FAILED, onActivate: () => sales.dismiss() }));
      return;
    }
    const { x, width } = this.#cardWithLines(panel, purchase.card.definitionId, this.#buyingLines(purchase));
    panel.add(new TextBlock({ id: "market.buying", x, y: this.#screen.inset + 6 * this.#m.line, width, height: 4 * this.#m.line, text: stageText(stage, purchase, error, this.#app), size: "small", colorKey: error === null ? "text" : "danger" }));
    if (purchase.problem !== null && stage !== BuyStage.DONE) {
      panel.add(new TextBlock({ x, y: this.#screen.inset + 10 * this.#m.line, width, height: 3 * this.#m.line, text: `Note: ${problemText(purchase.problem)}.`, size: "small", colorKey: "danger" }));
    }
    this.#buildBuyingActions(panel, buying, fullWidth);
  }

  /**
   * What the buyer is buying, beside the card.
   * @param {import("../../application/ports/SalesApi.contract.js").Purchase} purchase
   */
  #buyingLines(purchase) {
    /** @type {{ text: string, colorKey?: string, bold?: boolean, avatar?: string | null }[]} */
    const lines = [
      { text: this.#cardName(purchase.card.definitionId), bold: true, colorKey: "accentLight" },
      { text: `Copy #${purchase.card.serial}` },
      { text: `From @${purchase.seller}`, avatar: purchase.seller },
      { text: `${purchase.price.amount} ${purchase.price.asset}`, bold: true, colorKey: "accent" },
    ];
    if (purchase.payment !== null) {
      const minutes = Math.max(0, Math.ceil((purchase.payment.expiresAt - this.#now()) / MINUTE));
      lines.push({ text: `Reserved for you: ${minutes} min left to pay`, colorKey: "textMuted" });
    }
    return lines;
  }

  /**
   * @param {Panel} panel
   * @param {import("../../application/sales/SalesService.js").Buying} buying
   * @param {number} width
   */
  #buildBuyingActions(panel, { purchase, stage }, width) {
    const sales = this.#sales();
    const y = this.#screen.columns.height - this.#screen.inset - this.#m.button;
    const payable = stage === BuyStage.FAILED && purchase?.payment !== null && purchase?.payment !== undefined;
    if (stage === BuyStage.DONE && this.#buildBoughtActions(panel, purchase, width, y)) {
      return;
    }
    if (!payable) {
      const closable = !BUSY_BUY_STAGES.includes(stage) || sales.state.buying.error !== null;
      panel.add(new Button({ id: "market.buying.close", x: this.#screen.inset, y, width, height: this.#m.button, text: stage === BuyStage.DONE ? "Done" : "Close", variant: stage === BuyStage.DONE ? "primary" : "secondary", enabled: closable, onActivate: () => sales.dismiss() }));
      return;
    }
    const half = (width - 16) / 2;
    panel.add(new Button({ id: "market.buying.pay", x: this.#screen.inset, y, width: half, height: this.#m.button, text: "Pay again", variant: "primary", onActivate: () => sales.payAgain() }));
    panel.add(new Button({ id: "market.buying.release", x: this.#screen.inset + half + 16, y, width: half, height: this.#m.button, text: "Give up this card", onActivate: () => sales.release() }));
  }

  /**
   * A card bought: it can be seen lit in the collection, as from a notification.
   * @param {Panel} panel
   * @param {import("../../application/ports/SalesApi.contract.js").Purchase | null | undefined} purchase
   * @param {number} width
   * @param {number} y
   * @returns {boolean} whether the actions were built (not without the purchase or the collection)
   */
  #buildBoughtActions(panel, purchase, width, y) {
    if (purchase === null || purchase === undefined || !this.services.hasScene(SceneId.COLLECTION)) {
      return false;
    }
    const sales = this.#sales();
    const half = (width - 16) / 2;
    const fresh = [Object.freeze({ definitionId: purchase.card.definitionId, count: 1, serial: purchase.card.serial })];
    const view = () => {
      sales.dismiss();
      this.services.navigate(SceneId.COLLECTION, { fresh, from: SceneId.MARKET });
    };
    panel.add(new Button({ id: "market.buying.collection", x: this.#screen.inset, y, width: half, height: this.#m.button, text: "View collection", variant: "primary", onActivate: view }));
    panel.add(new Button({ id: "market.buying.close", x: this.#screen.inset + half + 16, y, width: half, height: this.#m.button, text: "Done", onActivate: () => sales.dismiss() }));
    return true;
  }

  /** @param {Panel} panel */
  #buildComposer(panel) {
    const sales = this.#sales();
    const width = this.#screen.columns.right.width - 2 * this.#screen.inset;
    const gap = this.#screen.compact ? 6 : 12;
    panel.add(new Label({ x: this.#screen.inset, y: this.#screen.compact ? 8 : 14, width, height: 28, text: "Pick the copy to sell", size: "small", weight: "bold", colorKey: "accent", align: "left" }));
    const bottom = this.#screen.columns.height - this.#screen.inset - this.#m.button - gap - this.#m.priceField - gap;
    const filter = { id: "market.sellFilter", x: this.#screen.inset, y: this.#m.composerFilterTop, width, filter: this.#sellFilter, options: cardFilterOptions(this.#app), onChange: (/** @type {import("../../application/content/CardFilter.js").CardFilter} */ next) => this.#changeSellFilter(next) };
    if (this.#m.filterButton) {
      buildCardFilterButton(panel, { ...filter, dialog: this.#dialog() });
    } else {
      buildCardFilterBar(panel, filter);
    }
    const list = panel.add(new ScrollList({ id: "market.copies", x: this.#screen.inset, y: this.#m.copiesTop, width, height: bottom - this.#m.copiesTop }));
    const copies = this.#sellableCopies().filter((copy) => matchesCardFilter(this.#sellFilter, this.#app.content.catalog.get(copy.definitionId), rarityOf(this.#app, copy.definitionId)));
    if (!copies.some((copy) => copy.id === this.#copy)) {
      this.#copy = null;
    }
    if (copies.length === 0) {
      const text = isFiltering(this.#sellFilter) ? `No ${describeCardFilter(this.#sellFilter)} cards to sell.` : "No card to sell: cards already on the board or in a trade cannot be listed again.";
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 3 * this.#screen.row.height, text, size: "small", colorKey: "textMuted" }));
      list.contentHeight = 3 * this.#screen.row.height;
    } else {
      const rowWidth = list.rowWidth - this.#screen.action.width - this.#screen.action.gap;
      copies.forEach((copy, index) => {
        const card = this.#app.content.catalog.get(copy.definitionId);
        list.add(new CardOption({ id: `market.copy.${copy.id}`, x: 0, y: this.#screen.rowY(index), width: rowWidth, height: this.#screen.row.height, card: card ?? unknownCard(copy.definitionId), broken: card === undefined, rarity: rarityOf(this.#app, copy.definitionId), badge: `#${copy.serial}`, selected: copy.id === this.#copy, onActivate: () => this.#pickCopy(copy.id) }));
        list.add(new Button({ id: `market.copy.info.${copy.id}`, x: rowWidth + this.#screen.action.gap, y: this.#screen.rowY(index), width: this.#screen.action.width, height: this.#screen.row.height, text: "Info", textSize: "small", enabled: this.#app.content.catalog.has(copy.definitionId), onActivate: () => this.#showCardInfo(copy.definitionId, [`Copy #${copy.serial}`]) }));
      });
      list.contentHeight = this.#screen.rowsHeight(copies.length);
    }
    panel.add(new TextField({ id: "market.price", x: this.#screen.inset, y: bottom + gap, width, height: this.#m.priceField, value: this.#price, placeholder: `Price in ${sales.asset}, e.g. 1.5`, maxLength: 10, keyboard: "decimal", onChange: (value) => this.#changePrice(value) }));
    panel.add(new Button({ id: "market.list", x: this.#screen.inset, y: this.#screen.columns.height - this.#screen.inset - this.#m.button, width, height: this.#m.button, text: this.#listText(), variant: "primary", enabled: this.#canList(), onActivate: () => this.#list() }));
  }

  #listText() {
    return PRICE_PATTERN.test(this.#price) ? `Sell for ${this.#price} ${this.#sales().asset}` : "Sell";
  }

  #canList() {
    return this.#copy !== null && PRICE_PATTERN.test(this.#price) && Number(this.#price) > 0 && !this.#sales().state.busy;
  }

  /** The player's copies that may be listed: tradeable, and not on the board or in a trade already. */
  #sellableCopies() {
    const cards = this.#app.account?.collection.state.cards ?? [];
    return cards.flatMap((entry) => entry.copies.filter((copy) => copy.tradeable === true && copy.status === "active").map((copy) => ({ ...copy, definitionId: entry.definitionId })));
  }

  /** @param {string} copyId */
  #pickCopy(copyId) {
    this.#copy = this.#copy === copyId ? null : copyId;
    this.#rebuild();
  }

  /** @param {string} value */
  #changePrice(value) {
    this.#price = value.trim().replace(",", ".");
    const button = this.root.findById("market.list");
    if (button instanceof Button) {
      button.enabled = this.#canList();
      button.text = this.#listText();
    }
    this.services.requestRender();
  }

  async #list() {
    if (this.#copy === null) {
      return;
    }
    if (await this.#sales().sell({ copy: this.#copy, price: this.#price })) {
      this.#selling = false;
      this.#copy = null;
      this.#price = "";
      this.#tab = Tab.MINE;
      this.#selected = null;
      this.#rebuild();
    }
  }

  /** @param {import("../../application/content/CardFilter.js").CardFilter} next */
  #changeBoardFilter(next) {
    this.#boardFilter = next;
    this.#sales().loadBoard({ cards: cardIdsMatching(next, this.#app), offset: 0 });
  }

  /** @param {import("../../application/content/CardFilter.js").CardFilter} next */
  #changeSellFilter(next) {
    this.#sellFilter = next;
    this.#rebuild();
  }

  #toggleSelling() {
    this.#selling = !this.#selling;
    this.#rebuild();
  }

  /** @param {MarketTab} tab */
  #switchTab(tab) {
    this.#tab = tab;
    this.#selected = null;
    const sales = this.#sales();
    if (tab === Tab.MINE) {
      sales.refreshMine();
    }
    this.#rebuild();
  }

  /**
   * @param {"listing" | "purchase"} kind
   * @param {string} id
   */
  #select(kind, id) {
    this.#selected = { kind, id };
    this.#selling = false;
    this.#rebuild();
  }

  #selectedListing() {
    if (this.#selected?.kind !== "listing") {
      return undefined;
    }
    const { listings, mine } = this.#sales().state;
    const id = this.#selected.id;
    return listings.find((candidate) => candidate.id === id) ?? mine.listings.find((candidate) => candidate.id === id);
  }

  /**
   * @param {string} definitionId
   * @param {readonly string[]} lines
   */
  #showCardInfo(definitionId, lines) {
    const card = this.#app.content.catalog.get(definitionId);
    if (card !== undefined) {
      this.openModal(buildCardInfoModal({ viewport: this.services.viewport, card, rarity: rarityOf(this.#app, definitionId), lines, onClose: () => this.closeModal() }));
    }
  }

  /** The header's toggle between the board and the composer; a phone's header has room for a word. */
  #sellButtonText() {
    if (this.#screen.compact) {
      return this.#selling ? "Board" : "Sell";
    }
    return this.#selling ? "Back to the board" : "Sell a card";
  }

  /** How the card filter opens its dialog on a compact screen. */
  #dialog() {
    return { viewport: this.services.viewport, open: (/** @type {import("../ui/Modal.js").Modal} */ modal) => this.openModal(modal), close: () => this.closeModal() };
  }

  #cardName(definitionId) {
    return this.#app.content.catalog.get(definitionId)?.name ?? definitionId;
  }

  #signedIn() {
    return this.#app.account !== undefined && this.#app.account.state.account !== null;
  }

  #buyingBusy() {
    return BUSY_BUY_STAGES.includes(this.#sales().state.buying.stage);
  }

  #sales() {
    if (this.#app.sales === undefined) {
      throw new Error("MarketScene needs the sales service");
    }
    return this.#app.sales;
  }
}
