/**
 * Trades (docs/tcg/13-scambi.md): the offers the player made and received,
 * with what they can do about each, and a composer for a new offer: the
 * other player's account, some of the player's tradeable copies, and cards
 * of that player's asked in return (only what they have), both lists
 * filtered by faction, rarity and type. The server holds the offered copies in escrow.
 */
import { NO_CARD_FILTER, cardFilterOptions, describeCardFilter, isFiltering, matchesCardFilter } from "../../application/content/CardFilter.js";
import { CARD_FILTER_BAR_HEIGHT, CARD_FILTER_BUTTON_HEIGHT, buildCardFilterBar, buildCardFilterButton } from "../cards/cardFilterBar.js";
import { CardOption } from "../cards/CardOption.js";
import { CardThumb } from "../cards/CardThumb.js";
import { buildCardInfoModal, rarityOf } from "../cards/cardInfo.js";
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
import { screenLayout } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const MAX_CARDS = 10;
const MAX_ASK = 3;
/**
 * Sizes, wide and compact (a phone in landscape: the recipient and the filter share a row, thumbnails are smaller).
 * @typedef {Readonly<{ thumb: { width: number, gap: number }, title: number, statusX: number, field: { y: number, height: number }, filterButton: boolean, button: number }>} TradesMetrics
 */
/** @type {TradesMetrics} */
const WIDE = Object.freeze({ thumb: Object.freeze({ width: 92, gap: 10 }), title: 320, statusX: 180, field: Object.freeze({ y: 16, height: 52 }), filterButton: false, button: 52 });
/** @type {TradesMetrics} */
const COMPACT = Object.freeze({ thumb: Object.freeze({ width: 64, gap: 8 }), title: 120, statusX: 120, field: Object.freeze({ y: 8, height: CARD_FILTER_BUTTON_HEIGHT }), filterButton: true, button: 46 });
/** On a compact screen: how much of the composer's first row the recipient takes (the filter has the rest), and where its lists start. */
const COMPACT_COMPOSER = Object.freeze({ field: 0.58, titlesTop: 8 + CARD_FILTER_BUTTON_HEIGHT + 6, listsTop: 8 + CARD_FILTER_BUTTON_HEIGHT + 32 });
const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT_PATTERN = /^[a-z][a-z0-9.-]{2,15}$/;
/** The composer, top to bottom: recipient, card filter, list titles, the two lists. */
const COMPOSER = Object.freeze({ filterTop: 80, titlesTop: 80 + CARD_FILTER_BAR_HEIGHT + 10, listsTop: 80 + CARD_FILTER_BAR_HEIGHT + 42 });
/** The recipient's field, and their portrait beside it once the account is well formed. */
const RECIPIENT = Object.freeze({ top: 16, height: 52, gap: 12 });

/**
 * One line about a trade for the list.
 * @param {import("../../application/ports/TradingApi.contract.js").Trade} trade
 * @param {number} now
 */
export function tradeSubtitle(trade, now) {
  const asks = trade.wants.reduce((sum, want) => sum + want.count, 0);
  const deal = `gives ${trade.give.length} · asks ${asks}`;
  if (trade.status !== "OPEN") {
    return `${trade.status.toLowerCase()} · ${deal}`;
  }
  const days = Math.max(0, Math.ceil((trade.expiresAt - now) / DAY));
  return `open · ${deal} · ${days} day(s) left`;
}

export class TradesScene extends Scene {
  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return screenLayout(this.services.viewport);
  }

  /** @returns {TradesMetrics} */
  get #m() {
    return this.#screen.compact ? COMPACT : WIDE;
  }

  relayout() {
    this.#rebuild();
  }

  #app;
  #now;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** @type {string | null} */
  #selectedId = null;
  #composing = false;
  #to = "";
  /** @type {Set<string>} copy ids offered */
  #give = new Set();
  /** @type {Map<string, number>} definition → copies asked */
  #ask = new Map();
  /** Cards shown in both lists of the composer. @type {import("../../application/content/CardFilter.js").CardFilter} */
  #filter = NO_CARD_FILTER;

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

  enter() {
    const trading = this.#trading();
    this.#unsubscribe = trading.subscribe(() => this.#rebuild());
    trading.refresh();
    this.#rebuild();
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#trading().lookUpAskable(null);
    super.exit();
  }

  onCancel() {
    if (this.#composing) {
      this.#composing = false;
      this.#rebuild();
      return;
    }
    this.services.navigate(SceneId.COLLECTION);
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "trades" });
    super.render(context);
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.root.clear();
    const back = this.#buildHeader();
    this.#buildList();
    if (this.#composing) {
      this.#buildComposer();
    } else {
      this.#buildDetail();
    }
    this.focus(this.root.findById(focusedId) ?? back);
    this.services.requestRender();
  }

  #buildHeader() {
    const { viewport } = this.services;
    const state = this.#trading().state;
    const { title, statusX } = this.#m;
    this.root.add(new Label({ x: this.#screen.header.sideMargin, y: this.#screen.header.y, width: title, height: this.#screen.header.height, text: "Trades", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const message = state.error ?? state.notice ?? "Card for card. Offered cards are held until the offer is answered or expires.";
    this.root.add(new Label({ id: "trades.status", x: this.#screen.header.sideMargin + statusX, y: this.#screen.header.y, width: viewport.logicalWidth - 2 * this.#screen.header.sideMargin - 2 * (this.#screen.header.backWidth + 16) - statusX, height: this.#screen.header.height, text: message, size: "small", colorKey: state.error === null ? "textMuted" : "danger", align: "left", fit: true }));
    this.root.add(new Button({ id: "trades.new", x: viewport.logicalWidth - this.#screen.header.sideMargin - 2 * this.#screen.header.backWidth - 16, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: this.#newOfferText(), onActivate: () => this.#toggleComposer() }));
    return this.root.add(new Button({ id: "trades.back", x: viewport.logicalWidth - this.#screen.header.sideMargin - this.#screen.header.backWidth, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: "Collection", onActivate: () => this.services.navigate(SceneId.COLLECTION) }));
  }

  #buildList() {
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.left.x, y: this.#screen.columns.top, width: this.#screen.columns.left.width, height: this.#screen.columns.height }));
    const width = this.#screen.columns.left.width - 2 * this.#screen.inset;
    const titleY = this.#screen.compact ? 8 : 14;
    const listY = this.#screen.compact ? 50 : 60;
    panel.add(new Label({ x: this.#screen.inset, y: titleY, width, height: 36, text: "Your trades", size: "heading", weight: "bold", colorKey: "accentLight", align: "left" }));
    const list = panel.add(new ScrollList({ id: "trades.list", x: this.#screen.inset, y: listY, width, height: this.#screen.columns.height - listY - this.#screen.inset }));
    const { trades, loading } = this.#trading().state;
    if (trades.length === 0) {
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * this.#screen.row.height, text: loading ? "Loading…" : "No trades yet. Offer some of your bought cards to another player.", size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * this.#screen.row.height;
      return;
    }
    const now = this.#now();
    trades.forEach((trade, index) => {
      const other = trade.role === "proposer" ? trade.counterparty : trade.proposer;
      const arrow = trade.role === "proposer" ? `to @${other}` : `from @${other}`;
      list.add(new OptionRow({ id: `trades.row.${trade.id}`, x: 0, y: this.#screen.rowY(index), width: list.rowWidth, height: this.#screen.row.height, text: arrow, subtitle: tradeSubtitle(trade, now), avatar: other, selected: trade.id === this.#selectedId, onActivate: () => this.#select(trade.id) }));
    });
    list.contentHeight = this.#screen.rowsHeight(trades.length);
  }

  #buildDetail() {
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.right.x, y: this.#screen.columns.top, width: this.#screen.columns.right.width, height: this.#screen.columns.height }));
    const width = this.#screen.columns.right.width - 2 * this.#screen.inset;
    const trade = this.#trading().state.trades.find((candidate) => candidate.id === this.#selectedId);
    if (trade === undefined) {
      panel.add(new TextBlock({ x: this.#screen.inset, y: 20, width, height: 60, text: "Pick a trade to see it, or make a new offer.", size: "body", colorKey: "textMuted" }));
      return;
    }
    const listHeight = trade.status === "OPEN" ? this.#screen.columns.height - 2 * this.#screen.inset - this.#m.button - 16 : this.#screen.columns.height - 2 * this.#screen.inset;
    const list = panel.add(new ScrollList({ id: "trades.detail", x: this.#screen.inset, y: this.#screen.inset, width, height: listHeight }));
    const copyThumbs = (copies) => copies.map((copy) => ({ definitionId: copy.definitionId, caption: `#${copy.serial}`, lines: [`Copy #${copy.serial}`] }));
    const sections = [
      { title: `@${trade.proposer} offers`, avatar: trade.proposer, thumbs: copyThumbs(trade.give), empty: "nothing" },
      { title: `and asks @${trade.counterparty} for`, avatar: trade.counterparty, thumbs: trade.wants.map((want) => ({ definitionId: want.definitionId, caption: `× ${want.count}`, lines: [`Asked: ${want.count}`] })), empty: "nothing (a gift)" },
    ];
    if (trade.status === "ACCEPTED") {
      sections.push({ title: `@${trade.counterparty} gave`, avatar: trade.counterparty, thumbs: copyThumbs(trade.take), empty: "nothing" });
    }
    let y = 0;
    for (const section of sections) {
      y = this.#buildThumbSection(list, section, y);
    }
    if (trade.status !== "ACCEPTED") {
      list.add(new Label({ id: "trades.detail.status", x: 0, y, width: list.rowWidth, height: 28, text: `Status: ${trade.status.toLowerCase()}`, size: "body", colorKey: "text", align: "left" }));
      y += 28;
    }
    list.contentHeight = y;
    this.#buildActions(panel, trade, width);
  }

  /**
   * A heading (led by the portrait of the player whose cards they are) and a grid of card thumbnails; returns the y below it.
   * @param {ScrollList} list
   * @param {{ title: string, avatar: string, thumbs: { definitionId: string, caption: string, lines: string[] }[], empty: string }} section
   * @param {number} top
   */
  #buildThumbSection(list, { title, avatar, thumbs, empty }, top) {
    list.add(new Label({ x: 0, y: top, width: list.rowWidth, height: 28, text: thumbs.length === 0 ? `${title}: ${empty}` : title, size: "body", weight: "bold", colorKey: "accent", align: "left", avatar }));
    let y = top + 36;
    if (thumbs.length === 0) {
      return y;
    }
    const THUMB = this.#m.thumb;
    const perRow = Math.max(1, Math.floor((list.rowWidth + THUMB.gap) / (THUMB.width + THUMB.gap)));
    const height = CardThumb.heightFor(THUMB.width);
    thumbs.forEach((thumb, index) => {
      const known = this.#app.content.catalog.get(thumb.definitionId);
      const card = known ?? { ...unknownCard(thumb.definitionId), text: "" };
      list.add(
        new CardThumb({
          id: `trades.card.${index}.${thumb.definitionId}`,
          x: (index % perRow) * (THUMB.width + THUMB.gap),
          y: y + Math.floor(index / perRow) * (height + THUMB.gap),
          width: THUMB.width,
          card,
          caption: thumb.caption,
          rarity: rarityOf(this.#app, thumb.definitionId),
          onActivate: known === undefined ? null : () => this.#showCard(thumb.definitionId, thumb.lines),
        }),
      );
    });
    y += Math.ceil(thumbs.length / perRow) * (height + THUMB.gap);
    return y + 12;
  }

  /**
   * An "i" button that opens a card's details.
   * @param {ScrollList} list
   * @param {{ id: string, x: number, y: number, definitionId: string, lines: readonly string[] }} button
   */
  #infoButton(list, { id, x, y, definitionId, lines }) {
    list.add(new Button({ id, x, y, width: this.#screen.action.small, height: this.#screen.row.height, text: "i", enabled: this.#app.content.catalog.has(definitionId), onActivate: () => this.#showCard(definitionId, lines) }));
  }

  /**
   * @param {string} definitionId
   * @param {readonly string[]} lines
   */
  #showCard(definitionId, lines) {
    const card = this.#app.content.catalog.get(definitionId);
    if (card !== undefined) {
      this.openModal(buildCardInfoModal({ viewport: this.services.viewport, card, rarity: rarityOf(this.#app, definitionId), lines, onClose: () => this.closeModal() }));
    }
  }

  /**
   * @param {Panel} panel
   * @param {import("../../application/ports/TradingApi.contract.js").Trade} trade
   * @param {number} width
   */
  #buildActions(panel, trade, width) {
    if (trade.status !== "OPEN") {
      return;
    }
    const busy = this.#trading().state.busy;
    const height = this.#m.button;
    const y = this.#screen.columns.height - this.#screen.inset - height;
    const trading = this.#trading();
    if (trade.role === "proposer") {
      panel.add(new Button({ id: "trades.cancel", x: this.#screen.inset, y, width, height, text: "Cancel offer", variant: "danger", enabled: !busy, onActivate: () => trading.cancel(trade.id) }));
      return;
    }
    const half = (width - 16) / 2;
    panel.add(new Button({ id: "trades.accept", x: this.#screen.inset, y, width: half, height, text: "Accept", variant: "primary", enabled: !busy, onActivate: () => trading.accept(trade.id) }));
    panel.add(new Button({ id: "trades.decline", x: this.#screen.inset + half + 16, y, width: half, height, text: "Decline", enabled: !busy, onActivate: () => trading.decline(trade.id) }));
  }

  #buildComposer() {
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.right.x, y: this.#screen.columns.top, width: this.#screen.columns.right.width, height: this.#screen.columns.height }));
    const width = this.#screen.columns.right.width - 2 * this.#screen.inset;
    const { field, filterButton, button } = this.#m;
    const layout = filterButton ? COMPACT_COMPOSER : COMPOSER;
    // The recipient's row: their field and portrait (and, on a phone, the card filter after them).
    const recipientWidth = filterButton ? Math.round(width * COMPACT_COMPOSER.field) : width;
    const fieldWidth = recipientWidth - field.height - RECIPIENT.gap;
    panel.add(new TextField({ id: "trades.to", x: this.#screen.inset, y: field.y, width: fieldWidth, height: field.height, value: this.#to, placeholder: "Player account", maxLength: 16, keyboard: "account", onChange: (value) => this.#changeRecipient(value) }));
    panel.add(new AvatarNode({ id: "trades.to.avatar", x: this.#screen.inset + fieldWidth + RECIPIENT.gap, y: field.y, size: field.height, account: this.#to, visible: ACCOUNT_PATTERN.test(this.#to) }));
    const filter = { id: "trades.filter", filter: this.#filter, options: cardFilterOptions(this.#app), onChange: (/** @type {import("../../application/content/CardFilter.js").CardFilter} */ chosen) => this.#changeFilter(chosen) };
    if (filterButton) {
      const x = this.#screen.inset + recipientWidth + 8;
      buildCardFilterButton(panel, { ...filter, x, y: field.y, width: this.#screen.inset + width - x, dialog: { viewport: this.services.viewport, open: (modal) => this.openModal(modal), close: () => this.closeModal() } });
    } else {
      buildCardFilterBar(panel, { ...filter, x: this.#screen.inset, y: COMPOSER.filterTop, width });
    }
    const half = (width - 16) / 2;
    panel.add(new Label({ x: this.#screen.inset, y: layout.titlesTop, width: half, height: 28, text: `You give (${this.#give.size}/${MAX_CARDS})`, size: "small", weight: "bold", colorKey: "accent", align: "left" }));
    panel.add(new Label({ x: this.#screen.inset + half + 16, y: layout.titlesTop, width: half, height: 28, text: filterButton ? "You ask for (tap)" : "You ask for (tap to add)", size: "small", weight: "bold", colorKey: "accent", align: "left" }));
    const listHeight = this.#screen.columns.height - layout.listsTop - button - 2 * this.#screen.inset;
    this.#buildGiveList(panel.add(new ScrollList({ id: "trades.give", x: this.#screen.inset, y: layout.listsTop, width: half, height: listHeight })));
    this.#buildAskList(panel.add(new ScrollList({ id: "trades.ask", x: this.#screen.inset + half + 16, y: layout.listsTop, width: half, height: listHeight })));
    const ready = ACCOUNT_PATTERN.test(this.#to) && this.#give.size > 0 && !this.#trading().state.busy;
    panel.add(new Button({ id: "trades.send", x: this.#screen.inset, y: this.#screen.columns.height - this.#screen.inset - button, width, height: button, text: "Send offer", variant: "primary", enabled: ready, onActivate: () => this.#send() }));
  }

  /** @param {ScrollList} list */
  #buildGiveList(list) {
    const copies = this.#tradeableCopies().filter((copy) => this.#passes(copy.definitionId));
    if (copies.length === 0) {
      const text = isFiltering(this.#filter) ? `No ${describeCardFilter(this.#filter)} cards to give.` : "No tradeable cards: cards already offered in another trade cannot be offered again.";
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 3 * this.#screen.row.height, text, size: "small", colorKey: "textMuted" }));
      list.contentHeight = 3 * this.#screen.row.height;
      return;
    }
    const rowWidth = list.rowWidth - this.#screen.action.small - this.#screen.action.gap;
    copies.forEach((copy, index) => {
      const chosen = this.#give.has(copy.id);
      list.add(new CardOption({ id: `trades.give.${copy.id}`, x: 0, y: this.#screen.rowY(index), width: rowWidth, height: this.#screen.row.height, ...this.#optionCard(copy.definitionId), badge: `#${copy.serial}`, selected: chosen, enabled: chosen || this.#give.size < MAX_CARDS, onActivate: () => this.#toggleGive(copy.id) }));
      this.#infoButton(list, { id: `trades.give.info.${copy.id}`, x: rowWidth + this.#screen.action.gap, y: this.#screen.rowY(index), definitionId: copy.definitionId, lines: [`Copy #${copy.serial}`] });
    });
    list.contentHeight = this.#screen.rowsHeight(copies.length);
  }

  /** @param {ScrollList} list */
  #buildAskList(list) {
    const askable = this.#trading().state.askable;
    const message = this.#askListMessage(askable);
    if (message !== null) {
      list.add(new TextBlock({ id: "trades.ask.message", x: 0, y: 0, width: list.rowWidth, height: 3 * this.#screen.row.height, text: message, size: "small", colorKey: askable !== null && askable.error !== null ? "danger" : "textMuted" }));
      list.contentHeight = 3 * this.#screen.row.height;
      return;
    }
    const cards = /** @type {NonNullable<typeof askable>} */ (askable).cards
      .filter(({ definitionId }) => this.#passes(definitionId))
      .map(({ definitionId, count }) => ({ definitionId, has: count, name: this.#cardName(definitionId) }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const rowWidth = list.rowWidth - this.#screen.action.small - this.#screen.action.gap;
    cards.forEach(({ definitionId, has }, index) => {
      const count = this.#ask.get(definitionId) ?? 0;
      // What they have, or how many of those are asked.
      const badge = count === 0 ? `x${has}` : `${count}/${has}`;
      list.add(new CardOption({ id: `trades.ask.${definitionId}`, x: 0, y: this.#screen.rowY(index), width: rowWidth, height: this.#screen.row.height, ...this.#optionCard(definitionId), badge, selected: count > 0, onActivate: () => this.#cycleAsk(definitionId, has) }));
      this.#infoButton(list, { id: `trades.ask.info.${definitionId}`, x: rowWidth + this.#screen.action.gap, y: this.#screen.rowY(index), definitionId, lines: [`@${this.#to} has ${has}`] });
    });
    if (cards.length === 0) {
      list.add(new TextBlock({ id: "trades.ask.message", x: 0, y: 0, width: list.rowWidth, height: 3 * this.#screen.row.height, text: `@${this.#to} has no ${describeCardFilter(this.#filter)} cards to trade.`, size: "small", colorKey: "textMuted" }));
    }
    list.contentHeight = cards.length === 0 ? 3 * this.#screen.row.height : this.#screen.rowsHeight(cards.length);
  }

  /** The header's toggle between the trades and the composer; a phone's header has room for a word or two. */
  #newOfferText() {
    if (this.#composing) {
      return this.#screen.compact ? "Trades" : "Back to trades";
    }
    return this.#screen.compact ? "New" : "New offer";
  }

  /** @param {string} definitionId */
  #passes(definitionId) {
    return matchesCardFilter(this.#filter, this.#app.content.catalog.get(definitionId), rarityOf(this.#app, definitionId));
  }

  /**
   * Chosen copies and asks stay chosen when the filter hides them: the
   * filter only changes what is shown.
   * @param {import("../../application/content/CardFilter.js").CardFilter} filter
   */
  #changeFilter(filter) {
    this.#filter = filter;
    this.#rebuild();
  }

  /**
   * Why the ask list shows no cards, or null when it shows the recipient's.
   * @param {import("../../application/trading/TradingService.js").Askable | null} askable
   */
  #askListMessage(askable) {
    if (!ACCOUNT_PATTERN.test(this.#to) || askable === null || askable.account !== this.#to) {
      return "Type the player's account to see the cards you can ask them for.";
    }
    if (askable.loading) {
      return `Looking at @${askable.account}'s cards…`;
    }
    if (askable.error !== null) {
      return askable.error;
    }
    return askable.cards.length === 0 ? `@${askable.account} has no cards to trade: you can still send a gift.` : null;
  }

  /** The player's copies that may be offered: bought, and not already in a trade. */
  #tradeableCopies() {
    const cards = this.#app.account?.collection.state.cards ?? [];
    return cards.flatMap((entry) => entry.copies.filter((copy) => copy.tradeable === true && copy.status === "active").map((copy) => ({ ...copy, definitionId: entry.definitionId })));
  }

  /**
   * A card as a CardOption shows it: its definition (a stand-in when unknown) and rarity.
   * @param {string} definitionId
   */
  #optionCard(definitionId) {
    const card = this.#app.content.catalog.get(definitionId);
    return { card: card ?? unknownCard(definitionId), broken: card === undefined, rarity: rarityOf(this.#app, definitionId) };
  }

  /** @param {string} definitionId */
  #cardName(definitionId) {
    return this.#app.content.catalog.get(definitionId)?.name ?? definitionId;
  }

  /** @param {string} tradeId */
  #select(tradeId) {
    this.#selectedId = tradeId;
    this.#rebuild();
  }

  #toggleComposer() {
    this.#composing = !this.#composing;
    this.#trading().lookUpAskable(this.#composing && ACCOUNT_PATTERN.test(this.#to) ? this.#to : null);
    this.#rebuild();
  }

  /** @param {string} value */
  #changeRecipient(value) {
    const to = value.trim().toLowerCase();
    if (to === this.#to) {
      return;
    }
    this.#to = to;
    this.#ask.clear();
    this.#trading().lookUpAskable(ACCOUNT_PATTERN.test(to) ? to : null);
    // Updated in place, like the Send button: rebuilding the scene would take the focus off the field.
    const portrait = this.root.findById("trades.to.avatar");
    if (portrait instanceof AvatarNode) {
      portrait.account = to;
      portrait.visible = ACCOUNT_PATTERN.test(to);
    }
    const send = this.root.findById("trades.send");
    if (send !== null) {
      send.enabled = ACCOUNT_PATTERN.test(this.#to) && this.#give.size > 0;
    }
    this.services.requestRender();
  }

  /** @param {string} copyId */
  #toggleGive(copyId) {
    if (!this.#give.delete(copyId) && this.#give.size < MAX_CARDS) {
      this.#give.add(copyId);
    }
    this.#rebuild();
  }

  /**
   * Tap: one more, back to none after the maximum (or all the recipient has).
   * @param {string} definitionId
   * @param {number} has copies the recipient could give
   */
  #cycleAsk(definitionId, has) {
    const next = ((this.#ask.get(definitionId) ?? 0) + 1) % (Math.min(MAX_ASK, has) + 1);
    if (next === 0) {
      this.#ask.delete(definitionId);
    } else {
      this.#ask.set(definitionId, next);
    }
    this.#rebuild();
  }

  async #send() {
    const want = [...this.#ask].map(([definitionId, count]) => ({ definitionId, count }));
    if (await this.#trading().propose({ to: this.#to, give: [...this.#give], want })) {
      this.#composing = false;
      this.#give.clear();
      this.#ask.clear();
      this.#selectedId = this.#trading().state.trades[0]?.id ?? null;
      this.#rebuild();
    }
  }

  #trading() {
    if (this.#app.trading === undefined) {
      throw new Error("TradesScene needs the trading service");
    }
    return this.#app.trading;
  }
}
