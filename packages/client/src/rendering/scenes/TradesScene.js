/**
 * Trades (docs/tcg/13-scambi.md): the offers the player made and received,
 * with what they can do about each, and a composer for a new offer: the
 * other player's account, some of the player's tradeable copies, and cards
 * of that player's asked in return (only what they have), both lists
 * filtered by faction, rarity and type. The server holds the offered copies in escrow.
 */
import { NO_CARD_FILTER, cardFilterOptions, describeCardFilter, isFiltering, matchesCardFilter } from "../../application/content/CardFilter.js";
import { CARD_FILTER_BAR_HEIGHT, buildCardFilterBar } from "../cards/cardFilterBar.js";
import { CardThumb } from "../cards/CardThumb.js";
import { buildCardInfoModal, rarityOf } from "../cards/cardInfo.js";
import { rarityLabel } from "../theme/rarity.js";
import { unknownCard } from "../cards/unknownCard.js";
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

const MAX_CARDS = 10;
const MAX_ASK = 3;
const THUMB = Object.freeze({ width: 92, gap: 10 });
const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT_PATTERN = /^[a-z][a-z0-9.-]{2,15}$/;
/** The composer, top to bottom: recipient, card filter, list titles, the two lists. */
const COMPOSER = Object.freeze({ filterTop: 80, titlesTop: 80 + CARD_FILTER_BAR_HEIGHT + 10, listsTop: 80 + CARD_FILTER_BAR_HEIGHT + 42 });

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
    this.root.add(new Label({ x: HEADER.sideMargin, y: HEADER.y, width: 320, height: HEADER.height, text: "Trades", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const message = state.error ?? state.notice ?? "Card for card. Offered cards are held until the offer is answered or expires.";
    this.root.add(new Label({ id: "trades.status", x: HEADER.sideMargin + 180, y: HEADER.y, width: viewport.logicalWidth - 2 * HEADER.sideMargin - 2 * HEADER.backWidth - 200, height: HEADER.height, text: message, size: "small", colorKey: state.error === null ? "textMuted" : "danger", align: "left", fit: true }));
    this.root.add(new Button({ id: "trades.new", x: viewport.logicalWidth - HEADER.sideMargin - 2 * HEADER.backWidth - 16, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: this.#composing ? "Back to trades" : "New offer", onActivate: () => this.#toggleComposer() }));
    return this.root.add(new Button({ id: "trades.back", x: viewport.logicalWidth - HEADER.sideMargin - HEADER.backWidth, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: "Collection", onActivate: () => this.services.navigate(SceneId.COLLECTION) }));
  }

  #buildList() {
    const panel = this.root.add(new Panel({ x: COLUMNS.left.x, y: COLUMNS.top, width: COLUMNS.left.width, height: COLUMNS.height }));
    const width = COLUMNS.left.width - 2 * INSET;
    panel.add(new Label({ x: INSET, y: 14, width, height: 36, text: "Your trades", size: "heading", weight: "bold", colorKey: "accentLight", align: "left" }));
    const list = panel.add(new ScrollList({ id: "trades.list", x: INSET, y: 60, width, height: COLUMNS.height - 60 - INSET }));
    const { trades, loading } = this.#trading().state;
    if (trades.length === 0) {
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * ROW.height, text: loading ? "Loading…" : "No trades yet. Offer some of your bought cards to another player.", size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * ROW.height;
      return;
    }
    const now = this.#now();
    trades.forEach((trade, index) => {
      const arrow = trade.role === "proposer" ? `to @${trade.counterparty}` : `from @${trade.proposer}`;
      list.add(new OptionRow({ id: `trades.row.${trade.id}`, x: 0, y: rowY(index), width: list.rowWidth, height: ROW.height, text: arrow, subtitle: tradeSubtitle(trade, now), selected: trade.id === this.#selectedId, onActivate: () => this.#select(trade.id) }));
    });
    list.contentHeight = rowsHeight(trades.length);
  }

  #buildDetail() {
    const panel = this.root.add(new Panel({ x: COLUMNS.right.x, y: COLUMNS.top, width: COLUMNS.right.width, height: COLUMNS.height }));
    const width = COLUMNS.right.width - 2 * INSET;
    const trade = this.#trading().state.trades.find((candidate) => candidate.id === this.#selectedId);
    if (trade === undefined) {
      panel.add(new TextBlock({ x: INSET, y: 20, width, height: 60, text: "Pick a trade to see it, or make a new offer.", size: "body", colorKey: "textMuted" }));
      return;
    }
    const listHeight = trade.status === "OPEN" ? COLUMNS.height - 2 * INSET - 52 - 16 : COLUMNS.height - 2 * INSET;
    const list = panel.add(new ScrollList({ id: "trades.detail", x: INSET, y: INSET, width, height: listHeight }));
    const copyThumbs = (copies) => copies.map((copy) => ({ definitionId: copy.definitionId, caption: `#${copy.serial}${copy.finish === "foil" ? " · foil" : ""}`, highlight: copy.finish === "foil", lines: [`Copy #${copy.serial} · ${copy.finish}`] }));
    const sections = [
      { title: `@${trade.proposer} offers`, thumbs: copyThumbs(trade.give), empty: "nothing" },
      { title: `and asks @${trade.counterparty} for`, thumbs: trade.wants.map((want) => ({ definitionId: want.definitionId, caption: `× ${want.count}`, highlight: false, lines: [`Asked: ${want.count}`] })), empty: "nothing (a gift)" },
    ];
    if (trade.status === "ACCEPTED") {
      sections.push({ title: `@${trade.counterparty} gave`, thumbs: copyThumbs(trade.take), empty: "nothing" });
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
   * A heading and a grid of card thumbnails; returns the y below it.
   * @param {ScrollList} list
   * @param {{ title: string, thumbs: { definitionId: string, caption: string, highlight: boolean, lines: string[] }[], empty: string }} section
   * @param {number} top
   */
  #buildThumbSection(list, { title, thumbs, empty }, top) {
    list.add(new Label({ x: 0, y: top, width: list.rowWidth, height: 28, text: thumbs.length === 0 ? `${title}: ${empty}` : title, size: "body", weight: "bold", colorKey: "accent", align: "left" }));
    let y = top + 36;
    if (thumbs.length === 0) {
      return y;
    }
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
          highlight: thumb.highlight,
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
    list.add(new Button({ id, x, y, width: ACTION.small, height: ROW.height, text: "i", enabled: this.#app.content.catalog.has(definitionId), onActivate: () => this.#showCard(definitionId, lines) }));
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
    const y = COLUMNS.height - INSET - 52;
    const trading = this.#trading();
    if (trade.role === "proposer") {
      panel.add(new Button({ id: "trades.cancel", x: INSET, y, width, height: 52, text: "Cancel offer", variant: "danger", enabled: !busy, onActivate: () => trading.cancel(trade.id) }));
      return;
    }
    const half = (width - 16) / 2;
    panel.add(new Button({ id: "trades.accept", x: INSET, y, width: half, height: 52, text: "Accept", variant: "primary", enabled: !busy, onActivate: () => trading.accept(trade.id) }));
    panel.add(new Button({ id: "trades.decline", x: INSET + half + 16, y, width: half, height: 52, text: "Decline", enabled: !busy, onActivate: () => trading.decline(trade.id) }));
  }

  #buildComposer() {
    const panel = this.root.add(new Panel({ x: COLUMNS.right.x, y: COLUMNS.top, width: COLUMNS.right.width, height: COLUMNS.height }));
    const width = COLUMNS.right.width - 2 * INSET;
    panel.add(new TextField({ id: "trades.to", x: INSET, y: 16, width, height: 52, value: this.#to, placeholder: "Player account", maxLength: 16, onChange: (value) => this.#changeRecipient(value) }));
    buildCardFilterBar(panel, { id: "trades.filter", x: INSET, y: COMPOSER.filterTop, width, filter: this.#filter, options: cardFilterOptions(this.#app), onChange: (filter) => this.#changeFilter(filter) });
    const half = (width - 16) / 2;
    panel.add(new Label({ x: INSET, y: COMPOSER.titlesTop, width: half, height: 28, text: `You give (${this.#give.size}/${MAX_CARDS})`, size: "small", weight: "bold", colorKey: "accent", align: "left" }));
    panel.add(new Label({ x: INSET + half + 16, y: COMPOSER.titlesTop, width: half, height: 28, text: "You ask for (tap to add)", size: "small", weight: "bold", colorKey: "accent", align: "left" }));
    const listHeight = COLUMNS.height - COMPOSER.listsTop - 52 - 2 * INSET;
    this.#buildGiveList(panel.add(new ScrollList({ id: "trades.give", x: INSET, y: COMPOSER.listsTop, width: half, height: listHeight })));
    this.#buildAskList(panel.add(new ScrollList({ id: "trades.ask", x: INSET + half + 16, y: COMPOSER.listsTop, width: half, height: listHeight })));
    const ready = ACCOUNT_PATTERN.test(this.#to) && this.#give.size > 0 && !this.#trading().state.busy;
    panel.add(new Button({ id: "trades.send", x: INSET, y: COLUMNS.height - INSET - 52, width, height: 52, text: "Send offer", variant: "primary", enabled: ready, onActivate: () => this.#send() }));
  }

  /** @param {ScrollList} list */
  #buildGiveList(list) {
    const copies = this.#tradeableCopies().filter((copy) => this.#passes(copy.definitionId));
    if (copies.length === 0) {
      const text = isFiltering(this.#filter) ? `No ${describeCardFilter(this.#filter)} cards to give.` : "No tradeable cards: cards already offered in another trade cannot be offered again.";
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 3 * ROW.height, text, size: "small", colorKey: "textMuted" }));
      list.contentHeight = 3 * ROW.height;
      return;
    }
    const rowWidth = list.rowWidth - ACTION.small - ACTION.gap;
    copies.forEach((copy, index) => {
      const chosen = this.#give.has(copy.id);
      const subtitle = [rarityLabel(rarityOf(this.#app, copy.definitionId)), `#${copy.serial}`, copy.finish].filter((part) => part.length > 0).join(" · ");
      list.add(new OptionRow({ id: `trades.give.${copy.id}`, x: 0, y: rowY(index), width: rowWidth, height: ROW.height, text: this.#cardName(copy.definitionId), subtitle, selected: chosen, enabled: chosen || this.#give.size < MAX_CARDS, onActivate: () => this.#toggleGive(copy.id) }));
      this.#infoButton(list, { id: `trades.give.info.${copy.id}`, x: rowWidth + ACTION.gap, y: rowY(index), definitionId: copy.definitionId, lines: [`Copy #${copy.serial} · ${copy.finish}`] });
    });
    list.contentHeight = rowsHeight(copies.length);
  }

  /** @param {ScrollList} list */
  #buildAskList(list) {
    const askable = this.#trading().state.askable;
    const message = this.#askListMessage(askable);
    if (message !== null) {
      list.add(new TextBlock({ id: "trades.ask.message", x: 0, y: 0, width: list.rowWidth, height: 3 * ROW.height, text: message, size: "small", colorKey: askable !== null && askable.error !== null ? "danger" : "textMuted" }));
      list.contentHeight = 3 * ROW.height;
      return;
    }
    const cards = /** @type {NonNullable<typeof askable>} */ (askable).cards
      .filter(({ definitionId }) => this.#passes(definitionId))
      .map(({ definitionId, count }) => ({ definitionId, has: count, name: this.#cardName(definitionId) }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const rowWidth = list.rowWidth - ACTION.small - ACTION.gap;
    cards.forEach(({ definitionId, has, name }, index) => {
      const count = this.#ask.get(definitionId) ?? 0;
      const rarity = rarityLabel(rarityOf(this.#app, definitionId));
      const asked = count === 0 ? `has ${has}` : `asking ${count} of ${has}`;
      list.add(new OptionRow({ id: `trades.ask.${definitionId}`, x: 0, y: rowY(index), width: rowWidth, height: ROW.height, text: name, subtitle: rarity.length === 0 ? asked : `${rarity} · ${asked}`, selected: count > 0, onActivate: () => this.#cycleAsk(definitionId, has) }));
      this.#infoButton(list, { id: `trades.ask.info.${definitionId}`, x: rowWidth + ACTION.gap, y: rowY(index), definitionId, lines: [`@${this.#to} has ${has}`] });
    });
    if (cards.length === 0) {
      list.add(new TextBlock({ id: "trades.ask.message", x: 0, y: 0, width: list.rowWidth, height: 3 * ROW.height, text: `@${this.#to} has no ${describeCardFilter(this.#filter)} cards to trade.`, size: "small", colorKey: "textMuted" }));
    }
    list.contentHeight = cards.length === 0 ? 3 * ROW.height : rowsHeight(cards.length);
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
