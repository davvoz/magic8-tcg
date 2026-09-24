/**
 * Deck builder, editor view: the draft on the left (name field, size and
 * rule report, entries with −/+), the browsable catalog on the right.
 * Every change goes through DeckBuildingService; the view then rebuilds
 * from the service's draft and report, so what is shown is always what
 * would be saved.
 */
import { CardStrip } from "../../cards/CardStrip.js";
import { Button } from "../../ui/Button.js";
import { Label } from "../../ui/Label.js";
import { Panel } from "../../ui/Panel.js";
import { ScrollList } from "../../ui/ScrollList.js";
import { TextField } from "../../ui/TextField.js";
import { ACTION, COLUMNS, INSET, ROW, rowY, rowsHeight } from "./layout.js";

const DECK_LIST_ID = "editor.deck";
const CATALOG_LIST_ID = "editor.catalog";
const NAME_HEIGHT = 52;
const META_TOP = 84;
const LIST_TOP = 144;
const FOOTER_HEIGHT = 52;
/** Room above the footer for the notice line. */
const NOTICE_HEIGHT = 30;

export class EditorView {
  #host;
  /** Raw text in the name field (may be invalid while typing); null when in sync with the draft. @type {string | null} */
  #nameText = null;
  /** Draft the raw name text belongs to. @type {string | null} */
  #nameDraftId = null;
  /** Last refused operation, shown until the next successful one. @type {string | null} */
  #notice = null;
  /** A save is on its way to storage (the server, when signed in). */
  #saving = false;

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
    const deckPanel = root.add(new Panel({ x: COLUMNS.left.x, y: COLUMNS.top, width: COLUMNS.left.width, height: COLUMNS.height }));
    const nameField = this.#buildDeckHeader(deckPanel, draft);
    this.#buildDeckList(deckPanel, draft);
    this.#buildFooter(deckPanel);

    const catalogPanel = root.add(new Panel({ x: COLUMNS.right.x, y: COLUMNS.top, width: COLUMNS.right.width, height: COLUMNS.height }));
    this.#buildCatalog(catalogPanel, draft);
    return nameField;
  }

  /**
   * @param {Panel} panel
   * @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} draft
   */
  #buildDeckHeader(panel, draft) {
    const builder = this.#host.app.deckBuilding;
    const rules = builder.rules;
    const width = COLUMNS.left.width - 2 * INSET;
    const nameField = panel.add(
      new TextField({
        id: "editor.name",
        x: INSET,
        y: INSET,
        width,
        height: NAME_HEIGHT,
        value: this.#nameText ?? draft.name,
        placeholder: "Deck name",
        maxLength: rules.deckNameMaxLength,
        onChange: (value) => this.#rename(value),
      }),
    );
    const state = builder.hasUnsavedChanges ? "unsaved changes" : "saved";
    panel.add(new Label({ x: INSET, y: META_TOP, width, height: 26, text: `${draft.faction} · ${draft.totalCards} / ${rules.minSize}–${rules.maxSize} cards · ${state}`, size: "small", align: "left", colorKey: "textMuted", fit: true }));
    const problem = this.#firstProblem();
    panel.add(new Label({ id: "editor.report", x: INSET, y: META_TOP + 28, width, height: 26, text: problem ?? "Legal deck", size: "small", align: "left", colorKey: problem === null ? "success" : "danger", fit: true }));
    return nameField;
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
    const width = COLUMNS.left.width - 2 * INSET;
    const list = panel.add(new ScrollList({ id: DECK_LIST_ID, x: INSET, y: LIST_TOP, width, height: COLUMNS.height - LIST_TOP - FOOTER_HEIGHT - NOTICE_HEIGHT - 2 * INSET }));
    if (draft.entries.length === 0) {
      list.add(new Label({ x: 0, y: 0, width, height: ROW.height, text: "Empty deck — add cards from the list on the right.", colorKey: "textMuted", fit: true }));
      list.contentHeight = ROW.height;
      return;
    }
    const addable = new Set(builder.addableCardIds());
    draft.entries.forEach((entry, index) => {
      const definition = catalog.get(entry.cardId);
      const card = definition ?? unknownCard(entry.cardId);
      this.#buildDeckRow(list, { y: rowY(index), card, count: entry.count, cardId: entry.cardId, canAdd: addable.has(entry.cardId), known: definition !== undefined });
    });
    list.contentHeight = rowsHeight(draft.entries.length);
    list.scrollTo(this.#host.scroll[DECK_LIST_ID] ?? 0);
  }

  /**
   * @param {ScrollList} list
   * @param {{ y: number, card: import("../../cards/CardStrip.js").StripCard, count: number, cardId: string, canAdd: boolean, known: boolean }} row
   */
  #buildDeckRow(list, { y, card, count, cardId, canAdd, known }) {
    const actionsWidth = ACTION.width + 2 * ACTION.small + 2 * ACTION.gap;
    const labelWidth = list.rowWidth - actionsWidth - ACTION.gap;
    list.add(new CardStrip({ x: 0, y, width: labelWidth, height: ROW.height, card, count, broken: !known }));
    let x = labelWidth + ACTION.gap;
    list.add(new Button({ id: `deck.info.${cardId}`, x, y, width: ACTION.width, height: ROW.height, text: "Info", enabled: known, onActivate: () => this.#host.inspect(cardId) }));
    x += ACTION.width + ACTION.gap;
    list.add(new Button({ id: `deck.remove.${cardId}`, x, y, width: ACTION.small, height: ROW.height, text: "−", onActivate: () => this.#apply(this.#host.app.deckBuilding.removeCard(cardId)) }));
    x += ACTION.small + ACTION.gap;
    list.add(new Button({ id: `deck.add.${cardId}`, x, y, width: ACTION.small, height: ROW.height, text: "+", enabled: canAdd, onActivate: () => this.#apply(this.#host.app.deckBuilding.addCard(cardId)) }));
  }

  /** @param {Panel} panel */
  #buildFooter(panel) {
    const builder = this.#host.app.deckBuilding;
    const width = COLUMNS.left.width - 2 * INSET;
    const buttonWidth = (width - ACTION.gap) / 2;
    const y = COLUMNS.height - INSET - FOOTER_HEIGHT;
    if (this.#notice !== null) {
      panel.add(new Label({ id: "editor.notice", x: INSET, y: y - NOTICE_HEIGHT, width, height: 26, text: this.#notice, size: "small", align: "left", colorKey: "danger", fit: true }));
    }
    panel.add(new Button({ id: "editor.save", x: INSET, y, width: buttonWidth, height: FOOTER_HEIGHT, text: this.#saving ? "Saving…" : "Save deck", variant: "primary", enabled: builder.hasUnsavedChanges && !this.#saving, onActivate: () => this.#save() }));
    panel.add(new Button({ id: "editor.close", x: INSET + buttonWidth + ACTION.gap, y, width: buttonWidth, height: FOOTER_HEIGHT, text: "Close", onActivate: () => this.#close() }));
  }

  /**
   * @param {Panel} panel
   * @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} draft
   */
  #buildCatalog(panel, draft) {
    const builder = this.#host.app.deckBuilding;
    const rules = builder.rules;
    const width = COLUMNS.right.width - 2 * INSET;
    const scope = catalogScope(rules, draft.faction);
    panel.add(new Label({ x: INSET, y: 14, width, height: 36, text: `Cards · ${scope}`, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const list = panel.add(new ScrollList({ id: CATALOG_LIST_ID, x: INSET, y: 60, width, height: COLUMNS.height - 60 - INSET }));
    const rows = builder.browse();
    rows.forEach((row, index) => this.#buildCatalogRow(list, row, rowY(index)));
    list.contentHeight = rowsHeight(rows.length);
    list.scrollTo(this.#host.scroll[CATALOG_LIST_ID] ?? 0);
  }

  /**
   * @param {ScrollList} list
   * @param {{ card: import("../../cards/CardDetail.js").CardLike, count: number, canAdd: boolean }} row
   * @param {number} y
   */
  #buildCatalogRow(list, { card, count, limit, canAdd }, y) {
    const addWidth = ACTION.width + ACTION.small;
    const labelWidth = list.rowWidth - ACTION.width - addWidth - 2 * ACTION.gap;
    list.add(new CardStrip({ x: 0, y, width: labelWidth, height: ROW.height, card, count, muted: count === 0 }));
    list.add(new Button({ id: `catalog.info.${card.id}`, x: labelWidth + ACTION.gap, y, width: ACTION.width, height: ROW.height, text: "Info", onActivate: () => this.#host.inspect(card.id) }));
    list.add(new Button({ id: `catalog.add.${card.id}`, x: labelWidth + ACTION.width + 2 * ACTION.gap, y, width: addWidth, height: ROW.height, text: `+ (${count}/${limit})`, enabled: canAdd, onActivate: () => this.#apply(this.#host.app.deckBuilding.addCard(card.id)) }));
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

/**
 * Which cards the catalog offers, as the rules define it.
 * @param {import("@magic8/engine/domain/decks/DeckRules.js").DeckRules} rules
 * @param {string} faction
 */
function catalogScope(rules, faction) {
  if (!rules.restrictsCards) {
    return "all factions";
  }
  return rules.factionRule.neutral === faction ? faction : `${faction} + ${rules.factionRule.neutral}`;
}

/**
 * Placeholder strip for a deck entry whose card is not in the catalog
 * (content changed since the deck was saved); drawn in the danger colour.
 * @param {string} cardId
 * @returns {import("../../cards/CardStrip.js").StripCard}
 */
function unknownCard(cardId) {
  return Object.freeze({ name: `${cardId} (unknown card)`, type: "unknown", faction: "unknown", cost: 0, attack: 0, health: 0, keywords: Object.freeze([]) });
}
