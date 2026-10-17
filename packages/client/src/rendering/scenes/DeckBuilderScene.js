/**
 * Deck builder: the deck being edited (the draft, which lives in
 * DeckBuildingService, so leaving and coming back resumes editing). The
 * player's decks are listed on their own screen (DecksScene, which opens
 * the one to edit); opened with no draft, the builder starts a new deck.
 * Closing the deck goes Back (to the player's decks, unless the builder
 * was opened from elsewhere). The scene keeps only presentation state
 * (scroll offsets, the inspected card, focus) and rebuilds its whole widget
 * tree after every change; the trees are small and this keeps the view
 * free of incremental-update bugs.
 */
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { ScrollList } from "../ui/ScrollList.js";
import { EditorView } from "./deckBuilder/EditorView.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { buildInspectModal } from "./deckBuilder/modals.js";
import { buildConfirmModal } from "../ui/ConfirmModal.js";
import { SceneId } from "./sceneIds.js";
import { SectionScene } from "./SectionScene.js";

export class DeckBuilderScene extends SectionScene {
  /** The frame for the screen in use (the compact one on a phone): the two columns fill it, with no toolbar. */
  get #screen() {
    return screenLayout(this.services.viewport, { toolbar: false });
  }

  #app;
  #editor;
  /** Scroll offsets by list id, kept across rebuilds. @type {Record<string, number>} */
  #scroll = {};
  /** Card shown in the inspect overlay, if any. @type {string | null} */
  #inspecting = null;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services, app, { scene: SceneId.DECK_BUILDER, title: "Deck Builder" });
    this.#app = app;
    /** @type {import("./deckBuilder/layout.js").BuilderHost} */
    const host = {
      app,
      theme: services.theme,
      screen: () => this.#screen,
      dialog: { viewport: this.services.viewport, open: (modal) => this.openModal(modal), close: () => this.closeModal() },
      rebuild: () => this.#rebuild(),
      inspect: (cardId) => this.#inspect(cardId),
      confirm: (request) => this.#confirm(request),
      closed: () => this.goBack(),
      scroll: this.#scroll,
    };
    this.#editor = new EditorView(host);
  }

  /** @param {Readonly<Record<string, unknown>>} [params] `{ back?: string }`: where Back leads (the player's decks by default) */
  enter(params = {}) {
    this.routeBack(params);
    if (this.#app.deckBuilding.draft === null) {
      const started = this.#app.deckBuilding.startNew();
      if (!started.ok) {
        this.#app.logger.warn("could not start a deck", started.error);
      }
    }
    this.#rebuild();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    const { theme, viewport } = this.services;
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "builder" });
    super.render(context);
  }

  relayout() {
    this.#rebuild();
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.#rememberScroll();
    this.closeModal();
    this.root.clear();
    if (this.#app.deckBuilding.draft === null) {
      // No deck to edit (it could not be started): nothing but the way back.
      this.focus(this.backButton);
      this.services.requestRender();
      return;
    }
    const initialFocus = this.#editor.build(this.root);
    if (this.#inspecting !== null) {
      this.#openInspect(this.#inspecting);
    }
    // Focus never escapes an open modal, even when the previously focused node still exists beneath it.
    const kept = this.modal === null ? this.findNode(focusedId) : this.modal.findById(focusedId);
    const fallback = this.modal === null ? initialFocus : this.modal.focusableNodes()[0] ?? null;
    this.focus(kept ?? fallback);
    this.services.requestRender();
  }

  /** Scroll offsets survive rebuilds so adding a card does not jump the list. */
  #rememberScroll() {
    const visit = (node) => {
      if (node instanceof ScrollList) {
        this.#scroll[node.id] = node.scrollY;
      }
      node.children.forEach(visit);
    };
    visit(this.root);
  }

  /** @param {string} cardId */
  #inspect(cardId) {
    this.#inspecting = cardId;
    this.#rebuild();
  }

  /** @param {string} cardId */
  #openInspect(cardId) {
    const builder = this.#app.deckBuilding;
    const card = this.#app.content.catalog.get(cardId);
    if (card === undefined) {
      this.#inspecting = null;
      return;
    }
    const entry = builder.browse().find((row) => row.card.id === cardId);
    const close = () => {
      this.#inspecting = null;
      this.#rebuild();
    };
    this.openModal(
      buildInspectModal({
        viewport: this.services.viewport,
        card,
        rarity: this.#app.rarities?.of(cardId) ?? null,
        count: entry?.count ?? builder.draft?.countOf(cardId) ?? 0,
        maxCopies: builder.rules.maxCopies,
        canAdd: entry?.canAdd ?? false,
        onAdd: () => this.#applyEdit(builder.addCard(cardId)),
        onRemove: () => this.#applyEdit(builder.removeCard(cardId)),
        onClose: close,
      }),
    );
  }

  /** @param {import("@magic8/engine/shared/Result.js").Result<unknown>} result */
  #applyEdit(result) {
    if (!result.ok) {
      this.#app.logger.warn("deck edit refused", result.error);
    }
    this.#rebuild();
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
}
