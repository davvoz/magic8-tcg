/**
 * The free starter deck: the decks on offer listed on the left, each
 * striped with its faction mix, and the selected one on the right with its
 * full card list and a "Take" button. Taking one is final (one starter per
 * account), so it asks first. The server mints the cards and saves the
 * deck; this screen only shows the offer and the outcome.
 */
import { AccountStatus } from "../../application/account/AccountService.js";
import { deckMix } from "../../application/decks/deckMix.js";
import { CardStrip } from "../cards/CardStrip.js";
import { buildCardInfoModal, rarityOf } from "../cards/cardInfo.js";
import { deckSummary, mixBands } from "../cards/deckStripe.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { buildConfirmModal } from "../ui/ConfirmModal.js";
import { Label } from "../ui/Label.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel, PANEL_INSET, SMALL_PANEL_INSET } from "../ui/Panel.js";
import { Hotspot } from "../ui/Hotspot.js";
import { ScrollList } from "../ui/ScrollList.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";
import { unknownCard } from "../cards/unknownCard.js";

/**
 * Sizes of the offer, wide and compact (a phone in landscape).
 * @typedef {Readonly<{
 *   side: number, titleY: number, subtitleY: number, panels: { top: number, height: number, gap: number, choices: number }, inset: number,
 *   choicesTop: number, choicesTitle: boolean, deckListTop: number, deckTitle: number, choiceRow: { height: number, gap: number },
 *   cardRow: { height: number, gap: number }, take: number, footerY: number, back: { width: number, height: number }, info: { width: number, gap: number } | null,
 * }>} StarterMetrics `panels.choices`: the width of the list of decks (0: a share of the screen); `info`: the Info button beside a card (null: the card itself opens it)
 */
/** @type {StarterMetrics} */
const WIDE = Object.freeze({
  side: 60,
  titleY: 24,
  subtitleY: 84,
  panels: Object.freeze({ top: 140, height: 640, gap: 40, choices: 560 }),
  inset: PANEL_INSET,
  choicesTop: 104,
  choicesTitle: true,
  deckListTop: 104,
  deckTitle: 40,
  choiceRow: Object.freeze({ height: 72, gap: 10 }),
  cardRow: Object.freeze({ height: 44, gap: 6 }),
  take: 60,
  footerY: 800,
  back: Object.freeze({ width: 220, height: 56 }),
  info: Object.freeze({ width: 64, gap: 8 }),
});
/** @type {StarterMetrics} */
const COMPACT = Object.freeze({
  side: 10,
  titleY: 4,
  subtitleY: 42,
  panels: Object.freeze({ top: 68, height: 276, gap: 10, choices: 0 }),
  inset: SMALL_PANEL_INSET,
  choicesTop: 12,
  choicesTitle: false,
  deckListTop: 74,
  deckTitle: 34,
  choiceRow: Object.freeze({ height: 46, gap: 4 }),
  cardRow: Object.freeze({ height: 48, gap: 4 }),
  take: 46,
  footerY: 350,
  back: Object.freeze({ width: 130, height: 46 }),
  info: null,
});
/** The compact list of decks' share of the screen's width. */
const COMPACT_CHOICES_SHARE = 0.4;

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
  /** The deck shown on the right. @type {string | null} */
  #selectedId = null;

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
    this.#selectedId = null;
    this.#unsubscribe = this.#requireAccount().subscribe(() => this.#rebuild());
    this.#rebuild();
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.exit();
  }

  relayout() {
    this.#rebuild();
  }

  /** @returns {StarterMetrics} */
  get #m() {
    return this.services.viewport.compact ? COMPACT : WIDE;
  }

  /** The width of the list of decks. */
  get #choicesWidth() {
    const { panels, side } = this.#m;
    return panels.choices || Math.round((this.services.viewport.logicalWidth - 2 * side) * COMPACT_CHOICES_SHARE);
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
    const { side: SIDE, titleY, subtitleY, panels: PANELS, footerY: FOOTER_Y, back: BACK, inset: INSET } = this.#m;
    this.root.add(new Label({ x: 0, y: titleY, width, height: 56, text: "Choose your starter deck", size: "heading", weight: "bold", colorKey: "accentLight", glow: true }));
    this.root.add(new Label({ x: SIDE, y: subtitleY, width: width - 2 * SIDE, height: 30, text: "Free, once per account: the cards become yours, each with its own serial number, and the deck is ready to play.", size: "small", colorKey: "textMuted", fit: true }));

    const choices = this.#choices();
    const selected = choices.find((choice) => choice.id === this.#selectedId) ?? choices[0];
    const choiceRow = this.#buildChoices(choices, selected);
    if (selected !== undefined) {
      this.#buildDeck(selected, { x: SIDE + this.#choicesWidth + PANELS.gap, width: width - 2 * SIDE - this.#choicesWidth - PANELS.gap });
    }

    const status = this.#status();
    this.root.add(new Label({ id: "starter.status", x: SIDE, y: FOOTER_Y, width: width - 2 * SIDE - BACK.width - INSET, height: BACK.height, text: status.text, size: "small", align: "left", colorKey: status.colorKey, fit: true }));
    const back = this.root.add(new Button({ id: "starter.back", x: width - SIDE - BACK.width, y: FOOTER_Y, width: BACK.width, height: BACK.height, text: viewport.compact ? "Menu" : "Back to menu", onActivate: () => this.services.navigate(SceneId.MAIN_MENU) }));
    this.focus(this.root.findById(focusedId) ?? (this.#canTake() ? choiceRow : null) ?? back);
    this.services.requestRender();
  }

  /**
   * The offer, one row per deck; the selected one is shown on the right.
   * @param {readonly import("../../application/ports/CollectionApi.contract.js").StarterChoice[]} choices
   * @param {import("../../application/ports/CollectionApi.contract.js").StarterChoice | undefined} selected
   * @returns {OptionRow | null} the selected deck's row
   */
  #buildChoices(choices, selected) {
    const { side: SIDE, panels: PANELS, inset: INSET, choicesTop, choicesTitle, choiceRow: CHOICE_ROW } = this.#m;
    const compact = this.services.viewport.compact;
    const inner = this.#choicesWidth - 2 * INSET;
    const panel = this.root.add(new Panel({ x: SIDE, y: PANELS.top, width: this.#choicesWidth, height: PANELS.height, smallCorners: compact }));
    if (choicesTitle) {
      panel.add(new Label({ x: INSET, y: INSET, width: inner, height: 40, text: "One deck per faction", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    }
    /** @type {OptionRow | null} */
    let selectedRow = null;
    choices.forEach((choice, index) => {
      const mix = deckMix(this.#app.content, choice.cards);
      const row = panel.add(
        new OptionRow({
          id: `starter.choice.${choice.id}`,
          x: INSET,
          y: choicesTop + index * (CHOICE_ROW.height + CHOICE_ROW.gap),
          width: inner,
          height: CHOICE_ROW.height,
          text: choice.name,
          subtitle: deckSummary(choice.size, mix),
          stripe: mixBands(this.services.theme, mix),
          selected: choice === selected,
          onActivate: () => {
            this.#selectedId = choice.id;
            this.#rebuild();
          },
        }),
      );
      if (choice === selected) {
        selectedRow = row;
      }
    });
    return selectedRow;
  }

  /**
   * The selected deck: its mix, its full card list and the button that takes it.
   * @param {import("../../application/ports/CollectionApi.contract.js").StarterChoice} choice
   * @param {{ x: number, width: number }} column
   */
  #buildDeck(choice, { x, width }) {
    const { panels: PANELS, inset: INSET, deckListTop: LIST_TOP, deckTitle, cardRow: CARD_ROW, take: TAKE_HEIGHT, info: INFO } = this.#m;
    const compact = this.services.viewport.compact;
    const top = compact ? 8 : INSET;
    const inner = width - 2 * INSET;
    const panel = this.root.add(new Panel({ x, y: PANELS.top, width, height: PANELS.height, smallCorners: compact }));
    panel.add(new Label({ x: INSET, y: top, width: inner, height: deckTitle, text: choice.name, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const summary = deckSummary(choice.size, deckMix(this.#app.content, choice.cards), [`${choice.cards.length} different`]);
    panel.add(new Label({ id: "starter.summary", x: INSET, y: top + deckTitle + 4, width: inner, height: 28, text: summary, size: "small", align: "left", colorKey: "textMuted", fit: true }));

    const listHeight = PANELS.height - LIST_TOP - TAKE_HEIGHT - INSET - (compact ? 8 : INSET);
    const list = panel.add(new ScrollList({ id: `starter.cards.${choice.id}`, x: INSET, y: LIST_TOP, width: inner, height: listHeight }));
    const catalog = this.#app.content.catalog;
    const rows = [...choice.cards].map((entry) => ({ entry, card: catalog.get(entry.cardId) })).sort((left, right) => (left.card?.cost ?? 0) - (right.card?.cost ?? 0) || (left.card?.name ?? left.entry.cardId).localeCompare(right.card?.name ?? right.entry.cardId));
    // A phone has no room for Info beside the strip: the strip itself opens the card.
    const stripWidth = INFO === null ? list.rowWidth : list.rowWidth - INFO.width - INFO.gap;
    rows.forEach(({ entry, card }, index) => {
      const y = index * (CARD_ROW.height + CARD_ROW.gap);
      const id = `starter.info.${choice.id}.${entry.cardId}`;
      const show = () => this.#showCard(entry.cardId, entry.count);
      list.add(new CardStrip({ x: 0, y, width: stripWidth, height: CARD_ROW.height, card: card ?? unknownCard(entry.cardId), count: entry.count, broken: card === undefined, rarity: rarityOf(this.#app, entry.cardId) }));
      if (INFO === null) {
        list.add(new Hotspot({ id, x: 0, y, width: stripWidth, height: CARD_ROW.height, enabled: card !== undefined, onActivate: show }));
      } else {
        list.add(new Button({ id, x: stripWidth + INFO.gap, y, width: INFO.width, height: CARD_ROW.height, text: "Info", textSize: "small", enabled: card !== undefined, onActivate: show }));
      }
    });
    list.contentHeight = rows.length === 0 ? 0 : rows.length * (CARD_ROW.height + CARD_ROW.gap) - CARD_ROW.gap;

    panel.add(
      new Button({
        id: `starter.take.${choice.id}`,
        x: INSET,
        y: PANELS.height - (compact ? 8 : INSET) - TAKE_HEIGHT,
        width: inner,
        height: TAKE_HEIGHT,
        text: this.#claiming === choice.name ? "Taking…" : `Take ${choice.name}`,
        variant: "primary",
        enabled: this.#canTake(),
        onActivate: () => this.#confirmTake(choice),
      }),
    );
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
