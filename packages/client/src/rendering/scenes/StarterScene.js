/**
 * The free starter deck: the three decks on offer side by side, each with
 * its full card list, and one "Take" button per deck. Taking one is final
 * (one starter per account), so it asks first. The server mints the cards
 * and saves the deck; this screen only shows the offer and the outcome.
 */
import { AccountStatus } from "../../application/account/AccountService.js";
import { CardStrip } from "../cards/CardStrip.js";
import { buildCardInfoModal, rarityOf } from "../cards/cardInfo.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { buildConfirmModal } from "../ui/ConfirmModal.js";
import { Label } from "../ui/Label.js";
import { Panel, PANEL_INSET } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";
import { unknownCard } from "../cards/unknownCard.js";

const SIDE = 60;
const TITLE_Y = 24;
const COLUMN = Object.freeze({ top: 140, height: 640, gap: 35 });
const INSET = PANEL_INSET;
const LIST_TOP = 104;
const CARD_ROW = Object.freeze({ height: 44, gap: 6 });
const TAKE_HEIGHT = 60;
const FOOTER_Y = 800;
const BACK = Object.freeze({ width: 220, height: 56 });
const INFO = Object.freeze({ width: 64, gap: 8 });

/** User-facing text for failure codes; anything else shows the server's message. */
const FAILURE_TEXT = Object.freeze({
  STARTER_ALREADY_CLAIMED: "You already took your starter deck.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  NETWORK: "The game server cannot be reached.",
  UNAVAILABLE: "The game server is not available.",
});

export class StarterScene extends Scene {
  #app;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** Name of the deck being taken, while the server works. @type {string | null} */
  #claiming = null;
  /** Last refused claim. @type {string | null} */
  #failure = null;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#app = app;
  }

  enter() {
    this.#claiming = null;
    this.#failure = null;
    this.#unsubscribe = this.#requireAccount().subscribe(() => this.#rebuild());
    this.#rebuild();
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.exit();
  }

  onCancel() {
    if (this.modal === null) {
      this.services.navigate(SceneId.MAIN_MENU);
      return;
    }
    super.onCancel();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    const { theme, viewport } = this.services;
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "starter" });
    super.render(context);
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.closeModal();
    this.root.clear();
    const { viewport } = this.services;
    const width = viewport.logicalWidth;
    this.root.add(new Label({ x: 0, y: TITLE_Y, width, height: 56, text: "Choose your starter deck", size: "heading", weight: "bold", colorKey: "accentLight", glow: true }));
    this.root.add(new Label({ x: SIDE, y: TITLE_Y + 60, width: width - 2 * SIDE, height: 30, text: "Free, once per account: the cards become yours, each with its own serial number, and the deck is ready to play.", size: "small", colorKey: "textMuted", fit: true }));

    const choices = this.#choices();
    const columnWidth = (width - 2 * SIDE - (choices.length - 1) * COLUMN.gap) / Math.max(1, choices.length);
    /** @type {Button | null} */
    let first = null;
    choices.forEach((choice, index) => {
      const take = this.#buildColumn(choice, { x: SIDE + index * (columnWidth + COLUMN.gap), width: columnWidth });
      if (take.isEffectivelyEnabled) {
        first ??= take;
      }
    });

    const status = this.#status();
    this.root.add(new Label({ id: "starter.status", x: SIDE, y: FOOTER_Y, width: width - 2 * SIDE - BACK.width - INSET, height: BACK.height, text: status.text, size: "small", align: "left", colorKey: status.colorKey, fit: true }));
    const back = this.root.add(new Button({ id: "starter.back", x: width - SIDE - BACK.width, y: FOOTER_Y, width: BACK.width, height: BACK.height, text: "Back to menu", onActivate: () => this.services.navigate(SceneId.MAIN_MENU) }));
    this.focus(this.root.findById(focusedId) ?? first ?? back);
    this.services.requestRender();
  }

  /**
   * @param {import("../../application/ports/CollectionApi.contract.js").StarterChoice} choice
   * @param {{ x: number, width: number }} column
   * @returns {Button} the Take button
   */
  #buildColumn(choice, { x, width }) {
    const inner = width - 2 * INSET;
    const panel = this.root.add(new Panel({ x, y: COLUMN.top, width, height: COLUMN.height }));
    panel.add(new Label({ x: INSET, y: INSET, width: inner, height: 40, text: choice.name, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    panel.add(new Label({ x: INSET, y: INSET + 44, width: inner, height: 28, text: `${choice.faction} · ${choice.size} cards · ${choice.cards.length} different`, size: "small", align: "left", colorKey: "textMuted", fit: true }));

    const listHeight = COLUMN.height - LIST_TOP - TAKE_HEIGHT - 2 * INSET;
    const list = panel.add(new ScrollList({ id: `starter.cards.${choice.id}`, x: INSET, y: LIST_TOP, width: inner, height: listHeight }));
    const catalog = this.#app.content.catalog;
    const rows = [...choice.cards].map((entry) => ({ entry, card: catalog.get(entry.cardId) })).sort((left, right) => (left.card?.cost ?? 0) - (right.card?.cost ?? 0) || (left.card?.name ?? left.entry.cardId).localeCompare(right.card?.name ?? right.entry.cardId));
    const stripWidth = list.rowWidth - INFO.width - INFO.gap;
    rows.forEach(({ entry, card }, index) => {
      const y = index * (CARD_ROW.height + CARD_ROW.gap);
      list.add(new CardStrip({ x: 0, y, width: stripWidth, height: CARD_ROW.height, card: card ?? unknownCard(entry.cardId), count: entry.count, broken: card === undefined, rarity: rarityOf(this.#app, entry.cardId) }));
      list.add(new Button({ id: `starter.info.${choice.id}.${entry.cardId}`, x: stripWidth + INFO.gap, y, width: INFO.width, height: CARD_ROW.height, text: "Info", textSize: "small", enabled: card !== undefined, onActivate: () => this.#showCard(entry.cardId, entry.count) }));
    });
    list.contentHeight = rows.length === 0 ? 0 : rows.length * (CARD_ROW.height + CARD_ROW.gap) - CARD_ROW.gap;

    const take = panel.add(
      new Button({
        id: `starter.take.${choice.id}`,
        x: INSET,
        y: COLUMN.height - INSET - TAKE_HEIGHT,
        width: inner,
        height: TAKE_HEIGHT,
        text: this.#claiming === choice.name ? "Taking…" : `Take ${choice.name}`,
        variant: "primary",
        enabled: this.#canTake(),
        onActivate: () => this.#confirmTake(choice),
      }),
    );
    return take;
  }

  /**
   * @param {string} cardId
   * @param {number} count
   */
  #showCard(cardId, count) {
    const card = this.#app.content.catalog.get(cardId);
    if (card !== undefined) {
      this.openModal(buildCardInfoModal({ viewport: this.services.viewport, card, rarity: rarityOf(this.#app, cardId), lines: [`In this deck: ${count}`], onClose: () => this.closeModal() }));
    }
  }

  #choices() {
    return this.#requireAccount().collection.state.starter?.choices ?? [];
  }

  #canTake() {
    const account = this.#requireAccount();
    return this.#claiming === null && account.needsStarter;
  }

  /** @returns {{ text: string, colorKey: string }} */
  #status() {
    const account = this.#requireAccount();
    const { status, error } = account.state;
    if (this.#claiming !== null) {
      return { text: `Taking ${this.#claiming}: minting your cards…`, colorKey: "accent" };
    }
    if (this.#failure !== null) {
      return { text: this.#failure, colorKey: "danger" };
    }
    if (status === AccountStatus.SIGNED_OUT) {
      return { text: "Sign in to take your free starter deck.", colorKey: "textMuted" };
    }
    if (status === AccountStatus.LOADING) {
      return { text: "Loading the offer…", colorKey: "textMuted" };
    }
    if (status === AccountStatus.FAILED) {
      return { text: `The offer could not be loaded: ${error?.message ?? "unknown error"}`, colorKey: "danger" };
    }
    if (!account.needsStarter) {
      return { text: FAILURE_TEXT.STARTER_ALREADY_CLAIMED, colorKey: "textMuted" };
    }
    return { text: "Pick one: each deck plays differently, and none is the obvious choice.", colorKey: "textMuted" };
  }

  /** @param {import("../../application/ports/CollectionApi.contract.js").StarterChoice} choice */
  #confirmTake(choice) {
    this.openModal(
      buildConfirmModal({
        viewport: this.services.viewport,
        title: `Take ${choice.name}?`,
        message: "You get one free starter deck per account; the choice cannot be changed.",
        confirmText: "Take it",
        onConfirm: () => {
          this.closeModal();
          this.#take(choice);
        },
        onCancel: () => this.closeModal(),
      }),
    );
  }

  /** @param {import("../../application/ports/CollectionApi.contract.js").StarterChoice} choice */
  async #take(choice) {
    this.#claiming = choice.name;
    this.#failure = null;
    this.#rebuild();
    const claimed = await this.#requireAccount().claimStarter(choice.id);
    this.#claiming = null;
    if (!claimed.ok) {
      this.#failure = FAILURE_TEXT[/** @type {keyof typeof FAILURE_TEXT} */ (claimed.error.code)] ?? claimed.error.message;
      this.#app.logger.warn("starter claim refused", claimed.error);
      this.#rebuild();
      return;
    }
    this.#app.logger.info("starter claimed", { starter: choice.id, cards: claimed.value.cardsGranted });
    this.services.navigate(SceneId.COLLECTION, { notice: `${choice.name} is yours: ${claimed.value.cardsGranted} cards added to your collection and saved as a deck.` });
  }

  #requireAccount() {
    if (this.#app.account === undefined) {
      throw new Error("StarterScene needs an account service");
    }
    return this.#app.account;
  }
}
