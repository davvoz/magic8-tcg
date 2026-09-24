/**
 * The signed-in player's cards, as the server says: every owned card with
 * its number of copies (filterable by faction) on the left, the selected
 * card at full size with each copy's serial, edition, finish and status on
 * the right. Read-only: no card is created, moved or destroyed here.
 */
import { AccountStatus } from "../../application/account/AccountService.js";
import { CardDetail } from "../cards/CardDetail.js";
import { CardStrip } from "../cards/CardStrip.js";
import { unknownCard } from "../cards/unknownCard.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { ACTION, COLUMNS, HEADER, INSET, ROW, rowY, rowsHeight } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const LIST_ID = "collection.cards";
const COPIES_ID = "collection.copies";
const ALL = "all";
const FILTER = Object.freeze({ top: 60, height: 40, gap: 6 });
const LIST_TOP = 120;
const DETAIL = Object.freeze({ width: 380, height: 560 });
const COPY_ROW = 30;
/** Where the status line starts, right of the title. */
const STATUS_OFFSET = 260;

/**
 * @typedef {Readonly<{ definitionId: string, card: import("../cards/CardDetail.js").CardLike | undefined, copies: readonly import("../../application/ports/CollectionApi.contract.js").OwnedCopy[] }>} OwnedCard
 */

export class CollectionScene extends Scene {
  #app;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** Faction shown, or "all". */
  #faction = ALL;
  /** @type {string | null} */
  #selectedId = null;
  /** Shown once under the title (e.g. after taking the starter deck). @type {string | null} */
  #notice = null;
  #scrollY = 0;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#app = app;
  }

  /** @param {Readonly<Record<string, unknown>>} params `{ notice?: string }` */
  enter(params = {}) {
    this.#notice = typeof params.notice === "string" ? params.notice : null;
    this.#faction = ALL;
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
    this.services.navigate(SceneId.MAIN_MENU);
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    const { theme, viewport } = this.services;
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "collection" });
    super.render(context);
  }

  /** Owned cards in the current filter, cheapest first. @returns {readonly OwnedCard[]} */
  ownedCards() {
    const catalog = this.#app.content.catalog;
    return this.#requireAccount()
      .collection.state.cards.map((entry) => Object.freeze({ definitionId: entry.definitionId, card: catalog.get(entry.definitionId), copies: entry.copies }))
      .filter((owned) => this.#faction === ALL || owned.card?.faction === this.#faction)
      .sort((left, right) => (left.card?.cost ?? 0) - (right.card?.cost ?? 0) || (left.card?.name ?? left.definitionId).localeCompare(right.card?.name ?? right.definitionId));
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
    const listPanel = this.root.add(new Panel({ x: COLUMNS.left.x, y: COLUMNS.top, width: COLUMNS.left.width, height: COLUMNS.height }));
    const firstFilter = this.#buildFilters(listPanel);
    const firstRow = this.#buildList(listPanel, cards);
    const detailPanel = this.root.add(new Panel({ x: COLUMNS.right.x, y: COLUMNS.top, width: COLUMNS.right.width, height: COLUMNS.height }));
    this.#buildDetail(detailPanel, cards.find((owned) => owned.definitionId === this.#selectedId));
    this.focus(this.root.findById(focusedId) ?? firstRow ?? firstFilter ?? back);
    this.services.requestRender();
  }

  /** @returns {Button} the Back button */
  #buildHeader() {
    const { viewport } = this.services;
    const statusX = HEADER.sideMargin + STATUS_OFFSET;
    this.root.add(new Label({ x: HEADER.sideMargin, y: HEADER.y, width: STATUS_OFFSET, height: HEADER.height, text: "Collection", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const status = this.#status();
    this.root.add(new Label({ id: "collection.status", x: statusX, y: HEADER.y, width: viewport.logicalWidth - HEADER.sideMargin - HEADER.backWidth - INSET - statusX, height: HEADER.height, text: status.text, size: "small", align: "left", colorKey: status.colorKey, fit: true }));
    return this.root.add(new Button({ id: "collection.back", x: viewport.logicalWidth - HEADER.sideMargin - HEADER.backWidth, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: "Back to menu", onActivate: () => this.services.navigate(SceneId.MAIN_MENU) }));
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
    const copies = entries.reduce((total, entry) => total + entry.copies.length, 0);
    return { text: `@${account.state.account} · ${copies} card${copies === 1 ? "" : "s"} · ${entries.length} of ${this.#app.content.catalog.size} different`, colorKey: "textMuted" };
  }

  /**
   * @param {Panel} panel
   * @returns {Button | null} the first filter button
   */
  #buildFilters(panel) {
    const options = [ALL, ...this.#app.content.deckRules.factions];
    const inner = COLUMNS.left.width - 2 * INSET;
    const width = (inner - (options.length - 1) * FILTER.gap) / options.length;
    panel.add(new Label({ x: INSET, y: 14, width: inner, height: 36, text: "Your cards", size: "heading", weight: "bold", colorKey: "accentLight", align: "left" }));
    /** @type {Button | null} */
    let first = null;
    options.forEach((faction, index) => {
      const button = panel.add(
        new Button({
          id: `collection.filter.${faction}`,
          x: INSET + index * (width + FILTER.gap),
          y: FILTER.top,
          width,
          height: FILTER.height,
          text: faction,
          variant: faction === this.#faction ? "primary" : "secondary",
          textSize: "small",
          onActivate: () => this.#filter(faction),
        }),
      );
      first ??= button;
    });
    return first;
  }

  /**
   * @param {Panel} panel
   * @param {readonly OwnedCard[]} cards
   * @returns {Button | null} the first row's button
   */
  #buildList(panel, cards) {
    const width = COLUMNS.left.width - 2 * INSET;
    const list = panel.add(new ScrollList({ id: LIST_ID, x: INSET, y: LIST_TOP, width, height: COLUMNS.height - LIST_TOP - INSET }));
    if (cards.length === 0) {
      list.add(new Label({ x: 0, y: 0, width: list.rowWidth, height: ROW.height, text: this.#emptyText(), colorKey: "textMuted", fit: true }));
      list.contentHeight = ROW.height;
      return this.#requireAccount().needsStarter ? this.#buildStarterLink(list) : null;
    }
    const labelWidth = list.rowWidth - ACTION.width - ACTION.gap;
    /** @type {Button | null} */
    let first = null;
    cards.forEach((owned, index) => {
      const y = rowY(index);
      const selected = owned.definitionId === this.#selectedId;
      list.add(new CardStrip({ x: 0, y, width: labelWidth, height: ROW.height, card: owned.card ?? unknownCard(owned.definitionId), count: owned.copies.length, broken: owned.card === undefined, muted: !selected }));
      const view = list.add(new Button({ id: `collection.view.${owned.definitionId}`, x: labelWidth + ACTION.gap, y, width: ACTION.width, height: ROW.height, text: "View", variant: selected ? "primary" : "secondary", onActivate: () => this.#select(owned.definitionId) }));
      first ??= view;
    });
    list.contentHeight = rowsHeight(cards.length);
    list.scrollTo(this.#scrollY);
    return first;
  }

  #emptyText() {
    if (this.#requireAccount().state.status !== AccountStatus.READY) {
      return "";
    }
    return this.#faction === ALL ? "No cards yet." : `No ${this.#faction} cards yet.`;
  }

  /** @param {ScrollList} list */
  #buildStarterLink(list) {
    return list.add(new Button({ id: "collection.starter", x: 0, y: ROW.height + ROW.gap, width: list.rowWidth, height: ROW.height, text: "Take your free starter deck", variant: "primary", enabled: this.services.hasScene(SceneId.STARTER), onActivate: () => this.services.navigate(SceneId.STARTER) }));
  }

  /**
   * @param {Panel} panel
   * @param {OwnedCard | undefined} owned
   */
  #buildDetail(panel, owned) {
    if (owned === undefined) {
      panel.add(new Label({ x: INSET, y: INSET, width: COLUMNS.right.width - 2 * INSET, height: 30, text: "Select a card to see its copies.", size: "small", align: "left", colorKey: "textMuted" }));
      return;
    }
    const card = owned.card ?? unknownCard(owned.definitionId);
    const top = (COLUMNS.height - DETAIL.height) / 2;
    if (owned.card !== undefined) {
      panel.add(new CardDetail({ id: "collection.card", x: INSET, y: top, width: DETAIL.width, height: DETAIL.height, card: owned.card }));
    }
    const x = INSET + DETAIL.width + INSET;
    const width = COLUMNS.right.width - x - INSET;
    panel.add(new Label({ x, y: top, width, height: 40, text: card.name, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const active = owned.copies.filter((copy) => copy.status === "active").length;
    panel.add(new Label({ id: "collection.owned", x, y: top + 46, width, height: 28, text: `You own ${owned.copies.length} (${active} playable)`, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    const list = panel.add(new ScrollList({ id: COPIES_ID, x, y: top + 84, width, height: DETAIL.height - 84 }));
    const copies = [...owned.copies].sort((left, right) => left.edition.localeCompare(right.edition) || left.serial - right.serial);
    copies.forEach((copy, index) => {
      list.add(new Label({ x: 0, y: index * COPY_ROW, width: list.rowWidth, height: COPY_ROW, text: `#${copy.serial} · ${copy.edition} · ${copy.finish}${copy.status === "active" ? "" : ` · ${copy.status}`}`, size: "small", align: "left", colorKey: copy.status === "active" ? "text" : "disabledText", fit: true }));
    });
    list.contentHeight = copies.length * COPY_ROW;
  }

  /** @param {string} faction */
  #filter(faction) {
    this.#faction = faction;
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
