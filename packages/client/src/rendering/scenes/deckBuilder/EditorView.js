/**
 * Deck builder, editor view: the draft on the left (name field, size and
 * rule report, entries with −/+), the browsable catalog on the right,
 * filterable by faction, rarity and type.
 * Every change goes through DeckBuildingService; the view then rebuilds
 * from the service's draft and report, so what is shown is always what
 * would be saved.
 * On a compact screen the size line and the rule report share a row, a
 * refused edit is told in the report's place, and the catalog's filter is
 * one button beside its title.
 */
import { NO_CARD_FILTER, cardFilterOptions, describeCardFilter, matchesCardFilter } from "../../../application/content/CardFilter.js";
import { CARD_FILTER_BAR_HEIGHT, CARD_FILTER_BUTTON_HEIGHT, buildCardFilterBar, buildCardFilterButton } from "../../cards/cardFilterBar.js";
import { CardStrip } from "../../cards/CardStrip.js";
import { mixText } from "../../cards/deckStripe.js";
import { rarityOf } from "../../cards/cardInfo.js";
import { unknownCard } from "../../cards/unknownCard.js";
import { Button } from "../../ui/Button.js";
import { Hotspot } from "../../ui/Hotspot.js";
import { Label } from "../../ui/Label.js";
import { Panel } from "../../ui/Panel.js";
import { ScrollList } from "../../ui/ScrollList.js";
import { TextField } from "../../ui/TextField.js";

const DECK_LIST_ID = "editor.deck";
const CATALOG_LIST_ID = "editor.catalog";
/**
 * @typedef {Readonly<{ nameHeight: number, metaTop: number, metaHeight: number, oneMetaRow: boolean, listTop: number, footerHeight: number, noticeHeight: number, catalogFilterTop: number, catalogListTop: number, filterButton: boolean }>} EditorMetrics
 *   `oneMetaRow`: the size line and the report side by side; `noticeHeight`: room above the footer for a refused edit (0: told in the report's place);
 *   `filterButton`: the catalog's filter as one button beside its title
 */
/** @type {EditorMetrics} */
const WIDE = Object.freeze({ nameHeight: 52, metaTop: 84, metaHeight: 26, oneMetaRow: false, listTop: 144, footerHeight: 52, noticeHeight: 30, catalogFilterTop: 60, catalogListTop: 60 + CARD_FILTER_BAR_HEIGHT + 12, filterButton: false });
/** @type {EditorMetrics} */
const COMPACT = Object.freeze({ nameHeight: 46, metaTop: 68, metaHeight: 24, oneMetaRow: true, listTop: 98, footerHeight: 46, noticeHeight: 0, catalogFilterTop: 12, catalogListTop: 12 + CARD_FILTER_BUTTON_HEIGHT + 10, filterButton: true });
/** On a compact screen: how much of the meta row the size line takes, and how wide the catalog's title is. */
const COMPACT_SPLIT = Object.freeze({ meta: 0.58, title: 92 });

export class EditorView {
  #host;

  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return this.#host.screen();
  }

  /** @returns {EditorMetrics} */
  get #metrics() {
    return this.#screen.compact ? COMPACT : WIDE;
  }
  /** Raw text in the name field (may be invalid while typing); null when in sync with the draft. @type {string | null} */
  #nameText = null;
  /** Draft the raw name text belongs to. @type {string | null} */
  #nameDraftId = null;
  /** Last refused operation, shown until the next successful one. @type {string | null} */
  #notice = null;
  /** A save is on its way to storage (the server, when signed in). */
  #saving = false;
  /** Cards the catalog shows. @type {import("../../../application/content/CardFilter.js").CardFilter} */
  #filter = NO_CARD_FILTER;
  /** The catalog starts from the top on the next build (the filter changed). */
  #catalogToTop = false;

  /** @param {import("./layout.js").BuilderHost} host */
  constructor(host) {
    this.#host = host;
  }

  /**
   * @param {import("../../ui/UiNode.js").UiNode} root
   * @returns {import("../../ui/UiNode.js").UiNode | null} node to focus initially
   */
  build(root) {
    const builder = this.#host.app.deckBuilding;
    const draft = builder.draft;
    if (draft === null) {
      return null;
    }
    if (draft.id !== this.#nameDraftId) {
      this.#nameText = null;
      this.#nameDraftId = draft.id;
      this.#notice = null;
    }
    const deckPanel = root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.left.x, y: this.#screen.columns.top, width: this.#screen.columns.left.width, height: this.#screen.columns.height }));
    const nameField = this.#buildDeckHeader(deckPanel, draft);
    this.#buildDeckList(deckPanel, draft);
    this.#buildFooter(deckPanel);

    const catalogPanel = root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.right.x, y: this.#screen.columns.top, width: this.#screen.columns.right.width, height: this.#screen.columns.height }));
    this.#buildCatalog(catalogPanel);
    return nameField;
  }

  /**
   * @param {Panel} panel
   * @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} draft
   */
  #buildDeckHeader(panel, draft) {
    const builder = this.#host.app.deckBuilding;
    const rules = builder.rules;
    const width = this.#screen.columns.left.width - 2 * this.#screen.inset;
    const nameField = panel.add(
      new TextField({
        id: "editor.name",
        x: this.#screen.inset,
        y: this.#screen.inset,
        width,
        height: this.#metrics.nameHeight,
        value: this.#nameText ?? draft.name,
        placeholder: "Deck name",
        maxLength: rules.deckNameMaxLength,
        onChange: (value) => this.#rename(value),
      }),
    );
    const state = builder.hasUnsavedChanges ? "unsaved changes" : "saved";
    // The mix goes last: when it is long, it is what gets shortened.
    const meta = [`${draft.totalCards} / ${rules.minSize}–${rules.maxSize} cards`, state, mixText(builder.mix())].filter((part) => part.length > 0).join(" · ");
    const metrics = this.#metrics;
    const metaWidth = metrics.oneMetaRow ? Math.round(width * COMPACT_SPLIT.meta) : width;
    panel.add(new Label({ id: "editor.meta", x: this.#screen.inset, y: metrics.metaTop, width: metaWidth, height: metrics.metaHeight, text: meta, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    const report = this.#reportLine();
    const reportBox = metrics.oneMetaRow ? { x: this.#screen.inset + metaWidth + 8, y: metrics.metaTop, width: width - metaWidth - 8 } : { x: this.#screen.inset, y: metrics.metaTop + metrics.metaHeight + 2, width };
    panel.add(new Label({ id: report.id, ...reportBox, height: metrics.metaHeight, text: report.text, size: "small", align: metrics.oneMetaRow ? "right" : "left", colorKey: report.colorKey, fit: true }));
    return nameField;
  }

  /**
   * The report line: whether the deck is legal; where there is no room for a
   * notice line of its own (compact), a refused edit is told here instead.
   * @returns {{ id: string, text: string, colorKey: string }}
   */
  #reportLine() {
    if (this.#metrics.noticeHeight === 0 && this.#notice !== null) {
      return { id: "editor.notice", text: this.#notice, colorKey: "danger" };
    }
    const problem = this.#firstProblem();
    return { id: "editor.report", text: problem ?? "Legal deck", colorKey: problem === null ? "success" : "danger" };
  }

  /** The name field's own problem first, then the rule report's. */
  #firstProblem() {
    const builder = this.#host.app.deckBuilding;
    if (this.#nameText !== null && this.#nameText.trim().length === 0) {
      return `Name must be 1–${builder.rules.deckNameMaxLength} characters`;
    }
    const report = builder.report();
    const problem = report?.problems[0];
    if (report === null || problem === undefined) {
      return null;
    }
    const more = report.problems.length > 1 ? ` (+${report.problems.length - 1} more)` : "";
    return `${problem.message}${more}`;
  }

  /**
   * @param {Panel} panel
   * @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} draft
   */
  #buildDeckList(panel, draft) {
    const builder = this.#host.app.deckBuilding;
    const catalog = this.#host.app.content.catalog;
    const width = this.#screen.columns.left.width - 2 * this.#screen.inset;
    const { listTop, footerHeight, noticeHeight } = this.#metrics;
    const list = panel.add(new ScrollList({ id: DECK_LIST_ID, x: this.#screen.inset, y: listTop, width, height: this.#screen.columns.height - listTop - footerHeight - noticeHeight - 2 * this.#screen.inset }));
    if (draft.entries.length === 0) {
      list.add(new Label({ x: 0, y: 0, width, height: this.#screen.row.height, text: "Empty deck — add cards from the list on the right.", colorKey: "textMuted", fit: true }));
      list.contentHeight = this.#screen.row.height;
      return;
    }
    const addable = new Set(builder.addableCardIds());
    draft.entries.forEach((entry, index) => {
      const definition = catalog.get(entry.cardId);
      const card = definition ?? unknownCard(entry.cardId);
      this.#buildDeckRow(list, { y: this.#screen.rowY(index), card, count: entry.count, cardId: entry.cardId, canAdd: addable.has(entry.cardId), known: definition !== undefined });
    });
    list.contentHeight = this.#screen.rowsHeight(draft.entries.length);
    list.scrollTo(this.#host.scroll[DECK_LIST_ID] ?? 0);
  }

  /**
   * @param {ScrollList} list
   * @param {{ y: number, card: import("../../cards/CardStrip.js").StripCard, count: number, cardId: string, canAdd: boolean, known: boolean }} row
   */
  #buildDeckRow(list, { y, card, count, cardId, canAdd, known }) {
    const { action, row, compact } = this.#screen;
    // A phone has no room for Info beside the strip: the strip itself opens the card.
    const info = compact ? 0 : action.width + action.gap;
    const actionsWidth = info + 2 * action.small + action.gap;
    const labelWidth = list.rowWidth - actionsWidth - action.gap;
    list.add(new CardStrip({ x: 0, y, width: labelWidth, height: row.height, card, count, broken: !known, rarity: rarityOf(this.#host.app, cardId) }));
    let x = labelWidth + action.gap;
    if (compact) {
      list.add(new Hotspot({ id: `deck.info.${cardId}`, x: 0, y, width: labelWidth, height: row.height, enabled: known, onActivate: () => this.#host.inspect(cardId) }));
    } else {
      list.add(new Button({ id: `deck.info.${cardId}`, x, y, width: action.width, height: row.height, text: "Info", enabled: known, onActivate: () => this.#host.inspect(cardId) }));
      x += action.width + action.gap;
    }
    list.add(new Button({ id: `deck.remove.${cardId}`, x, y, width: this.#screen.action.small, height: this.#screen.row.height, text: "−", onActivate: () => this.#apply(this.#host.app.deckBuilding.removeCard(cardId)) }));
    x += this.#screen.action.small + this.#screen.action.gap;
    list.add(new Button({ id: `deck.add.${cardId}`, x, y, width: this.#screen.action.small, height: this.#screen.row.height, text: "+", enabled: canAdd, onActivate: () => this.#apply(this.#host.app.deckBuilding.addCard(cardId)) }));
  }

  /** @param {Panel} panel */
  #buildFooter(panel) {
    const builder = this.#host.app.deckBuilding;
    const width = this.#screen.columns.left.width - 2 * this.#screen.inset;
    const buttonWidth = (width - this.#screen.action.gap) / 2;
    const { footerHeight, noticeHeight } = this.#metrics;
    const y = this.#screen.columns.height - this.#screen.inset - footerHeight;
    if (this.#notice !== null && noticeHeight > 0) {
      panel.add(new Label({ id: "editor.notice", x: this.#screen.inset, y: y - noticeHeight, width, height: 26, text: this.#notice, size: "small", align: "left", colorKey: "danger", fit: true }));
    }
    panel.add(new Button({ id: "editor.save", x: this.#screen.inset, y, width: buttonWidth, height: footerHeight, text: this.#saving ? "Saving…" : "Save deck", variant: "primary", enabled: builder.hasUnsavedChanges && !this.#saving, onActivate: () => this.#save() }));
    panel.add(new Button({ id: "editor.close", x: this.#screen.inset + buttonWidth + this.#screen.action.gap, y, width: buttonWidth, height: footerHeight, text: "Close", onActivate: () => this.#close() }));
  }

  /** @param {Panel} panel */
  #buildCatalog(panel) {
    const builder = this.#host.app.deckBuilding;
    const width = this.#screen.columns.right.width - 2 * this.#screen.inset;
    const app = this.#host.app;
    const { inset } = this.#screen;
    const { catalogFilterTop, catalogListTop, filterButton } = this.#metrics;
    const filter = { id: "catalog.filter", filter: this.#filter, options: cardFilterOptions(app), onChange: (/** @type {import("../../../application/content/CardFilter.js").CardFilter} */ chosen) => this.#changeFilter(chosen) };
    if (filterButton) {
      panel.add(new Label({ x: inset, y: catalogFilterTop, width: COMPACT_SPLIT.title, height: CARD_FILTER_BUTTON_HEIGHT, text: "Cards", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
      buildCardFilterButton(panel, { ...filter, x: inset + COMPACT_SPLIT.title, y: catalogFilterTop, width: width - COMPACT_SPLIT.title, dialog: this.#host.dialog });
    } else {
      panel.add(new Label({ x: inset, y: 14, width, height: 36, text: "Cards", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
      buildCardFilterBar(panel, { ...filter, x: inset, y: catalogFilterTop, width });
    }
    const list = panel.add(new ScrollList({ id: CATALOG_LIST_ID, x: inset, y: catalogListTop, width, height: this.#screen.columns.height - catalogListTop - inset }));
    const rows = builder.browse().filter((row) => matchesCardFilter(this.#filter, row.card, rarityOf(app, row.card.id)));
    if (rows.length === 0) {
      list.add(new Label({ x: 0, y: 0, width: list.rowWidth, height: this.#screen.row.height, text: `No ${describeCardFilter(this.#filter)} cards for this deck.`, colorKey: "textMuted", fit: true }));
    }
    rows.forEach((row, index) => this.#buildCatalogRow(list, row, this.#screen.rowY(index)));
    list.contentHeight = rows.length === 0 ? this.#screen.row.height : this.#screen.rowsHeight(rows.length);
    list.scrollTo(this.#catalogToTop ? 0 : (this.#host.scroll[CATALOG_LIST_ID] ?? 0));
    this.#catalogToTop = false;
  }

  /**
   * @param {ScrollList} list
   * @param {ReturnType<import("../../../application/decks/DeckBuildingService.js").DeckBuildingService["browse"]>[number]} row
   * @param {number} y
   */
  #buildCatalogRow(list, { card, count, limit, canAdd }, y) {
    const { action, row, compact } = this.#screen;
    const addWidth = action.width + action.small;
    // A phone has no room for Info beside the strip: the strip itself opens the card.
    const info = compact ? 0 : action.width + action.gap;
    const labelWidth = list.rowWidth - info - addWidth - action.gap;
    list.add(new CardStrip({ x: 0, y, width: labelWidth, height: row.height, card, count, muted: count === 0, rarity: rarityOf(this.#host.app, card.id) }));
    if (compact) {
      list.add(new Hotspot({ id: `catalog.info.${card.id}`, x: 0, y, width: labelWidth, height: row.height, onActivate: () => this.#host.inspect(card.id) }));
    } else {
      list.add(new Button({ id: `catalog.info.${card.id}`, x: labelWidth + action.gap, y, width: action.width, height: row.height, text: "Info", onActivate: () => this.#host.inspect(card.id) }));
    }
    list.add(new Button({ id: `catalog.add.${card.id}`, x: labelWidth + info + action.gap, y, width: addWidth, height: row.height, text: `+ (${count}/${limit})`, enabled: canAdd, onActivate: () => this.#apply(this.#host.app.deckBuilding.addCard(card.id)) }));
  }

  /** @param {import("../../../application/content/CardFilter.js").CardFilter} filter */
  #changeFilter(filter) {
    this.#filter = filter;
    this.#catalogToTop = true;
    this.#host.rebuild();
  }

  /** @param {string} value */
  #rename(value) {
    this.#nameText = value;
    // An empty name is kept in the field but refused by the service; the report line explains.
    this.#host.app.deckBuilding.rename(value);
    this.#host.rebuild();
  }

  /** @param {import("@magic8/engine/shared/Result.js").Result<unknown>} result */
  #apply(result) {
    if (result.ok) {
      this.#notice = null;
    } else {
      this.#notice = result.error.message;
      this.#host.app.logger.warn("deck edit refused", result.error);
    }
    this.#host.rebuild();
  }

  async #save() {
    if (this.#saving) {
      return;
    }
    this.#saving = true;
    this.#host.rebuild();
    try {
      this.#apply(await this.#host.app.deckBuilding.save());
    } finally {
      this.#saving = false;
      this.#host.rebuild();
    }
  }

  #close() {
    const builder = this.#host.app.deckBuilding;
    if (!builder.hasUnsavedChanges) {
      builder.discard();
      this.#host.rebuild();
      return;
    }
    this.#host.confirm({
      title: "Discard unsaved changes?",
      message: "The deck was not saved. Close anyway?",
      confirmText: "Discard",
      destructive: true,
      onConfirm: () => {
        builder.discard();
        this.#host.rebuild();
      },
    });
  }
}

