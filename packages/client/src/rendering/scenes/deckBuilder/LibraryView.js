/**
 * Deck builder, library view: every known deck with Edit (and Delete for
 * custom decks), and "New deck" per faction. Preconstructed decks are
 * copied on edit by the service; the view does not know that rule.
 */
import { DeckSource } from "../../../application/decks/DeckSelectionService.js";
import { factionTones } from "../../theme/Theme.js";
import { deckStorageText } from "../deckStorage.js";
import { Button } from "../../ui/Button.js";
import { Label } from "../../ui/Label.js";
import { OptionRow } from "../../ui/OptionRow.js";
import { Panel } from "../../ui/Panel.js";
import { ScrollList } from "../../ui/ScrollList.js";
import { ACTION, COLUMNS, INSET, ROW, rowY, rowsHeight } from "./layout.js";

const LIST_ID = "library.decks";
const NEW_DECK_HEIGHT = 56;
const NEW_DECK_GAP = 14;

export class LibraryView {
  #host;

  /** @param {import("./layout.js").BuilderHost} host */
  constructor(host) {
    this.#host = host;
  }

  /**
   * @param {import("../../ui/UiNode.js").UiNode} root
   * @returns {import("../../ui/UiNode.js").UiNode | null} node to focus initially
   */
  build(root) {
    const decksPanel = root.add(new Panel({ x: COLUMNS.left.x, y: COLUMNS.top, width: COLUMNS.left.width, height: COLUMNS.height }));
    decksPanel.add(new Label({ x: INSET, y: 14, width: COLUMNS.left.width - 2 * INSET, height: 36, text: "Your decks", size: "heading", weight: "bold", colorKey: "accentLight", align: "left" }));
    this.#buildDeckList(decksPanel);

    const createPanel = root.add(new Panel({ x: COLUMNS.right.x, y: COLUMNS.top, width: COLUMNS.right.width, height: COLUMNS.height }));
    return this.#buildCreatePanel(createPanel);
  }

  /** @param {Panel} panel */
  #buildDeckList(panel) {
    const options = this.#host.app.deckSelection.listDecks();
    const width = COLUMNS.left.width - 2 * INSET;
    const list = panel.add(new ScrollList({ id: LIST_ID, x: INSET, y: 60, width, height: COLUMNS.height - 60 - INSET }));
    if (options.length === 0) {
      list.add(new Label({ x: 0, y: 0, width, height: ROW.height, text: "No decks yet — create one on the right.", colorKey: "textMuted" }));
      list.contentHeight = ROW.height;
      return;
    }
    options.forEach((option, index) => this.#buildDeckRow(list, option, index));
    list.contentHeight = rowsHeight(options.length);
    list.scrollTo(this.#host.scroll[LIST_ID] ?? 0);
  }

  /**
   * @param {ScrollList} list
   * @param {import("../../../application/decks/DeckSelectionService.js").DeckOption} option
   * @param {number} index
   */
  #buildDeckRow(list, { deck, source, report }, index) {
    const y = rowY(index);
    const custom = source === DeckSource.CUSTOM;
    const actionsWidth = custom ? 2 * ACTION.width + ACTION.gap : ACTION.width;
    const labelWidth = list.rowWidth - actionsWidth - ACTION.gap;
    const status = report.valid ? "" : " · not playable";
    list.add(new OptionRow({ id: `library.deck.${deck.id}`, x: 0, y, width: labelWidth, height: ROW.height, text: deck.name, subtitle: `${deck.faction} · ${deck.totalCards} cards · ${source}${status}`, stripeColor: factionTones(this.#host.theme, deck.faction).base, onActivate: () => this.#edit(deck) }));
    list.add(new Button({ id: `library.edit.${deck.id}`, x: labelWidth + ACTION.gap, y, width: ACTION.width, height: ROW.height, text: custom ? "Edit" : "Copy", onActivate: () => this.#edit(deck) }));
    if (custom) {
      list.add(new Button({ id: `library.delete.${deck.id}`, x: labelWidth + 2 * ACTION.gap + ACTION.width, y, width: ACTION.width, height: ROW.height, text: "Delete", variant: "danger", textSize: "small", onActivate: () => this.#confirmDelete(deck) }));
    }
  }

  /**
   * @param {Panel} panel
   * @returns {import("../../ui/UiNode.js").UiNode | null}
   */
  #buildCreatePanel(panel) {
    const { app } = this.#host;
    const rules = app.deckBuilding.rules;
    const width = COLUMNS.right.width - 2 * INSET;
    panel.add(new Label({ x: INSET, y: 14, width, height: 36, text: "New deck", size: "heading", weight: "bold", colorKey: "accentLight", align: "left" }));
    const hints = [
      `${rules.minSize}–${rules.maxSize} cards, at most ${rules.maxCopies} copies of a card.`,
      rules.restrictsCards ? `One faction (${listWithOr(rules.deckFactions)}) plus shared ${rules.factionRule.neutral} cards.` : `Start from a faction (${listWithOr(rules.deckFactions)}); any card may be added.`,
      app.account?.state.account ? `Decks are ${deckStorageText(app)}; only cards you own can go in.` : `Decks are ${deckStorageText(app)}.`,
    ];
    hints.forEach((text, index) => panel.add(new Label({ x: INSET, y: 60 + index * 28, width, height: 26, text, size: "small", align: "left", colorKey: "textMuted", fit: true })));

    let first = null;
    rules.deckFactions.forEach((faction, index) => {
      const button = panel.add(
        new Button({
          id: `library.new.${faction}`,
          x: INSET,
          y: 160 + index * (NEW_DECK_HEIGHT + NEW_DECK_GAP),
          width,
          height: NEW_DECK_HEIGHT,
          text: `New ${faction} deck`,
          variant: index === 0 ? "primary" : "secondary",
          onActivate: () => this.#startNew(faction),
        }),
      );
      first ??= button;
    });
    return first;
  }

  /** @param {string} faction */
  #startNew(faction) {
    const started = this.#host.app.deckBuilding.startNew(faction);
    if (!started.ok) {
      this.#host.app.logger.warn("could not start a deck", started.error);
    }
    this.#host.rebuild();
  }

  /** @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} deck */
  #edit(deck) {
    const edited = this.#host.app.deckBuilding.edit(deck);
    if (!edited.ok) {
      this.#host.app.logger.warn("could not edit deck", edited.error);
    }
    this.#host.rebuild();
  }

  /** @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} deck */
  #confirmDelete(deck) {
    this.#host.confirm({
      title: `Delete "${deck.name}"?`,
      message: "The deck is removed from storage. This cannot be undone.",
      confirmText: "Delete",
      destructive: true,
      onConfirm: async () => {
        const removed = await this.#host.app.deckBuilding.delete(deck.id);
        if (!removed.ok) {
          this.#host.app.logger.warn("could not delete deck", removed.error);
        }
        this.#host.rebuild();
      },
    });
  }
}

/**
 * "a, b or c" for a list of names.
 * @param {readonly string[]} names
 */
function listWithOr(names) {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}
