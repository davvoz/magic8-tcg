/**
 * Deck selection: pick one of your decks and start a match against the
 * built-in AI, which plays a preconstructed deck (chosen by the match seed).
 * A coin toss (with its own seed) decides who plays first; the match screen
 * shows it and starts the match once the coin has landed.
 * Signed in, "your decks" are the account's (the starter you took and the
 * decks you built); offline, the preconstructed decks too. Each deck is a
 * banner row striped with its faction mix; decks that break the rules are shown
 * disabled with the first problem so the player knows to fix them.
 */
import { BasicAiController } from "../../application/match/BasicAiController.js";
import { DeckSource } from "../../application/decks/DeckSelectionService.js";
import { deckMix } from "../../application/decks/deckMix.js";
import { humanController } from "../../application/match/HumanController.js";
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

const PANEL = Object.freeze({ width: 1200, height: 780 });
const INSET = 60;
const ROW = Object.freeze({ height: 72, gap: 12 });
const LIST_TOP = 150;
const LIST_BOTTOM = 170;
const FOOTER = Object.freeze({ height: 60, gap: 20 });
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

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.root.clear();
    const { viewport } = this.services;
    const panel = this.root.add(new Panel({ x: (viewport.logicalWidth - PANEL.width) / 2, y: (viewport.logicalHeight - PANEL.height) / 2, width: PANEL.width, height: PANEL.height }));
    panel.add(new Label({ x: 0, y: 24, width: PANEL.width, height: 56, text: "Choose your deck", size: "heading", weight: "bold", colorKey: "accentLight", glow: true }));
    panel.add(new Label({ x: 0, y: 80, width: PANEL.width, height: 28, text: "The opponent plays one of the preconstructed decks.", size: "small", colorKey: "textMuted" }));
    panel.add(new Ornament({ x: PANEL.width / 2 - 160, y: 112, width: 320, height: 14 }));
    this.#buildList(panel);
    const start = this.#buildFooter(panel);
    this.focus(this.root.findById(focusedId) ?? (this.#selectedDeckId === null ? null : start));
    this.services.requestRender();
  }

  /** @param {Panel} panel */
  #buildList(panel) {
    const options = this.#app.deckSelection.listDecks();
    const width = PANEL.width - 2 * INSET;
    const list = panel.add(new ScrollList({ id: LIST_ID, x: INSET, y: LIST_TOP, width, height: PANEL.height - LIST_TOP - LIST_BOTTOM }));
    if (options.length === 0) {
      list.add(new Label({ x: 0, y: 0, width, height: ROW.height, text: this.#app.account?.needsStarter ? "No decks yet: take your free starter deck from the main menu." : "No decks are available.", colorKey: "textMuted" }));
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
   * @returns {Button} the Start button
   */
  #buildFooter(panel) {
    const { navigate, hasScene } = this.services;
    const width = PANEL.width - 2 * INSET;
    const half = (width - FOOTER.gap) / 2;
    const top = PANEL.height - LIST_BOTTOM + 20;
    const start = panel.add(new Button({ id: "startMatch", x: INSET, y: top, width, height: FOOTER.height, variant: "primary", enabled: this.#selectedDeckId !== null, text: "Start match", onActivate: () => this.#startMatch() }));
    panel.add(new Button({ id: "backToMenu", x: INSET, y: top + FOOTER.height + FOOTER.gap, width: half, height: 50, text: "Back", onActivate: () => navigate(SceneId.MAIN_MENU) }));
    panel.add(new Button({ id: "editDecks", x: INSET + half + FOOTER.gap, y: top + FOOTER.height + FOOTER.gap, width: half, height: 50, text: "Deck builder", enabled: hasScene(SceneId.DECK_BUILDER), onActivate: () => navigate(SceneId.DECK_BUILDER) }));
    return start;
  }

  /** @param {string} deckId */
  #select(deckId) {
    this.#selectedDeckId = deckId;
    const list = this.root.findById(LIST_ID);
    this.#scrollY = list instanceof ScrollList ? list.scrollY : 0;
    this.#rebuild();
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
        { ...HUMAN_SEAT, deckList: selected.deck, controller: humanController },
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
