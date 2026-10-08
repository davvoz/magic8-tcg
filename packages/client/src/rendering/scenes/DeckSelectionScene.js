/**
 * Deck selection: pick one of your decks and start a match against the
 * built-in AI, which plays a preconstructed deck (chosen by the match seed).
 * A coin toss (with its own seed) decides who plays first; the match screen
 * shows it and starts the match once the coin has landed.
 * Signed in, "your decks" are the account's (the starter you took and the
 * decks you built), and the player sits at the table as that account (its
 * name and profile picture); offline, the preconstructed decks too. Each deck is a
 * banner row striped with its faction mix; decks that break the rules are shown
 * disabled with the first problem so the player knows to fix them.
 * On a compact screen the panel fills it and the footer is one row.
 */
import { BasicAiController } from "../../application/match/BasicAiController.js";
import { DeckSource } from "../../application/decks/DeckSelectionService.js";
import { deckMix } from "../../application/decks/deckMix.js";
import { humanController } from "../../application/match/HumanController.js";
import { IdentityStatus } from "../../application/identity/IdentityService.js";
import { deckSummary, mixBands } from "../cards/deckStripe.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Ornament } from "../ui/Ornament.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

/**
 * @typedef {Readonly<{
 *   panel: { width: number, height: number }, inset: number, row: { height: number, gap: number },
 *   title: { y: number, height: number }, subtitle: { y: number, height: number }, ornamentY: number | null,
 *   listTop: number, listBottom: number, footer: { height: number, gap: number, oneRow: boolean },
 * }>} SelectionLayout `listBottom`: room under the list for the footer; `footer.oneRow`: Back, Deck builder and Start side by side
 */
/** @type {SelectionLayout} */
const WIDE = Object.freeze({
  panel: Object.freeze({ width: 1200, height: 780 }),
  inset: 60,
  row: Object.freeze({ height: 72, gap: 12 }),
  title: Object.freeze({ y: 24, height: 56 }),
  subtitle: Object.freeze({ y: 80, height: 28 }),
  ornamentY: 112,
  listTop: 150,
  listBottom: 170,
  footer: Object.freeze({ height: 60, gap: 20, oneRow: false }),
});
/** The compact panel's margin from the screen's edges; its size is the screen's. */
const COMPACT_MARGIN = 8;
const COMPACT = Object.freeze({
  inset: 22,
  row: Object.freeze({ height: 60, gap: 8 }),
  title: Object.freeze({ y: 12, height: 40 }),
  subtitle: Object.freeze({ y: 48, height: 22 }),
  ornamentY: null,
  listTop: 76,
  listBottom: 76,
  footer: Object.freeze({ height: 48, gap: 12, oneRow: true }),
});
/** In the compact footer: Back and Deck builder take these widths, Start the rest. */
const COMPACT_FOOTER = Object.freeze({ back: 140, builder: 190 });
/** The player's seat; signed in, it is named after their account instead. */
const HUMAN_SEAT = Object.freeze({ id: "player", name: "You" });
const AI_SEAT = Object.freeze({ id: "ai", name: "Opponent" });
const LIST_ID = "decks";

export class DeckSelectionScene extends Scene {
  #app;
  /** @type {string | null} */
  #selectedDeckId = null;
  #scrollY = 0;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#app = app;
  }

  enter() {
    const options = this.#app.deckSelection.listPlayableDecks();
    this.#selectedDeckId = options[0]?.deck.id ?? null;
    this.#rebuild();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    const { theme, viewport } = this.services;
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "decks" });
    super.render(context);
  }

  relayout() {
    this.#rememberScroll();
    this.#rebuild();
  }

  /** @returns {SelectionLayout} */
  #layout() {
    const { viewport } = this.services;
    if (!viewport.compact) {
      return WIDE;
    }
    return { ...COMPACT, panel: { width: viewport.logicalWidth - 2 * COMPACT_MARGIN, height: viewport.logicalHeight - 2 * COMPACT_MARGIN } };
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.root.clear();
    const { viewport } = this.services;
    const layout = this.#layout();
    const { panel: size } = layout;
    const panel = this.root.add(new Panel({ x: (viewport.logicalWidth - size.width) / 2, y: (viewport.logicalHeight - size.height) / 2, width: size.width, height: size.height }));
    panel.add(new Label({ x: 0, y: layout.title.y, width: size.width, height: layout.title.height, text: "Choose your deck", size: "heading", weight: "bold", colorKey: "accentLight", glow: true }));
    panel.add(new Label({ x: layout.inset, y: layout.subtitle.y, width: size.width - 2 * layout.inset, height: layout.subtitle.height, text: "The opponent plays one of the preconstructed decks.", size: "small", colorKey: "textMuted", fit: true }));
    if (layout.ornamentY !== null) {
      panel.add(new Ornament({ x: size.width / 2 - 160, y: layout.ornamentY, width: 320, height: 14 }));
    }
    this.#buildList(panel, layout);
    const start = this.#buildFooter(panel, layout);
    this.focus(this.root.findById(focusedId) ?? (this.#selectedDeckId === null ? null : start));
    this.services.requestRender();
  }

  /**
   * @param {Panel} panel
   * @param {SelectionLayout} layout
   */
  #buildList(panel, { panel: size, inset, row: ROW, listTop, listBottom }) {
    const options = this.#app.deckSelection.listDecks();
    const width = size.width - 2 * inset;
    const list = panel.add(new ScrollList({ id: LIST_ID, x: inset, y: listTop, width, height: size.height - listTop - listBottom }));
    if (options.length === 0) {
      list.add(new Label({ x: 0, y: 0, width, height: ROW.height, text: this.#app.account?.needsStarter ? "No decks yet: take your free starter deck from the main menu." : "No decks are available.", colorKey: "textMuted", fit: true }));
      list.contentHeight = ROW.height;
      return;
    }
    options.forEach((option, index) => {
      const selected = option.deck.id === this.#selectedDeckId;
      const mix = deckMix(this.#app.content, option.deck.entries);
      list.add(
        new OptionRow({
          id: `deck-${option.deck.id}`,
          x: 0,
          y: index * (ROW.height + ROW.gap),
          width: list.rowWidth,
          height: ROW.height,
          enabled: option.report.valid,
          selected,
          text: option.deck.name,
          subtitle: describeOption(option, mix),
          stripe: mixBands(this.services.theme, mix),
          onActivate: () => this.#select(option.deck.id),
        }),
      );
    });
    list.contentHeight = options.length * (ROW.height + ROW.gap) - ROW.gap;
    list.scrollTo(this.#scrollY);
  }

  /**
   * @param {Panel} panel
   * @param {SelectionLayout} layout
   * @returns {Button} the Start button
   */
  #buildFooter(panel, { panel: size, inset, listBottom, footer }) {
    const { navigate, hasScene } = this.services;
    const width = size.width - 2 * inset;
    const startSpec = { id: "startMatch", variant: /** @type {const} */ ("primary"), enabled: this.#selectedDeckId !== null, text: "Start match", onActivate: () => this.#startMatch() };
    const back = { id: "backToMenu", text: "Back", onActivate: () => navigate(SceneId.MAIN_MENU) };
    const builder = { id: "editDecks", text: "Deck builder", enabled: hasScene(SceneId.DECK_BUILDER), onActivate: () => navigate(SceneId.DECK_BUILDER, { from: SceneId.DECK_SELECTION }) };
    if (footer.oneRow) {
      const y = size.height - inset / 2 - footer.height;
      panel.add(new Button({ ...back, x: inset, y, width: COMPACT_FOOTER.back, height: footer.height }));
      panel.add(new Button({ ...builder, x: inset + COMPACT_FOOTER.back + footer.gap, y, width: COMPACT_FOOTER.builder, height: footer.height }));
      const startX = inset + COMPACT_FOOTER.back + COMPACT_FOOTER.builder + 2 * footer.gap;
      return panel.add(new Button({ ...startSpec, x: startX, y, width: inset + width - startX, height: footer.height }));
    }
    const half = (width - footer.gap) / 2;
    const top = size.height - listBottom + 20;
    const start = panel.add(new Button({ ...startSpec, x: inset, y: top, width, height: footer.height }));
    panel.add(new Button({ ...back, x: inset, y: top + footer.height + footer.gap, width: half, height: 50 }));
    panel.add(new Button({ ...builder, x: inset + half + footer.gap, y: top + footer.height + footer.gap, width: half, height: 50 }));
    return start;
  }

  /** @param {string} deckId */
  #select(deckId) {
    this.#selectedDeckId = deckId;
    this.#rememberScroll();
    this.#rebuild();
  }

  #rememberScroll() {
    const list = this.root.findById(LIST_ID);
    this.#scrollY = list instanceof ScrollList ? list.scrollY : 0;
  }

  #startMatch() {
    const options = this.#app.deckSelection.listPlayableDecks();
    const selected = options.find((option) => option.deck.id === this.#selectedDeckId);
    if (selected === undefined) {
      return;
    }
    const seed = this.#app.createSeed();
    const coinSeed = this.#app.createSeed();
    const others = this.#app.deckSelection.listRivalDecks().filter((option) => option.deck.id !== selected.deck.id);
    const rival = others.length === 0 ? selected : others[seedIndex(seed, others.length)];
    const created = this.#app.matchSetup.createMatch({
      seats: [
        { ...this.#humanSeat(), deckList: selected.deck, controller: humanController },
        { ...AI_SEAT, deckList: rival.deck, controller: new BasicAiController() },
      ],
      seed,
      coinSeed,
      aiDelayMs: this.services.theme.animation.mediumMs,
    });
    if (!created.ok) {
      this.services.logger.error("match setup failed", created.error);
      return;
    }
    this.#app.logger.info("match created", { deck: selected.deck.id, rival: rival.deck.id, seed, coinSeed, first: created.value.openingToss?.firstPlayerId ?? null });
    this.services.navigate(SceneId.MATCH, { session: created.value });
  }

  /** The player's seat: signed in, their STEEM account, so the board names them and shows their picture. */
  #humanSeat() {
    const state = this.#app.identity?.state;
    const account = state?.status === IdentityStatus.SIGNED_IN ? state.user?.account ?? null : null;
    return account === null ? HUMAN_SEAT : { ...HUMAN_SEAT, name: account, account };
  }
}

/**
 * Picks an index in `[0, length)` from the match seed: the hex key's first
 * 32 bits, or the integer itself when a test or tool passes a number.
 * @param {string | number} seed
 * @param {number} length
 */
function seedIndex(seed, length) {
  const value = typeof seed === "number" ? Math.abs(Math.trunc(seed)) : Number.parseInt(seed.slice(0, 8), 16);
  return Number.isFinite(value) ? value % length : 0;
}

/**
 * Subtitle of a deck row: size, faction mix, "preconstructed" for the
 * offline decks and, when not playable, why.
 * @param {import("../../application/decks/DeckSelectionService.js").DeckOption} option
 * @param {readonly import("../../application/decks/deckMix.js").FactionShare[]} mix
 */
function describeOption({ deck, source, report }, mix) {
  const notes = [...(source === DeckSource.PRECONSTRUCTED ? ["preconstructed"] : []), ...(report.valid ? [] : [`not playable: ${report.problems[0].message}`])];
  return deckSummary(deck.totalCards, mix, notes);
}
