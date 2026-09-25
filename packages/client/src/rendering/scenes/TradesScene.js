/**
 * Trades (docs/tcg/13-scambi.md): the offers the player made and received,
 * with what they can do about each, and a composer for a new offer: the
 * other player's account, some of the player's bought copies, and the cards
 * asked in return. The server holds the offered copies in escrow.
 */
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { TextField } from "../ui/TextField.js";
import { COLUMNS, HEADER, INSET, ROW, rowY, rowsHeight } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const MAX_CARDS = 10;
const MAX_ASK = 3;
const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT_PATTERN = /^[a-z][a-z0-9.-]{2,15}$/;

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
    const names = (copies) => copies.map((copy) => `${this.#cardName(copy.definitionId)} #${copy.serial}${copy.finish === "foil" ? " (foil)" : ""}`).join(", ") || "nothing";
    const asked = trade.wants.map((want) => `${want.count} × ${this.#cardName(want.definitionId)}`).join(", ") || "nothing (a gift)";
    const lines = [
      `@${trade.proposer} offers: ${names(trade.give)}`,
      `and asks @${trade.counterparty} for: ${asked}`,
      trade.status === "ACCEPTED" ? `@${trade.counterparty} gave: ${names(trade.take)}` : `Status: ${trade.status.toLowerCase()}`,
    ];
    lines.forEach((text, index) => panel.add(new TextBlock({ id: `trades.detail.${index}`, x: INSET, y: 20 + index * 90, width, height: 84, text, size: "body", colorKey: "text" })));
    this.#buildActions(panel, trade, width);
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
    const half = (width - 16) / 2;
    panel.add(new Label({ x: INSET, y: 78, width: half, height: 28, text: `You give (${this.#give.size}/${MAX_CARDS})`, size: "small", weight: "bold", colorKey: "accent", align: "left" }));
    panel.add(new Label({ x: INSET + half + 16, y: 78, width: half, height: 28, text: "You ask for (tap to add)", size: "small", weight: "bold", colorKey: "accent", align: "left" }));
    const listHeight = COLUMNS.height - 110 - 52 - 2 * INSET;
    this.#buildGiveList(panel.add(new ScrollList({ id: "trades.give", x: INSET, y: 110, width: half, height: listHeight })));
    this.#buildAskList(panel.add(new ScrollList({ id: "trades.ask", x: INSET + half + 16, y: 110, width: half, height: listHeight })));
    const ready = ACCOUNT_PATTERN.test(this.#to) && this.#give.size > 0 && !this.#trading().state.busy;
    panel.add(new Button({ id: "trades.send", x: INSET, y: COLUMNS.height - INSET - 52, width, height: 52, text: "Send offer", variant: "primary", enabled: ready, onActivate: () => this.#send() }));
  }

  /** @param {ScrollList} list */
  #buildGiveList(list) {
    const copies = this.#tradeableCopies();
    if (copies.length === 0) {
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 3 * ROW.height, text: "No tradeable cards: only cards bought in the shop can be traded, not the free starter deck.", size: "small", colorKey: "textMuted" }));
      list.contentHeight = 3 * ROW.height;
      return;
    }
    copies.forEach((copy, index) => {
      const chosen = this.#give.has(copy.id);
      list.add(new OptionRow({ id: `trades.give.${copy.id}`, x: 0, y: rowY(index), width: list.rowWidth, height: ROW.height, text: this.#cardName(copy.definitionId), subtitle: `#${copy.serial} · ${copy.finish}`, selected: chosen, enabled: chosen || this.#give.size < MAX_CARDS, onActivate: () => this.#toggleGive(copy.id) }));
    });
    list.contentHeight = rowsHeight(copies.length);
  }

  /** @param {ScrollList} list */
  #buildAskList(list) {
    const cards = [...this.#app.content.catalog.all()].sort((left, right) => left.name.localeCompare(right.name));
    cards.forEach((card, index) => {
      const count = this.#ask.get(card.id) ?? 0;
      list.add(new OptionRow({ id: `trades.ask.${card.id}`, x: 0, y: rowY(index), width: list.rowWidth, height: ROW.height, text: card.name, subtitle: count === 0 ? card.faction : `asking ${count}`, selected: count > 0, onActivate: () => this.#cycleAsk(card.id) }));
    });
    list.contentHeight = rowsHeight(cards.length);
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
    this.#rebuild();
  }

  /** @param {string} value */
  #changeRecipient(value) {
    this.#to = value.trim().toLowerCase();
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

  /** @param {string} definitionId tap: one more, back to none after the maximum */
  #cycleAsk(definitionId) {
    const next = ((this.#ask.get(definitionId) ?? 0) + 1) % (MAX_ASK + 1);
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
