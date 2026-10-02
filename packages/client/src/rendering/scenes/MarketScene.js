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
 * Every price and status shown is the server's.
 */
import { NO_CARD_FILTER, cardFilterOptions, cardIdsMatching, describeCardFilter, isFiltering, matchesCardFilter } from "../../application/content/CardFilter.js";
import { BUSY_BUY_STAGES, BuyStage, PROBLEM_TEXT } from "../../application/sales/SalesService.js";
import { CARD_FILTER_BAR_HEIGHT, buildCardFilterBar } from "../cards/cardFilterBar.js";
import { CardDetail } from "../cards/CardDetail.js";
import { CardStrip } from "../cards/CardStrip.js";
import { buildCardInfoModal, rarityOf } from "../cards/cardInfo.js";
import { rarityColorKey, rarityLabel } from "../theme/rarity.js";
import { unknownCard } from "../cards/unknownCard.js";
import { AvatarNode } from "../ui/AvatarNode.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { TextField } from "../ui/TextField.js";
import { ACTION, COLUMNS, HEADER, INSET, ROW, rowY, rowsHeight } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const LINE = 30;
const TABS = Object.freeze({ top: 20, height: 40, gap: 8 });
const SORTS = Object.freeze({ top: 70, height: 38, gap: 6 });
const FILTER_TOP = SORTS.top + SORTS.height + 10;
const LIST_TOP = FILTER_TOP + CARD_FILTER_BAR_HEIGHT + 12;
/** The composer's list of copies, below its title and filter. */
const COPIES_TOP = 48 + CARD_FILTER_BAR_HEIGHT + 12;
const PAGER_HEIGHT = 44;
const PRICE_WIDTH = 170;
const META_WIDTH = 190;
/** The seller's portrait at the start of a board row's meta column. */
const SELLER_AVATAR = 40;
const CARD = Object.freeze({ width: 300, height: 442 });
const BUTTON_HEIGHT = 56;
const PRICE_PATTERN = /^\d{1,6}(\.\d{1,3})?$/;
const Tab = Object.freeze({ BOARD: "board", MINE: "mine" });
/** @typedef {typeof Tab[keyof typeof Tab]} MarketTab */

/** What the buyer sees at each step of a purchase. */
const STAGE_TEXT = Object.freeze({
  [BuyStage.RESERVING]: () => "Reserving the card for you…",
  [BuyStage.SIGNING]: (purchase) => `Approve the transfer in Keychain: ${purchase.payment.amount} ${purchase.payment.asset} to @${purchase.payment.to}, the seller.`,
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
 * What is happening to a purchase in progress, or what went wrong.
 * @param {string} stage
 * @param {import("../../application/ports/SalesApi.contract.js").Purchase} purchase
 * @param {Readonly<{ message: string }> | null} error
 */
function stageText(stage, purchase, error) {
  const describe = STAGE_TEXT[/** @type {keyof typeof STAGE_TEXT} */ (stage)];
  return error?.message ?? (describe === undefined ? "" : describe(purchase));
}

/** @param {string} problem */
const problemText = (problem) => PROBLEM_TEXT[/** @type {keyof typeof PROBLEM_TEXT} */ (problem)] ?? problem;

export class MarketScene extends Scene {
  #app;
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
    this.#unsubscribe = () => {
      unsubscribe();
      unwatch();
    };
    sales.loadBoard({ cards: cardIdsMatching(this.#boardFilter, this.#app) });
    sales.refreshMine();
    this.#rebuild();
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.exit();
  }

  onCancel() {
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
    const listPanel = this.root.add(new Panel({ x: COLUMNS.left.x, y: COLUMNS.top, width: COLUMNS.left.width, height: COLUMNS.height }));
    const firstTab = this.#buildTabs(listPanel);
    if (this.#tab === Tab.MINE && this.#signedIn()) {
      this.#buildMine(listPanel);
    } else {
      this.#buildBoard(listPanel);
    }
    const detailPanel = this.root.add(new Panel({ x: COLUMNS.right.x, y: COLUMNS.top, width: COLUMNS.right.width, height: COLUMNS.height }));
    this.#buildDetail(detailPanel);
    this.focus(this.root.findById(focusedId) ?? firstTab ?? back);
    this.services.requestRender();
  }

  #buildHeader() {
    const { viewport } = this.services;
    const state = this.#sales().state;
    this.root.add(new Label({ x: HEADER.sideMargin, y: HEADER.y, width: 220, height: HEADER.height, text: "Market", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const intro = this.#signedIn() ? "Cards sold by players. You pay the seller directly from your wallet; the card is yours once the chain confirms it." : "Cards sold by players, for STEEM. Sign in with Keychain to buy or sell.";
    const message = state.error ?? state.notice ?? intro;
    const buttons = this.#signedIn() ? 2 : 1;
    this.root.add(new Label({ id: "market.status", x: HEADER.sideMargin + 200, y: HEADER.y, width: viewport.logicalWidth - 2 * HEADER.sideMargin - buttons * (HEADER.backWidth + 16) - 200, height: HEADER.height, text: message, size: "small", colorKey: state.error === null ? "textMuted" : "danger", align: "left", fit: true }));
    if (this.#signedIn()) {
      this.root.add(new Button({ id: "market.sell", x: viewport.logicalWidth - HEADER.sideMargin - 2 * HEADER.backWidth - 16, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: this.#selling ? "Back to the board" : "Sell a card", enabled: !this.#buyingBusy(), onActivate: () => this.#toggleSelling() }));
    }
    return this.root.add(new Button({ id: "market.back", x: viewport.logicalWidth - HEADER.sideMargin - HEADER.backWidth, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: "Back", onActivate: () => this.services.navigate(this.#from) }));
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
    const width = (COLUMNS.left.width - 2 * INSET - (tabs.length - 1) * TABS.gap) / tabs.length;
    /** @type {Button | null} */
    let first = null;
    tabs.forEach(({ tab, text }, index) => {
      const button = panel.add(new Button({ id: `market.tab.${tab}`, x: INSET + index * (width + TABS.gap), y: TABS.top, width, height: TABS.height, text, variant: this.#tab === tab ? "primary" : "secondary", onActivate: () => this.#switchTab(tab) }));
      first ??= button;
    });
    return first;
  }

  /** @param {Panel} panel */
  #buildBoard(panel) {
    const sales = this.#sales();
    const { listings, loading, total, pageSize, filter } = sales.state;
    const width = COLUMNS.left.width - 2 * INSET;
    const sortWidth = 150;
    [
      { sort: /** @type {const} */ ("newest"), text: "Newest" },
      { sort: /** @type {const} */ ("cheapest"), text: "Cheapest" },
    ].forEach(({ sort, text }, index) => {
      panel.add(new Button({ id: `market.sort.${sort}`, x: INSET + index * (sortWidth + SORTS.gap), y: SORTS.top, width: sortWidth, height: SORTS.height, text, textSize: "small", variant: filter.sort === sort ? "primary" : "secondary", onActivate: () => sales.loadBoard({ sort, offset: 0 }) }));
    });
    buildCardFilterBar(panel, { id: "market.filter", x: INSET, y: FILTER_TOP, width, filter: this.#boardFilter, options: cardFilterOptions(this.#app), onChange: (next) => this.#changeBoardFilter(next) });
    const pages = total > pageSize;
    const list = panel.add(new ScrollList({ id: "market.board", x: INSET, y: LIST_TOP, width, height: COLUMNS.height - LIST_TOP - INSET - (pages ? PAGER_HEIGHT + 8 : 0) }));
    if (listings.length === 0) {
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * ROW.height, text: loading ? "Loading…" : this.#emptyBoardText(), size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * ROW.height;
    } else {
      const stripWidth = list.rowWidth - PRICE_WIDTH - META_WIDTH - 2 * ACTION.gap;
      listings.forEach((listing, index) => {
        const card = this.#app.content.catalog.get(listing.card.definitionId);
        const selected = this.#selected?.kind === "listing" && this.#selected.id === listing.id;
        list.add(new CardStrip({ x: 0, y: rowY(index), width: stripWidth, height: ROW.height, card: card ?? unknownCard(listing.card.definitionId), broken: card === undefined, muted: !selected, rarity: rarityOf(this.#app, listing.card.definitionId) }));
        const metaX = stripWidth + ACTION.gap;
        const copy = `#${listing.card.serial}`;
        list.add(new AvatarNode({ id: `market.seller.${listing.id}`, x: metaX, y: rowY(index) + (ROW.height - SELLER_AVATAR) / 2, size: SELLER_AVATAR, account: listing.seller }));
        const textX = metaX + SELLER_AVATAR + 10;
        const textWidth = META_WIDTH - SELLER_AVATAR - 10;
        list.add(new Label({ x: textX, y: rowY(index) + 4, width: textWidth, height: ROW.height / 2 - 4, text: `@${listing.seller}`, size: "small", colorKey: "text", align: "left", fit: true }));
        list.add(new Label({ x: textX, y: rowY(index) + ROW.height / 2, width: textWidth, height: ROW.height / 2 - 4, text: copy, size: "tiny", colorKey: "textMuted", align: "left", fit: true }));
        const text = listing.reserved ? "reserved" : `${listing.price.amount} ${listing.price.asset}`;
        list.add(new Button({ id: `market.listing.${listing.id}`, x: metaX + META_WIDTH + ACTION.gap, y: rowY(index), width: PRICE_WIDTH, height: ROW.height, text, textSize: "small", variant: selected ? "primary" : "secondary", onActivate: () => this.#select("listing", listing.id) }));
      });
      list.contentHeight = rowsHeight(listings.length);
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
    const y = COLUMNS.height - INSET - PAGER_HEIGHT;
    const third = (width - 16) / 3;
    const page = Math.floor(filter.offset / pageSize) + 1;
    panel.add(new Button({ id: "market.page.previous", x: INSET, y, width: third, height: PAGER_HEIGHT, text: "Previous", textSize: "small", enabled: filter.offset > 0, onActivate: () => sales.loadBoard({ offset: Math.max(0, filter.offset - pageSize) }) }));
    panel.add(new Label({ x: INSET + third + 8, y, width: third, height: PAGER_HEIGHT, text: `page ${page} of ${Math.ceil(total / pageSize)}`, size: "small", colorKey: "textMuted" }));
    panel.add(new Button({ id: "market.page.next", x: INSET + 2 * (third + 8), y, width: third, height: PAGER_HEIGHT, text: "Next", textSize: "small", enabled: filter.offset + pageSize < total, onActivate: () => sales.loadBoard({ offset: filter.offset + pageSize }) }));
  }

  /** @param {Panel} panel */
  #buildMine(panel) {
    const { listings, purchases } = this.#sales().state.mine;
    const list = panel.add(new ScrollList({ id: "market.mine", x: INSET, y: TABS.top + TABS.height + 12, width: COLUMNS.left.width - 2 * INSET, height: COLUMNS.height - TABS.top - TABS.height - 12 - INSET }));
    const now = this.#now();
    // Each row shows the other side when there is one: the buyer of a sold card, the seller of a bought one.
    const rows = [
      ...listings.map((listing) => ({ kind: /** @type {const} */ ("listing"), id: listing.id, text: `Selling ${this.#cardName(listing.card.definitionId)} · ${listing.price.amount} ${listing.price.asset}`, subtitle: listingSubtitle(listing, now), avatar: listing.buyer ?? listing.seller })),
      ...purchases.map((purchase) => ({ kind: /** @type {const} */ ("purchase"), id: purchase.id, text: `${purchase.status === "COMPLETED" ? "Bought" : "Buying"} ${this.#cardName(purchase.card.definitionId)} from @${purchase.seller}`, subtitle: `${purchase.price.amount} ${purchase.price.asset} · ${purchase.status.toLowerCase()}`, avatar: purchase.seller })),
    ];
    if (rows.length === 0) {
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * ROW.height, text: "You have not sold or bought anything yet.", size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * ROW.height;
      return;
    }
    rows.forEach((row, index) => {
      const selected = this.#selected?.kind === row.kind && this.#selected.id === row.id;
      list.add(new OptionRow({ id: `market.mine.${row.id}`, x: 0, y: rowY(index), width: list.rowWidth, height: ROW.height, text: row.text, subtitle: row.subtitle, avatar: row.avatar, selected, onActivate: () => this.#select(row.kind, row.id) }));
    });
    list.contentHeight = rowsHeight(rows.length);
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
    panel.add(new TextBlock({ x: INSET, y: 20, width: COLUMNS.right.width - 2 * INSET, height: 90, text: "Pick a card on the board to see it and buy it. Players set their own prices; the money goes straight to them.", size: "body", colorKey: "textMuted" }));
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
      panel.add(new CardDetail({ id: "market.card", x: INSET, y: INSET, width: CARD.width, height: CARD.height, card, rarity }));
    }
    const lines = [...named.slice(0, 1), { text: rarity === null ? "Rarity unknown" : rarityLabel(rarity), colorKey: rarityColorKey(rarity), bold: true }, ...named.slice(1)];
    const x = INSET + CARD.width + INSET;
    const width = COLUMNS.right.width - x - INSET;
    lines.forEach((line, index) => {
      panel.add(new Label({ x, y: INSET + index * LINE, width, height: LINE, text: line.text, size: line.bold === true ? "body" : "small", weight: line.bold === true ? "bold" : "normal", colorKey: line.colorKey ?? "text", align: "left", fit: true, avatar: line.avatar ?? null }));
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
    const lines = [
      { text: this.#cardName(listing.card.definitionId), bold: true, colorKey: "accentLight" },
      { text: `Copy #${listing.card.serial} · ${listing.card.edition}` },
      { text: `Sold by @${listing.seller}`, avatar: listing.seller },
      { text: `${listing.price.amount} ${listing.price.asset}`, bold: true, colorKey: "accent" },
      { text: listingSubtitle(listing, now), colorKey: "textMuted", avatar: listing.status === "SOLD" ? listing.buyer : null },
    ];
    this.#cardWithLines(panel, listing.card.definitionId, lines);
    const y = COLUMNS.height - INSET - BUTTON_HEIGHT;
    const fullWidth = COLUMNS.right.width - 2 * INSET;
    if (listing.status !== "ACTIVE") {
      return;
    }
    if (own) {
      panel.add(new Button({ id: "market.withdraw", x: INSET, y, width: fullWidth, height: BUTTON_HEIGHT, text: listing.reserved ? "A buyer is paying: wait before withdrawing" : "Withdraw from the board", variant: "danger", enabled: !listing.reserved && !sales.state.busy, onActivate: () => sales.withdraw(listing.id) }));
      return;
    }
    if (account === null) {
      panel.add(new Button({ id: "market.signIn", x: INSET, y, width: fullWidth, height: BUTTON_HEIGHT, text: "Sign in with Keychain to buy", enabled: this.services.hasScene(SceneId.LOGIN), onActivate: () => this.services.navigate(SceneId.LOGIN) }));
      return;
    }
    const text = listing.reserved ? "Someone is buying it: try again in a few minutes" : `Buy for ${listing.price.amount} ${listing.price.asset}`;
    panel.add(new Button({ id: "market.buy", x: INSET, y, width: fullWidth, height: BUTTON_HEIGHT, text, variant: "primary", enabled: !listing.reserved && !this.#buyingBusy(), onActivate: () => sales.buy(listing.id) }));
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
    const fullWidth = COLUMNS.right.width - 2 * INSET;
    if (purchase === null) {
      panel.add(new TextBlock({ id: "market.buying", x: INSET, y: INSET, width: fullWidth, height: 90, text: error?.message ?? STAGE_TEXT[BuyStage.RESERVING](), size: "body", colorKey: error === null ? "text" : "danger" }));
      panel.add(new Button({ id: "market.buying.close", x: INSET, y: COLUMNS.height - INSET - BUTTON_HEIGHT, width: fullWidth, height: BUTTON_HEIGHT, text: "Close", enabled: stage === BuyStage.FAILED, onActivate: () => sales.dismiss() }));
      return;
    }
    const { x, width } = this.#cardWithLines(panel, purchase.card.definitionId, this.#buyingLines(purchase));
    panel.add(new TextBlock({ id: "market.buying", x, y: INSET + 6 * LINE, width, height: 4 * LINE, text: stageText(stage, purchase, error), size: "small", colorKey: error === null ? "text" : "danger" }));
    if (purchase.problem !== null && stage !== BuyStage.DONE) {
      panel.add(new TextBlock({ x, y: INSET + 10 * LINE, width, height: 3 * LINE, text: `Note: ${problemText(purchase.problem)}.`, size: "small", colorKey: "danger" }));
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
    const y = COLUMNS.height - INSET - BUTTON_HEIGHT;
    const payable = stage === BuyStage.FAILED && purchase?.payment !== null && purchase?.payment !== undefined;
    if (!payable) {
      const closable = !BUSY_BUY_STAGES.includes(stage) || sales.state.buying.error !== null;
      panel.add(new Button({ id: "market.buying.close", x: INSET, y, width, height: BUTTON_HEIGHT, text: stage === BuyStage.DONE ? "Done" : "Close", variant: stage === BuyStage.DONE ? "primary" : "secondary", enabled: closable, onActivate: () => sales.dismiss() }));
      return;
    }
    const half = (width - 16) / 2;
    panel.add(new Button({ id: "market.buying.pay", x: INSET, y, width: half, height: BUTTON_HEIGHT, text: "Pay again", variant: "primary", onActivate: () => sales.payAgain() }));
    panel.add(new Button({ id: "market.buying.release", x: INSET + half + 16, y, width: half, height: BUTTON_HEIGHT, text: "Give up this card", onActivate: () => sales.release() }));
  }

  /** @param {Panel} panel */
  #buildComposer(panel) {
    const sales = this.#sales();
    const width = COLUMNS.right.width - 2 * INSET;
    panel.add(new Label({ x: INSET, y: 14, width, height: 28, text: "Pick the copy to sell", size: "small", weight: "bold", colorKey: "accent", align: "left" }));
    const bottom = COLUMNS.height - INSET - BUTTON_HEIGHT - 12 - 52 - 12;
    buildCardFilterBar(panel, { id: "market.sellFilter", x: INSET, y: 48, width, filter: this.#sellFilter, options: cardFilterOptions(this.#app), onChange: (next) => this.#changeSellFilter(next) });
    const list = panel.add(new ScrollList({ id: "market.copies", x: INSET, y: COPIES_TOP, width, height: bottom - COPIES_TOP }));
    const copies = this.#sellableCopies().filter((copy) => matchesCardFilter(this.#sellFilter, this.#app.content.catalog.get(copy.definitionId), rarityOf(this.#app, copy.definitionId)));
    if (!copies.some((copy) => copy.id === this.#copy)) {
      this.#copy = null;
    }
    if (copies.length === 0) {
      const text = isFiltering(this.#sellFilter) ? `No ${describeCardFilter(this.#sellFilter)} cards to sell.` : "No card to sell: cards already on the board or in a trade cannot be listed again.";
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 3 * ROW.height, text, size: "small", colorKey: "textMuted" }));
      list.contentHeight = 3 * ROW.height;
    } else {
      const rowWidth = list.rowWidth - ACTION.width - ACTION.gap;
      copies.forEach((copy, index) => {
        const rarity = rarityOf(this.#app, copy.definitionId);
        const subtitle = [rarityLabel(rarity), `#${copy.serial}`].filter((part) => part.length > 0).join(" · ");
        list.add(new OptionRow({ id: `market.copy.${copy.id}`, x: 0, y: rowY(index), width: rowWidth, height: ROW.height, text: this.#cardName(copy.definitionId), subtitle, selected: copy.id === this.#copy, onActivate: () => this.#pickCopy(copy.id) }));
        list.add(new Button({ id: `market.copy.info.${copy.id}`, x: rowWidth + ACTION.gap, y: rowY(index), width: ACTION.width, height: ROW.height, text: "Info", textSize: "small", enabled: this.#app.content.catalog.has(copy.definitionId), onActivate: () => this.#showCardInfo(copy.definitionId, [`Copy #${copy.serial}`]) }));
      });
      list.contentHeight = rowsHeight(copies.length);
    }
    panel.add(new TextField({ id: "market.price", x: INSET, y: bottom + 12, width, height: 52, value: this.#price, placeholder: `Price in ${sales.asset}, e.g. 1.5`, maxLength: 10, onChange: (value) => this.#changePrice(value) }));
    panel.add(new Button({ id: "market.list", x: INSET, y: COLUMNS.height - INSET - BUTTON_HEIGHT, width, height: BUTTON_HEIGHT, text: this.#listText(), variant: "primary", enabled: this.#canList(), onActivate: () => this.#list() }));
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
