/**
 * Deck selection: pick one of your decks and start a match against the
 * built-in AI, which plays a preconstructed deck (chosen by the match seed).
 * The Opponent button picks how strong it is, from the classic rules AI to
 * the search AI at its levels (AiOpponents.js); without an opponent factory
 * (tools, previews) the classic one plays.
 * A coin toss (with its own seed) decides who plays first; the match screen
 * shows it and starts the match once the coin has landed.
 * Signed in, "your decks" are the account's (the starter you took and the
 * decks you built), and the player sits at the table as that account (its
 * name and profile picture), and the finished game is sent to the server,
 * where it counts toward ranked play; offline, the preconstructed decks too. Each deck is a
 * banner row striped with its faction mix; decks that break the rules are shown
 * disabled with the first problem so the player knows to fix them.
 * On a compact screen the panel fills it and the footer is one row. Back is
 * the shell's, in the top bar.
 */
import { DEFAULT_PRACTICE_OPPONENT, PRACTICE_OPPONENTS } from "../../application/match/AiOpponents.js";
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
import { SceneId } from "./sceneIds.js";
import { SectionScene } from "./SectionScene.js";

/**
 * @typedef {Readonly<{
 *   panel: { width: number, height: number }, inset: number, row: { height: number, gap: number },
 *   title: { y: number, height: number }, subtitle: { y: number, height: number }, ornamentY: number | null,
 *   listTop: number, listBottom: number, footer: { height: number, gap: number, oneRow: boolean },
 * }>} SelectionLayout `listBottom`: room under the list for the footer; `footer.oneRow`: Edit decks and Start side by side
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
/** In the compact footer: Opponent (when offered) and Edit decks take these widths, Start the rest. */
const COMPACT_FOOTER = Object.freeze({ builder: 220 });
const COMPACT_FOOTER_WITH_OPPONENT = Object.freeze({ opponent: 200, builder: 180 });
/** The wide panel's margin from the content area's top and foot, when that area is shorter than the panel. */
const WIDE_MARGIN = 20;
/** The player's seat; signed in, it is named after their account instead. */
const HUMAN_SEAT = Object.freeze({ id: "player", name: "You" });
const AI_SEAT = Object.freeze({ id: "ai", name: "Opponent" });
const LIST_ID = "decks";

export class DeckSelectionScene extends SectionScene {
  #app;
  /** @type {string | null} */
  #selectedDeckId = null;
  #scrollY = 0;
  /** Which of PRACTICE_OPPONENTS plays; kept while the game runs. */
  #opponentId = DEFAULT_PRACTICE_OPPONENT;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services, app, { scene: SceneId.DECK_SELECTION, title: "Practice vs AI" });
    this.#app = app;
  }

  /** @param {Readonly<Record<string, unknown>>} [params] `{ back?: string }`: where Back leads (Play by default) */
  enter(params = {}) {
    this.routeBack(params);
    const options = this.#app.deckSelection.listPlayableDecks();
    // The deck the player plays with, wherever they chose it; else the first.
    const chosen = this.#app.selectedDeck?.pick(options, { idOf: (option) => option.deck.id }) ?? options[0] ?? null;
    this.#selectedDeckId = chosen?.deck.id ?? null;
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
      return { ...WIDE, panel: { width: WIDE.panel.width, height: Math.min(WIDE.panel.height, viewport.logicalHeight - 2 * WIDE_MARGIN) } };
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
    this.focus(this.findNode(focusedId) ?? (this.#selectedDeckId === null ? null : start));
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
    const builder = { id: "editDecks", text: "Edit decks", enabled: hasScene(SceneId.DECKS), onActivate: () => navigate(SceneId.DECKS, this.backHere()) };
    const opponent = this.#app.opponents === undefined ? null : { id: "opponent", text: `Opponent: ${this.#opponent().label}`, onActivate: () => this.#nextOpponent() };
    if (footer.oneRow) {
      const row =
        opponent === null
          ? [{ spec: builder, width: COMPACT_FOOTER.builder }]
          : [{ spec: opponent, width: COMPACT_FOOTER_WITH_OPPONENT.opponent }, { spec: builder, width: COMPACT_FOOTER_WITH_OPPONENT.builder }];
      const y = size.height - inset / 2 - footer.height;
      let x = inset;
      for (const button of row) {
        panel.add(new Button({ ...button.spec, x, y, width: button.width, height: footer.height }));
        x += button.width + footer.gap;
      }
      return panel.add(new Button({ ...startSpec, x, y, width: inset + width - x, height: footer.height }));
    }
    const top = size.height - listBottom + 20;
    const start = panel.add(new Button({ ...startSpec, x: inset, y: top, width, height: footer.height }));
    const secondary = [...(opponent === null ? [] : [opponent]), builder];
    const share = (width - (secondary.length - 1) * footer.gap) / secondary.length;
    secondary.forEach((spec, index) => panel.add(new Button({ ...spec, x: inset + index * (share + footer.gap), y: top + footer.height + footer.gap, width: share, height: 50 })));
    return start;
  }

  /** @returns {import("../../application/match/AiOpponents.js").NamedOpponent} */
  #opponent() {
    return PRACTICE_OPPONENTS.find((opponent) => opponent.id === this.#opponentId) ?? PRACTICE_OPPONENTS[0];
  }

  /** The next opponent, after the strongest the weakest again. */
  #nextOpponent() {
    const index = PRACTICE_OPPONENTS.findIndex((opponent) => opponent.id === this.#opponentId);
    this.#opponentId = PRACTICE_OPPONENTS[(index + 1) % PRACTICE_OPPONENTS.length].id;
    this.#rememberScroll();
    this.#rebuild();
  }

  /** @param {string} deckId */
  #select(deckId) {
    this.#selectedDeckId = deckId;
    this.#app.selectedDeck?.choose(deckId);
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
    const human = this.#humanSeat();
    const created = this.#app.matchSetup.createMatch({
      seats: [
        { ...human, deckList: selected.deck, controller: humanController },
        { ...AI_SEAT, deckList: rival.deck, controller: this.#app.opponents?.controllerFor(this.#opponent().spec, seed) ?? new BasicAiController() },
      ],
      seed,
      coinSeed,
      aiDelayMs: this.services.theme.animation.mediumMs,
    });
    if (!created.ok) {
      this.services.logger.error("match setup failed", created.error);
      return;
    }
    this.#app.logger.info("match created", { deck: selected.deck.id, rival: rival.deck.id, opponent: this.#app.opponents === undefined ? "classic" : this.#opponentId, seed, coinSeed, first: created.value.openingToss?.firstPlayerId ?? null });
    if ("account" in human) {
      this.#app.practice?.track(created.value, HUMAN_SEAT.id);
    }
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
