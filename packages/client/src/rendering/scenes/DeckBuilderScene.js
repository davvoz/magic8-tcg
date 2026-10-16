/**
 * Deck builder: the library view when no draft is open, the editor view
 * otherwise. The draft lives in DeckBuildingService, so leaving and coming
 * back resumes editing. The scene keeps only presentation state (scroll
 * offsets, the inspected card, focus) and rebuilds its whole widget tree
 * after every change; the trees are small and this keeps the views free
 * of incremental-update bugs. Its title (in the top bar) says whether a
 * deck is being edited.
 */
import { SectionId } from "../shell/sections.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { ScrollList } from "../ui/ScrollList.js";
import { EditorView } from "./deckBuilder/EditorView.js";
import { LibraryView } from "./deckBuilder/LibraryView.js";
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
  #library;
  #editor;
  /** Scroll offsets by list id, kept across rebuilds. @type {Record<string, number>} */
  #scroll = {};
  /** Card shown in the inspect overlay, if any. @type {string | null} */
  #inspecting = null;
  /** Where Back leads: the scene the player came from. @type {string} */
  #from = SceneId.MAIN_MENU;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services, app, { section: SectionId.DECKS, title: "Deck Builder" });
    this.#app = app;
    this.setHeading({ back: () => this.#leave() });
    /** @type {import("./deckBuilder/layout.js").BuilderHost} */
    const host = {
      app,
      theme: services.theme,
      screen: () => this.#screen,
      dialog: { viewport: this.services.viewport, open: (modal) => this.openModal(modal), close: () => this.closeModal() },
      rebuild: () => this.#rebuild(),
      inspect: (cardId) => this.#inspect(cardId),
      confirm: (request) => this.#confirm(request),
      scroll: this.#scroll,
    };
    this.#library = new LibraryView(host);
    this.#editor = new EditorView(host);
  }

  /** @param {Readonly<Record<string, unknown>>} [params] `{ from?: string }`: where Back leads (the collection, deck selection), the menu by default */
  enter(params = {}) {
    this.#from = typeof params.from === "string" && this.services.hasScene(params.from) ? params.from : SceneId.MAIN_MENU;
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

  get isEditing() {
    return this.#app.deckBuilding.draft !== null;
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.#rememberScroll();
    this.closeModal();
    this.root.clear();
    this.setHeading({ title: this.isEditing ? "Deck Builder · editing" : "Deck Builder" });
    const view = this.isEditing ? this.#editor : this.#library;
    const initialFocus = view.build(this.root);
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

  #leave() {
    this.services.navigate(this.#from);
  }
}
