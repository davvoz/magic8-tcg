/**
 * The Decks section's own screen (its tab "My decks", beside the
 * Collection): the player's decks in the middle, each striped with its
 * faction mix, the one they play with lit — a click on another makes it
 * the one (a deck that breaks the rules opens in the Deck Builder, where
 * the problem shows). Beside each, Edit (Copy for a preconstructed deck,
 * offline) and Delete.
 *
 * On the right, what to do with decks: take the free starter deck while it
 * is still to take (the screen's gold button then), go on with the deck
 * left open in the Deck Builder, start a new one, and where the decks are
 * kept. Opening another deck while one has unsaved changes asks first.
 */
import { AccountStatus } from "../../application/account/AccountService.js";
import { DeckSource } from "../../application/decks/DeckSelectionService.js";
import { deckMix } from "../../application/decks/deckMix.js";
import { deckSummary, mixBands } from "../cards/deckStripe.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { buildConfirmModal } from "../ui/ConfirmModal.js";
import { Label } from "../ui/Label.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { deckStorageText } from "./deckStorage.js";
import { SceneId } from "./sceneIds.js";
import { SectionScene } from "./SectionScene.js";

const LIST_ID = "decks.list";
/** The decks' share of the width the two columns share. */
const LIST_SHARE = 0.6;
/** Sizes inside the panels, wide and compact (a phone in landscape). */
const WIDE = Object.freeze({ title: 36, titleY: 14, listY: 60, gap: 14, text: 26, button: 56, starterText: 52 });
const COMPACT = Object.freeze({ title: 28, titleY: 6, listY: 40, gap: 8, text: 22, button: 46, starterText: 40 });

/**
 * @typedef {import("../../application/decks/DeckSelectionService.js").DeckOption} DeckOption
 * @typedef {import("@magic8/engine/domain/decks/DeckList.js").DeckList} DeckList
 */

export class DecksScene extends SectionScene {
  #app;
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  #scrollY = 0;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services, app, { scene: SceneId.DECKS, title: "My decks" });
    this.#app = app;
  }

  /** @param {Readonly<Record<string, unknown>>} [params] `{ back?: string }`: opened from a screen that said so, Back leads there */
  enter(params = {}) {
    this.routeBack(params);
    for (const service of [this.#app.account, this.#app.selectedDeck]) {
      if (service !== undefined) {
        this.#unsubscribes.push(service.subscribe(() => this.#rebuild()));
      }
    }
    this.#rebuild();
  }

  exit() {
    this.#unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#unsubscribes = [];
    super.exit();
  }

  relayout() {
    this.#rebuild();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "decks" });
    super.render(context);
  }

  /** The two columns: the decks (the wider), and what to do with them. */
  get #frame() {
    const screen = screenLayout(this.services.viewport, { toolbar: false });
    const { left, right } = screen.columns;
    const gap = right.x - left.x - left.width;
    const shared = left.width + right.width;
    const listWidth = Math.round(shared * LIST_SHARE);
    return Object.freeze({
      screen,
      m: screen.compact ? COMPACT : WIDE,
      list: Object.freeze({ x: left.x, width: listWidth }),
      side: Object.freeze({ x: left.x + listWidth + gap, width: shared - listWidth }),
    });
  }

  /** The decks, and which of them the player plays with (null: none can be played). */
  #decks() {
    const options = this.#app.deckSelection.listDecks();
    const playing = this.#app.selectedDeck?.pick(options, { idOf: (option) => option.deck.id, playable: (option) => option.report.valid }) ?? options.find((option) => option.report.valid) ?? null;
    return { options, playingId: playing?.deck.id ?? null };
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.#rememberScroll();
    this.root.clear();
    const { screen } = this.#frame;
    const firstRow = this.#buildList(screen);
    const action = this.#buildSide(screen);
    this.focus(this.findNode(focusedId) ?? action ?? firstRow ?? this.backButton);
    this.services.requestRender();
  }

  /**
   * @param {import("./deckBuilder/layout.js").ScreenLayout} screen
   * @returns {OptionRow | null} the first deck
   */
  #buildList(screen) {
    const { m, list: column } = this.#frame;
    const { columns, inset } = screen;
    const panel = this.root.add(new Panel({ ...screen.panel, x: column.x, y: columns.top, width: column.width, height: columns.height }));
    const width = column.width - 2 * inset;
    panel.add(new Label({ id: "decks.title", x: screen.titleInset, y: m.titleY, width: width - 2 * (screen.titleInset - inset), height: m.title, text: "Your decks", size: "subheading", weight: "bold", colorKey: "accentLight", align: "left" }));
    const list = panel.add(new ScrollList({ id: LIST_ID, x: inset, y: m.listY, width, height: columns.height - m.listY - inset }));
    const { options, playingId } = this.#decks();
    if (options.length === 0) {
      list.add(new TextBlock({ id: "decks.empty", x: 0, y: 0, width: list.rowWidth, height: 2 * screen.row.height, text: this.#emptyText(), size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * screen.row.height;
      return null;
    }
    /** @type {OptionRow | null} */
    let first = null;
    options.forEach((option, index) => {
      const row = this.#buildRow(list, screen, { option, index, playing: option.deck.id === playingId });
      first ??= row;
    });
    list.contentHeight = screen.rowsHeight(options.length);
    list.scrollTo(this.#scrollY);
    return first;
  }

  #emptyText() {
    const account = this.#app.account;
    if (account?.state.status === AccountStatus.LOADING) {
      return "Loading your decks…";
    }
    return account?.needsStarter === true ? "No decks yet: take your free starter deck, or build one." : "No decks yet: build one with New deck.";
  }

  /**
   * One deck: its stripe, name and summary, then Edit (or Copy) and Delete.
   * @param {ScrollList} list
   * @param {import("./deckBuilder/layout.js").ScreenLayout} screen
   * @param {{ option: DeckOption, index: number, playing: boolean }} row
   */
  #buildRow(list, screen, { option, index, playing }) {
    const { deck, source, report } = option;
    const { action, row } = screen;
    const y = screen.rowY(index);
    const custom = source === DeckSource.CUSTOM;
    const actionsWidth = custom ? 2 * action.width + action.gap : action.width;
    const labelWidth = list.rowWidth - actionsWidth - action.gap;
    const mix = deckMix(this.#app.content, deck.entries);
    const notes = [...(custom ? [] : ["preconstructed"]), ...(report.valid ? [] : [`not playable: ${report.problems[0]?.message ?? "fix it in the Deck Builder"}`]), ...(playing ? ["you play with it"] : [])];
    const onActivate = report.valid ? () => this.#playWith(deck) : () => this.#open(deck);
    const node = list.add(new OptionRow({ id: `decks.deck.${deck.id}`, x: 0, y, width: labelWidth, height: row.height, text: deck.name, subtitle: deckSummary(deck.totalCards, mix, notes), stripe: mixBands(this.services.theme, mix), selected: playing, onActivate }));
    list.add(new Button({ id: `decks.edit.${deck.id}`, x: labelWidth + action.gap, y, width: action.width, height: row.height, text: custom ? "Edit" : "Copy", enabled: this.services.hasScene(SceneId.DECK_BUILDER), onActivate: () => this.#open(deck) }));
    if (custom) {
      list.add(new Button({ id: `decks.delete.${deck.id}`, x: labelWidth + 2 * action.gap + action.width, y, width: action.width, height: row.height, text: "Delete", variant: "danger", textSize: "small", onActivate: () => this.#confirmDelete(deck) }));
    }
    return node;
  }

  /**
   * The column of what to do: the starter deck (while it is to take), the deck left open, a new deck, where decks are kept.
   * @param {import("./deckBuilder/layout.js").ScreenLayout} screen
   * @returns {Button | null} the screen's main button
   */
  #buildSide(screen) {
    const { m, side } = this.#frame;
    const { columns, inset } = screen;
    const panel = this.root.add(new Panel({ ...screen.panel, x: side.x, y: columns.top, width: side.width, height: columns.height }));
    const width = side.width - 2 * inset;
    // What sits in the column's top band keeps clear of its painted corners.
    const across = (/** @type {number} */ at) => (at < inset ? { x: screen.titleInset, width: side.width - 2 * screen.titleInset } : { x: inset, width });
    let y = m.titleY;
    const starter = this.#app.account?.state.status === AccountStatus.READY && this.#app.account.needsStarter;
    /** @type {Button | null} */
    let main = null;
    if (starter) {
      panel.add(new Label({ x: screen.titleInset, y, width: width - 2 * (screen.titleInset - inset), height: m.title, text: "Your free starter deck", size: "subheading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
      y += m.title + 2;
      panel.add(new TextBlock({ x: inset, y, width, height: m.starterText, text: "Pick one of the starter decks: its cards become yours, and it is saved here as a deck.", size: "small", align: "left", colorKey: "textMuted" }));
      y += m.starterText + 4;
      main = panel.add(new Button({ id: "decks.starter", x: inset, y, width, height: m.button, text: "Take your starter deck", variant: "primary", enabled: this.services.hasScene(SceneId.STARTER), onActivate: () => this.services.navigate(SceneId.STARTER, this.backHere()) }));
      y += m.button + 2 * m.gap;
    }
    const draft = this.#app.deckBuilding.draft;
    if (draft !== null) {
      panel.add(new Button({ id: "decks.resume", ...across(y), y, height: m.button, text: `Continue editing "${draft.name}"`, enabled: this.services.hasScene(SceneId.DECK_BUILDER), onActivate: () => this.services.navigate(SceneId.DECK_BUILDER, this.backHere()) }));
      y += m.button + m.gap;
    }
    panel.add(new Label({ ...across(y), y, height: m.title, text: "New deck", size: starter ? "body" : "subheading", weight: "bold", colorKey: "accentLight", align: "left" }));
    y += m.title;
    for (const text of this.#hints(screen.compact)) {
      panel.add(new Label({ x: inset, y, width, height: m.text, text, size: "small", align: "left", colorKey: "textMuted", fit: true }));
      y += m.text;
    }
    const create = panel.add(new Button({ id: "decks.new", x: inset, y: y + m.gap / 2, width, height: m.button, text: "New deck", variant: starter ? "secondary" : "primary", enabled: this.services.hasScene(SceneId.DECK_BUILDER), onActivate: () => this.#startNew() }));
    return main ?? create;
  }

  /**
   * What a new deck must be, and where it is kept (a phone keeps the rules alone).
   * @param {boolean} compact
   */
  #hints(compact) {
    const app = this.#app;
    const rules = app.deckBuilding.rules;
    const size = `${rules.minSize}–${rules.maxSize} cards, at most ${rules.maxCopies} copies of a card.`;
    if (compact) {
      return [size];
    }
    const signedIn = (app.account?.state.account ?? null) !== null;
    return [size, signedIn ? "Saved to your account; only cards you own can go in." : `Decks are ${deckStorageText(app)}.`, "Click one of your decks to play with it."];
  }

  /** @param {DeckList} deck */
  #playWith(deck) {
    this.#app.selectedDeck?.choose(deck.id);
    this.#rebuild();
  }

  /**
   * Into the Deck Builder with this deck (a copy of a preconstructed one); the deck left open there, if it is this one.
   * @param {DeckList} deck
   */
  #open(deck) {
    const builder = this.#app.deckBuilding;
    if (builder.draft?.id === deck.id) {
      this.services.navigate(SceneId.DECK_BUILDER, this.backHere());
      return;
    }
    this.#unlessUnsaved(() => {
      const edited = builder.edit(deck);
      if (!edited.ok) {
        this.#app.logger.warn("could not edit deck", edited.error);
        return;
      }
      this.services.navigate(SceneId.DECK_BUILDER, this.backHere());
    });
  }

  #startNew() {
    this.#unlessUnsaved(() => {
      const started = this.#app.deckBuilding.startNew();
      if (!started.ok) {
        this.#app.logger.warn("could not start a deck", started.error);
        return;
      }
      this.services.navigate(SceneId.DECK_BUILDER, this.backHere());
    });
  }

  /**
   * Does `action` at once, or — while the deck left open in the Deck Builder has unsaved changes — once the player agrees to drop them.
   * @param {() => void} action
   */
  #unlessUnsaved(action) {
    const builder = this.#app.deckBuilding;
    const draft = builder.draft;
    if (draft === null || !builder.hasUnsavedChanges) {
      action();
      return;
    }
    this.#confirm({
      title: "Discard unsaved changes?",
      message: `"${draft.name}" has changes that were not saved.`,
      confirmText: "Discard",
      destructive: true,
      onConfirm: () => {
        builder.discard();
        action();
      },
    });
  }

  /** @param {DeckList} deck */
  #confirmDelete(deck) {
    this.#confirm({
      title: `Delete "${deck.name}"?`,
      message: "The deck is removed for good. This cannot be undone.",
      confirmText: "Delete",
      destructive: true,
      onConfirm: async () => {
        const removed = await this.#app.deckBuilding.delete(deck.id);
        if (!removed.ok) {
          this.#app.logger.warn("could not delete deck", removed.error);
        }
        this.#rebuild();
      },
    });
  }

  /** @param {{ title: string, message: string, confirmText: string, destructive?: boolean, onConfirm: () => void }} request */
  #confirm(request) {
    this.openModal(
      buildConfirmModal({
        viewport: this.services.viewport,
        ...request,
        onConfirm: () => {
          this.closeModal();
          request.onConfirm();
        },
        onCancel: () => this.closeModal(),
      }),
    );
  }

  #rememberScroll() {
    const list = this.root.findById(LIST_ID);
    if (list instanceof ScrollList) {
      this.#scrollY = list.scrollY;
    }
  }
}
