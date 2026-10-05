/**
 * The signed-in player's cards, as the server says: every owned card with
 * its number of copies (filterable by faction, rarity and type) on the left, the selected
 * card at full size with each copy's serial, edition and status on the
 * right. Read-only: no card is created, moved or destroyed here.
 * Opened from a notification, the cards that came with it are "fresh":
 * listed first, lit and tagged, the first of them selected, and the copies
 * whose serial is known lit in its details.
 * On a compact screen the filter is one button beside the list's title and
 * a card is picked by tapping its strip.
 * The header opens the Deck Builder (which comes back here), the market and
 * the trades.
 */
import { AccountStatus } from "../../application/account/AccountService.js";
import { NO_CARD_FILTER, cardFilterOptions, describeCardFilter, isFiltering, matchesCardFilter } from "../../application/content/CardFilter.js";
import { CARD_FILTER_BAR_HEIGHT, CARD_FILTER_BUTTON_HEIGHT, buildCardFilterBar, buildCardFilterButton } from "../cards/cardFilterBar.js";
import { CardDetail } from "../cards/CardDetail.js";
import { CardStrip } from "../cards/CardStrip.js";
import { copyLabel, rarityOf } from "../cards/cardInfo.js";
import { rarityColorKey, rarityLabel } from "../theme/rarity.js";
import { unknownCard } from "../cards/unknownCard.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Hotspot } from "../ui/Hotspot.js";
import { Label } from "../ui/Label.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const LIST_ID = "collection.cards";
const COPIES_ID = "collection.copies";
/**
 * @typedef {Readonly<{ filterTop: number, listTop: number, filterButton: boolean, titleWidth: number, detail: { width: number, height: number }, copyRow: number, copiesHeader: { title: number, hint: number, hintSize: import("../theme/Theme.js").FontSize, gap: number }, statusOffset: number }>} CollectionMetrics
 *   `filterButton`: the filter as one button beside the list's title; `copiesHeader`: the "Your copies" title and its hint (two wrapped lines) above the copies; `statusOffset`: where the status line starts, right of the title
 */
/** @type {CollectionMetrics} */
const WIDE = Object.freeze({ filterTop: 60, listTop: 60 + CARD_FILTER_BAR_HEIGHT + 12, filterButton: false, titleWidth: 0, detail: Object.freeze({ width: 380, height: 560 }), copyRow: 30, copiesHeader: Object.freeze({ title: 26, hint: 44, hintSize: "small", gap: 4 }), statusOffset: 260 });
/** @type {CollectionMetrics} */
const COMPACT = Object.freeze({ filterTop: 12, listTop: 12 + CARD_FILTER_BUTTON_HEIGHT + 10, filterButton: true, titleWidth: 150, detail: Object.freeze({ width: 196, height: 274 }), copyRow: 26, copiesHeader: Object.freeze({ title: 22, hint: 34, hintSize: "tiny", gap: 2 }), statusOffset: 170 });
/** What a copy's status (and tradeability) means to its owner, shown after its name. */
const STATUS_NOTES = new Map([["locked", "in a trade"], ["burned", "burned"]]);
/** Room for the "New: …" line above the copies of a fresh card. */
const FRESH_LINE = 30;

/**
 * @typedef {Readonly<{ definitionId: string, count?: number, serial?: number }>} FreshCard a card just received (from a notification)
 * @typedef {Readonly<{ count: number, serials: ReadonlySet<number> }>} Freshness how many copies of a card are new, and the serials known
 * @typedef {Readonly<{ definitionId: string, card: import("../cards/CardDetail.js").CardLike | undefined, copies: readonly import("../../application/ports/CollectionApi.contract.js").OwnedCopy[] }>} OwnedCard
 */

/** The narrowest the header's status line is worth showing at. */
const MIN_STATUS_WIDTH = 80;

export class CollectionScene extends Scene {
  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return screenLayout(this.services.viewport);
  }

  /** @returns {CollectionMetrics} */
  get #metrics() {
    return this.#screen.compact ? COMPACT : WIDE;
  }

  #app;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** @type {import("../../application/content/CardFilter.js").CardFilter} */
  #filter = NO_CARD_FILTER;
  /** @type {string | null} */
  #selectedId = null;
  /** Shown once under the title (e.g. after taking the starter deck). @type {string | null} */
  #notice = null;
  /** Cards just received, by definition id. @type {ReadonlyMap<string, Freshness>} */
  #fresh = new Map();
  /** Where Back leads: the scene the player came from. @type {string} */
  #from = SceneId.MAIN_MENU;
  #scrollY = 0;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#app = app;
  }

  /** @param {Readonly<Record<string, unknown>>} params `{ notice?: string, fresh?: FreshCard[], from?: string }` */
  enter(params = {}) {
    this.#notice = typeof params.notice === "string" ? params.notice : null;
    this.#fresh = freshness(params.fresh);
    this.#from = typeof params.from === "string" && this.services.hasScene(params.from) ? params.from : SceneId.MAIN_MENU;
    this.#filter = NO_CARD_FILTER;
    this.#selectedId = null;
    this.#scrollY = 0;
    this.#unsubscribe = this.#requireAccount().subscribe(() => this.#rebuild());
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
    this.services.navigate(this.#from);
  }

  relayout() {
    this.#rebuild();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    const { theme, viewport } = this.services;
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "collection" });
    super.render(context);
  }

  /** Owned cards in the current filter: the fresh ones first, then cheapest first. @returns {readonly OwnedCard[]} */
  ownedCards() {
    const catalog = this.#app.content.catalog;
    const fresh = (/** @type {OwnedCard} */ owned) => (this.#fresh.has(owned.definitionId) ? 0 : 1);
    return this.#requireAccount()
      .collection.state.cards.map((entry) => Object.freeze({ definitionId: entry.definitionId, card: catalog.get(entry.definitionId), copies: entry.copies }))
      .filter((owned) => matchesCardFilter(this.#filter, owned.card, rarityOf(this.#app, owned.definitionId)))
      .sort((left, right) => fresh(left) - fresh(right) || (left.card?.cost ?? 0) - (right.card?.cost ?? 0) || (left.card?.name ?? left.definitionId).localeCompare(right.card?.name ?? right.definitionId));
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.#scrollY = this.#listScroll() ?? this.#scrollY;
    this.root.clear();
    const back = this.#buildHeader();
    const cards = this.ownedCards();
    if (!cards.some((owned) => owned.definitionId === this.#selectedId)) {
      this.#selectedId = cards[0]?.definitionId ?? null;
    }
    const listPanel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.left.x, y: this.#screen.columns.top, width: this.#screen.columns.left.width, height: this.#screen.columns.height }));
    const firstFilter = this.#buildFilters(listPanel);
    const firstRow = this.#buildList(listPanel, cards);
    const detailPanel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.right.x, y: this.#screen.columns.top, width: this.#screen.columns.right.width, height: this.#screen.columns.height }));
    this.#buildDetail(detailPanel, cards.find((owned) => owned.definitionId === this.#selectedId));
    this.focus(this.root.findById(focusedId) ?? firstRow ?? firstFilter ?? back);
    this.services.requestRender();
  }

  /** @returns {Button} the Back button */
  #buildHeader() {
    const { viewport, hasScene, navigate } = this.services;
    const { header } = this.#screen;
    const { statusOffset } = this.#metrics;
    const statusX = header.sideMargin + statusOffset;
    this.root.add(new Label({ x: header.sideMargin, y: header.y, width: statusOffset, height: header.height, text: "Collection", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true, fit: true }));
    // Right to left from the edge: Back, then the other screens.
    const buttons = [
      { id: "collection.back", text: this.#from === SceneId.MAIN_MENU ? this.#screen.backText : "Back", onActivate: () => navigate(this.#from) },
      ...(hasScene(SceneId.TRADES) ? [{ id: "collection.trades", text: "Trades", onActivate: () => navigate(SceneId.TRADES) }] : []),
      ...(hasScene(SceneId.MARKET) ? [{ id: "collection.market", text: "Market", onActivate: () => navigate(SceneId.MARKET, { from: SceneId.COLLECTION }) }] : []),
      ...(hasScene(SceneId.DECK_BUILDER) ? [{ id: "collection.decks", text: "Deck Builder", onActivate: () => navigate(SceneId.DECK_BUILDER, { from: SceneId.COLLECTION }) }] : []),
    ];
    const step = header.backWidth + header.gap;
    const nodes = buttons.map((spec, index) => this.root.add(new Button({ keepPlate: true, ...spec, x: viewport.logicalWidth - header.sideMargin - header.backWidth - index * step, y: header.y + 4, width: header.backWidth, height: header.height - 8 })));
    // The status takes what the buttons leave; on a phone that may be nothing.
    const statusWidth = viewport.logicalWidth - header.sideMargin - buttons.length * step - this.#screen.inset - statusX;
    if (statusWidth >= MIN_STATUS_WIDTH) {
      const status = this.#status();
      this.root.add(new Label({ id: "collection.status", x: statusX, y: header.y, width: statusWidth, height: header.height, text: status.text, size: "small", align: "left", colorKey: status.colorKey, fit: true }));
    }
    return nodes[0];
  }

  /** @returns {{ text: string, colorKey: string }} */
  #status() {
    const account = this.#requireAccount();
    const { status, error } = account.state;
    if (status === AccountStatus.SIGNED_OUT) {
      return { text: "Sign in to see your cards.", colorKey: "textMuted" };
    }
    if (status === AccountStatus.LOADING) {
      return { text: "Loading your collection…", colorKey: "textMuted" };
    }
    if (status === AccountStatus.FAILED) {
      return { text: `Your collection could not be loaded: ${error?.message ?? "unknown error"}`, colorKey: "danger" };
    }
    if (this.#notice !== null) {
      return { text: this.#notice, colorKey: "success" };
    }
    const entries = account.collection.state.cards;
    const fresh = entries.reduce((total, entry) => total + (this.#fresh.get(entry.definitionId)?.count ?? 0), 0);
    if (fresh > 0) {
      return { text: `${fresh} new card${fresh === 1 ? "" : "s"}: lit at the top of the list.`, colorKey: "success" };
    }
    const copies = entries.reduce((total, entry) => total + entry.copies.length, 0);
    return { text: `@${account.state.account} · ${copies} card${copies === 1 ? "" : "s"} · ${entries.length} of ${this.#app.content.catalog.size} different`, colorKey: "textMuted" };
  }

  /**
   * @param {Panel} panel
   * @returns {Button | null} the first filter button
   */
  #buildFilters(panel) {
    const { inset } = this.#screen;
    const { filterTop, filterButton, titleWidth } = this.#metrics;
    const inner = this.#screen.columns.left.width - 2 * inset;
    const filter = { id: "collection.filter", filter: this.#filter, options: cardFilterOptions(this.#app), onChange: (/** @type {import("../../application/content/CardFilter.js").CardFilter} */ chosen) => this.#changeFilter(chosen) };
    if (filterButton) {
      panel.add(new Label({ x: inset, y: filterTop, width: titleWidth, height: CARD_FILTER_BUTTON_HEIGHT, text: "Your cards", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
      return buildCardFilterButton(panel, { ...filter, x: inset + titleWidth, y: filterTop, width: inner - titleWidth, dialog: { viewport: this.services.viewport, open: (modal) => this.openModal(modal), close: () => this.closeModal() } });
    }
    panel.add(new Label({ x: inset, y: 14, width: inner, height: 36, text: "Your cards", size: "heading", weight: "bold", colorKey: "accentLight", align: "left" }));
    return buildCardFilterBar(panel, { ...filter, x: inset, y: filterTop, width: inner });
  }

  /**
   * @param {Panel} panel
   * @param {readonly OwnedCard[]} cards
   * @returns {Button | Hotspot | null} the first row's button
   */
  #buildList(panel, cards) {
    const width = this.#screen.columns.left.width - 2 * this.#screen.inset;
    const { listTop } = this.#metrics;
    const list = panel.add(new ScrollList({ id: LIST_ID, x: this.#screen.inset, y: listTop, width, height: this.#screen.columns.height - listTop - this.#screen.inset }));
    if (cards.length === 0) {
      list.add(new Label({ x: 0, y: 0, width: list.rowWidth, height: this.#screen.row.height, text: this.#emptyText(), colorKey: "textMuted", fit: true }));
      list.contentHeight = this.#screen.row.height;
      return this.#requireAccount().needsStarter ? this.#buildStarterLink(list) : null;
    }
    const { compact, action, row } = this.#screen;
    // A phone has no room for View beside the strip: the strip itself picks the card.
    const labelWidth = compact ? list.rowWidth : list.rowWidth - action.width - action.gap;
    /** @type {Button | Hotspot | null} */
    let first = null;
    cards.forEach((owned, index) => {
      const y = this.#screen.rowY(index);
      const selected = owned.definitionId === this.#selectedId;
      const fresh = this.#fresh.has(owned.definitionId);
      list.add(new CardStrip({ id: `collection.strip.${owned.definitionId}`, x: 0, y, width: labelWidth, height: row.height, card: owned.card ?? unknownCard(owned.definitionId), count: owned.copies.length, broken: owned.card === undefined, muted: !selected && !fresh, rarity: rarityOf(this.#app, owned.definitionId), fresh }));
      const select = () => this.#select(owned.definitionId);
      const id = `collection.view.${owned.definitionId}`;
      const view = compact ? list.add(new Hotspot({ id, x: 0, y, width: labelWidth, height: row.height, onActivate: select })) : list.add(new Button({ id, x: labelWidth + action.gap, y, width: action.width, height: row.height, text: "View", variant: selected ? "primary" : "secondary", onActivate: select }));
      first ??= view;
    });
    list.contentHeight = this.#screen.rowsHeight(cards.length);
    list.scrollTo(this.#scrollY);
    return first;
  }

  #emptyText() {
    if (this.#requireAccount().state.status !== AccountStatus.READY) {
      return "";
    }
    return isFiltering(this.#filter) ? `No ${describeCardFilter(this.#filter)} cards.` : "No cards yet.";
  }

  /** @param {ScrollList} list */
  #buildStarterLink(list) {
    return list.add(new Button({ id: "collection.starter", x: 0, y: this.#screen.row.height + this.#screen.row.gap, width: list.rowWidth, height: this.#screen.row.height, text: "Take your free starter deck", variant: "primary", enabled: this.services.hasScene(SceneId.STARTER), onActivate: () => this.services.navigate(SceneId.STARTER) }));
  }

  /**
   * @param {Panel} panel
   * @param {OwnedCard | undefined} owned
   */
  #buildDetail(panel, owned) {
    if (owned === undefined) {
      panel.add(new Label({ x: this.#screen.inset, y: this.#screen.inset, width: this.#screen.columns.right.width - 2 * this.#screen.inset, height: 30, text: "Select a card to see its copies.", size: "small", align: "left", colorKey: "textMuted" }));
      return;
    }
    const card = owned.card ?? unknownCard(owned.definitionId);
    const { detail, copyRow, copiesHeader } = this.#metrics;
    const top = (this.#screen.columns.height - detail.height) / 2;
    if (owned.card !== undefined) {
      panel.add(new CardDetail({ id: "collection.card", x: this.#screen.inset, y: top, width: detail.width, height: detail.height, card: owned.card, rarity: rarityOf(this.#app, owned.definitionId) }));
    }
    const x = this.#screen.inset + detail.width + this.#screen.inset;
    const width = this.#screen.columns.right.width - x - this.#screen.inset;
    const rarity = rarityOf(this.#app, owned.definitionId);
    panel.add(new Label({ x, y: top, width, height: 40, text: card.name, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    panel.add(new Label({ id: "collection.rarity", x, y: top + 42, width, height: 28, text: rarity === null ? "Rarity unknown" : rarityLabel(rarity), weight: "bold", align: "left", colorKey: rarityColorKey(rarity) }));
    const active = owned.copies.filter((copy) => copy.status === "active").length;
    panel.add(new Label({ id: "collection.owned", x, y: top + 72, width, height: 28, text: `You own ${owned.copies.length} (${active} playable)`, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    const fresh = this.#fresh.get(owned.definitionId);
    let copiesTop = top + 108;
    if (fresh !== undefined) {
      panel.add(new Label({ id: "collection.fresh", x, y: copiesTop - 4, width, height: 28, text: `New: ${fresh.count} cop${fresh.count === 1 ? "y" : "ies"} just received`, size: "small", weight: "bold", align: "left", colorKey: "success", fit: true }));
      copiesTop += FRESH_LINE;
    }
    panel.add(new Label({ id: "collection.copiesTitle", x, y: copiesTop, width, height: copiesHeader.title, text: owned.copies.length === 1 ? "Your copy" : "Your copies", size: "small", weight: "bold", align: "left", colorKey: "accentLight" }));
    panel.add(new TextBlock({ id: "collection.copiesHint", x, y: copiesTop + copiesHeader.title, width, height: copiesHeader.hint, text: "Each copy is unique: its serial number and print edition", size: copiesHeader.hintSize, align: "left", colorKey: "textMuted" }));
    copiesTop += copiesHeader.title + copiesHeader.hint + copiesHeader.gap;
    const list = panel.add(new ScrollList({ id: COPIES_ID, x, y: copiesTop, width, height: detail.height - (copiesTop - top) }));
    // The copies received with the notification (when their serials are known) come first, lit.
    const isNew = (/** @type {{ serial: number }} */ copy) => fresh?.serials.has(copy.serial) ?? false;
    const copies = [...owned.copies].sort((left, right) => Number(isNew(right)) - Number(isNew(left)) || left.edition.localeCompare(right.edition) || left.serial - right.serial);
    copies.forEach((copy, index) => {
      const lit = isNew(copy);
      const notes = [copyNote(copy), lit ? "new" : ""].filter((note) => note.length > 0).map((note) => ` · ${note}`).join("");
      const colorKey = copy.status === "active" ? "text" : "disabledText";
      list.add(new Label({ x: 0, y: index * copyRow, width: list.rowWidth, height: copyRow, text: `${copyLabel(copy)}${notes}`, size: "small", weight: lit ? "bold" : "normal", align: "left", colorKey: lit ? "success" : colorKey, fit: true }));
    });
    list.contentHeight = copies.length * copyRow;
  }

  /** @param {import("../../application/content/CardFilter.js").CardFilter} filter */
  #changeFilter(filter) {
    this.#filter = filter;
    const list = this.root.findById(LIST_ID);
    if (list instanceof ScrollList) {
      list.scrollTo(0);
    }
    this.#rebuild();
  }

  /** @param {string} definitionId */
  #select(definitionId) {
    this.#selectedId = definitionId;
    this.#rebuild();
  }

  /** Scroll offset of the card list, if it is on screen. */
  #listScroll() {
    const list = this.root.findById(LIST_ID);
    return list instanceof ScrollList ? list.scrollY : null;
  }

  #requireAccount() {
    if (this.#app.account === undefined) {
      throw new Error("CollectionScene needs an account service");
    }
    return this.#app.account;
  }
}

/**
 * The cards a notification brought, by definition id (copies of one card
 * named twice are added up).
 * @param {unknown} value
 * @returns {ReadonlyMap<string, Freshness>}
 */
function freshness(value) {
  /** @type {Map<string, { count: number, serials: Set<number> }>} */
  const fresh = new Map();
  for (const card of Array.isArray(value) ? value : []) {
    if (typeof card?.definitionId !== "string") {
      continue;
    }
    const entry = fresh.get(card.definitionId) ?? { count: 0, serials: new Set() };
    entry.count += Number.isSafeInteger(card.count) && card.count > 0 ? card.count : 1;
    if (Number.isSafeInteger(card.serial)) {
      entry.serials.add(card.serial);
    }
    fresh.set(card.definitionId, entry);
  }
  return fresh;
}

/**
 * What the owner should know about a copy beyond its name: in a trade, or a reward that cannot be traded.
 * @param {import("../../application/ports/CollectionApi.contract.js").OwnedCopy} copy
 */
function copyNote(copy) {
  if (copy.status !== "active") {
    return STATUS_NOTES.get(copy.status) ?? copy.status;
  }
  return copy.tradeable === false ? "not tradeable" : "";
}
