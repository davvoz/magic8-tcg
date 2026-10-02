/**
 * Deck builder, library view: the player's decks with Edit (and Delete for
 * custom decks), each striped with its faction mix, and "New deck". Offline the preconstructed
 * decks are listed too, and copied on edit by the service; signed in they
 * are not the player's, so the service leaves them out.
 */
import { DeckSource } from "../../../application/decks/DeckSelectionService.js";
import { deckMix } from "../../../application/decks/deckMix.js";
import { deckSummary, mixBands } from "../../cards/deckStripe.js";
import { deckStorageText } from "../deckStorage.js";
import { Button } from "../../ui/Button.js";
import { Label } from "../../ui/Label.js";
import { OptionRow } from "../../ui/OptionRow.js";
import { Panel } from "../../ui/Panel.js";
import { ScrollList } from "../../ui/ScrollList.js";

const LIST_ID = "library.decks";
const NEW_DECK_HEIGHT = 56;

export class LibraryView {
  #host;

  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return this.#host.screen();
  }

  /** @param {import("./layout.js").BuilderHost} host */
  constructor(host) {
    this.#host = host;
  }

  /**
   * @param {import("../../ui/UiNode.js").UiNode} root
   * @returns {import("../../ui/UiNode.js").UiNode | null} node to focus initially
   */
  build(root) {
    const decksPanel = root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.left.x, y: this.#screen.columns.top, width: this.#screen.columns.left.width, height: this.#screen.columns.height }));
    decksPanel.add(new Label({ x: this.#screen.inset, y: 14, width: this.#screen.columns.left.width - 2 * this.#screen.inset, height: 36, text: "Your decks", size: "heading", weight: "bold", colorKey: "accentLight", align: "left" }));
    this.#buildDeckList(decksPanel);

    const createPanel = root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.right.x, y: this.#screen.columns.top, width: this.#screen.columns.right.width, height: this.#screen.columns.height }));
    return this.#buildCreatePanel(createPanel);
  }

  /** @param {Panel} panel */
  #buildDeckList(panel) {
    const options = this.#host.app.deckSelection.listDecks();
    const width = this.#screen.columns.left.width - 2 * this.#screen.inset;
    const list = panel.add(new ScrollList({ id: LIST_ID, x: this.#screen.inset, y: 60, width, height: this.#screen.columns.height - 60 - this.#screen.inset }));
    if (options.length === 0) {
      list.add(new Label({ x: 0, y: 0, width, height: this.#screen.row.height, text: "No decks yet — create one on the right.", colorKey: "textMuted" }));
      list.contentHeight = this.#screen.row.height;
      return;
    }
    options.forEach((option, index) => this.#buildDeckRow(list, option, index));
    list.contentHeight = this.#screen.rowsHeight(options.length);
    list.scrollTo(this.#host.scroll[LIST_ID] ?? 0);
  }

  /**
   * @param {ScrollList} list
   * @param {import("../../../application/decks/DeckSelectionService.js").DeckOption} option
   * @param {number} index
   */
  #buildDeckRow(list, { deck, source, report }, index) {
    const y = this.#screen.rowY(index);
    const custom = source === DeckSource.CUSTOM;
    const actionsWidth = custom ? 2 * this.#screen.action.width + this.#screen.action.gap : this.#screen.action.width;
    const labelWidth = list.rowWidth - actionsWidth - this.#screen.action.gap;

    const mix = deckMix(this.#host.app.content, deck.entries);
    list.add(new OptionRow({ id: `library.deck.${deck.id}`, x: 0, y, width: labelWidth, height: this.#screen.row.height, text: deck.name, subtitle: deckSummary(deck.totalCards, mix, [...(custom ? [] : ["preconstructed"]), ...(report.valid ? [] : ["not playable"])]), stripe: mixBands(this.#host.theme, mix), onActivate: () => this.#edit(deck) }));
    list.add(new Button({ id: `library.edit.${deck.id}`, x: labelWidth + this.#screen.action.gap, y, width: this.#screen.action.width, height: this.#screen.row.height, text: custom ? "Edit" : "Copy", onActivate: () => this.#edit(deck) }));
    if (custom) {
      list.add(new Button({ id: `library.delete.${deck.id}`, x: labelWidth + 2 * this.#screen.action.gap + this.#screen.action.width, y, width: this.#screen.action.width, height: this.#screen.row.height, text: "Delete", variant: "danger", textSize: "small", onActivate: () => this.#confirmDelete(deck) }));
    }
  }

  /**
   * @param {Panel} panel
   * @returns {import("../../ui/UiNode.js").UiNode | null}
   */
  #buildCreatePanel(panel) {
    const { app } = this.#host;
    const rules = app.deckBuilding.rules;
    const width = this.#screen.columns.right.width - 2 * this.#screen.inset;
    panel.add(new Label({ x: this.#screen.inset, y: 14, width, height: 36, text: "New deck", size: "heading", weight: "bold", colorKey: "accentLight", align: "left" }));
    const hints = [
      `${rules.minSize}–${rules.maxSize} cards, at most ${rules.maxCopies} copies of a card.`,
      "Any card may go in; the coloured band shows the deck's mix of factions.",
      app.account?.state.account ? `Decks are ${deckStorageText(app)}; only cards you own can go in.` : `Decks are ${deckStorageText(app)}.`,
    ];
    hints.forEach((text, index) => panel.add(new Label({ x: this.#screen.inset, y: 60 + index * 28, width, height: 26, text, size: "small", align: "left", colorKey: "textMuted", fit: true })));

    // Under the hints: where the wide panel has always put it, or right below them on a phone.
    const top = this.#screen.compact ? 60 + hints.length * 28 + 12 : 160;
    return panel.add(new Button({ id: "library.new", x: this.#screen.inset, y: top, width, height: NEW_DECK_HEIGHT, text: "New deck", variant: "primary", onActivate: () => this.#startNew() }));
  }

  #startNew() {
    const started = this.#host.app.deckBuilding.startNew();
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

