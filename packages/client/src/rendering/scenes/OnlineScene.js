/**
 * The online lobby: pick one of your account decks, find an opponent,
 * and go to the match when the server starts it. A game already running
 * (after a reload or a dropped connection) is offered for resuming.
 */
import { OnlineStatus } from "../../application/online/OnlineService.js";
import { factionTones } from "../theme/Theme.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { COLUMNS, HEADER, INSET, ROW, rowY, rowsHeight } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const LIST_ID = "online.decks";
const BUTTON = Object.freeze({ height: 60 });

/** What the lobby says in each state. */
const STATUS_TEXT = Object.freeze({
  [OnlineStatus.OFFLINE]: () => "Not connected to the game server. Reconnecting…",
  [OnlineStatus.CONNECTING]: () => "Connecting to the game server…",
  [OnlineStatus.IDLE]: () => "Choose a deck and find an opponent. The first player is drawn by lot.",
  [OnlineStatus.SEARCHING]: () => "Looking for an opponent…",
  [OnlineStatus.MATCHED]: (state) => `Opponent found: @${state.opponent ?? "?"}. Shuffling with both players' randomness…`,
  [OnlineStatus.PLAYING]: (state) => `Your game against @${state.opponent ?? "?"} is in progress.`,
  [OnlineStatus.OVER]: () => "The game is over.",
});

export class OnlineScene extends Scene {
  #app;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** @type {string | null} */
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
    const online = this.#online();
    this.#unsubscribe = online.subscribe((state) => this.#onChange(state));
    online.start();
    this.#rebuild();
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.exit();
  }

  onCancel() {
    this.#leave();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "online" });
    super.render(context);
  }

  /** @param {import("../../application/online/OnlineService.js").OnlineState} state */
  #onChange(state) {
    // The match screen takes over as soon as the server has sent the first state of the game.
    if (state.status === OnlineStatus.PLAYING && state.session?.hasSnapshot && !state.session.isStopped) {
      this.services.navigate(SceneId.MATCH, { session: state.session, againScene: SceneId.ONLINE });
      return;
    }
    this.#rebuild();
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.root.clear();
    const { viewport } = this.services;
    this.root.add(new Label({ x: HEADER.sideMargin, y: HEADER.y, width: 400, height: HEADER.height, text: "Play online", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const back = this.root.add(new Button({ id: "online.back", x: viewport.logicalWidth - HEADER.sideMargin - HEADER.backWidth, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: "Back to menu", onActivate: () => this.#leave() }));
    const firstDeck = this.#buildDecks();
    const action = this.#buildActions();
    this.focus(this.root.findById(focusedId) ?? action ?? firstDeck ?? back);
    this.services.requestRender();
  }

  /** @returns {Button | null} */
  #buildDecks() {
    const panel = this.root.add(new Panel({ x: COLUMNS.left.x, y: COLUMNS.top, width: COLUMNS.left.width, height: COLUMNS.height }));
    const width = COLUMNS.left.width - 2 * INSET;
    panel.add(new Label({ x: INSET, y: 14, width, height: 36, text: "Your decks", size: "heading", weight: "bold", colorKey: "accentLight", align: "left" }));
    const list = panel.add(new ScrollList({ id: LIST_ID, x: INSET, y: 60, width, height: COLUMNS.height - 60 - INSET }));
    const decks = this.#online().decks();
    if (!decks.some((deck) => deck.id === this.#selectedId && deck.playable)) {
      this.#selectedId = decks.find((deck) => deck.playable)?.id ?? null;
    }
    if (decks.length === 0) {
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 3 * ROW.height, text: "You have no decks in your account yet. Take your free starter deck, or build a deck in the Deck Builder.", size: "small", colorKey: "textMuted" }));
      list.contentHeight = 3 * ROW.height;
      return null;
    }
    /** @type {Button | null} */
    let first = null;
    decks.forEach((deck, index) => {
      const row = list.add(
        new OptionRow({
          id: `online.deck.${deck.id}`,
          x: 0,
          y: rowY(index),
          width: list.rowWidth,
          height: ROW.height,
          text: deck.name,
          subtitle: deck.playable ? `${deck.faction} · ${deck.totalCards} cards` : `not playable: ${deck.problem ?? "fix it in the Deck Builder"}`,
          enabled: deck.playable,
          selected: deck.id === this.#selectedId,
          stripeColor: factionTones(this.services.theme, deck.faction).base,
          onActivate: () => {
            this.#selectedId = deck.id;
            this.#rebuild();
          },
        }),
      );
      first ??= row;
    });
    list.contentHeight = rowsHeight(decks.length);
    return first;
  }

  /** @returns {Button | null} the main action */
  #buildActions() {
    const online = this.#online();
    const state = online.state;
    const panel = this.root.add(new Panel({ x: COLUMNS.right.x, y: COLUMNS.top, width: COLUMNS.right.width, height: COLUMNS.height }));
    const width = COLUMNS.right.width - 2 * INSET;
    panel.add(new Label({ x: INSET, y: 14, width, height: 36, text: "Casual game", size: "heading", weight: "bold", colorKey: "accentLight", align: "left" }));
    const status = STATUS_TEXT[/** @type {keyof typeof STATUS_TEXT} */ (state.status)]?.(state) ?? "";
    panel.add(new TextBlock({ id: "online.status", x: INSET, y: 64, width, height: 3 * 28, text: status, size: "body", colorKey: "text" }));
    if (state.error !== null) {
      panel.add(new TextBlock({ id: "online.error", x: INSET, y: 160, width, height: 2 * 28, text: state.error.message, size: "small", colorKey: "danger" }));
    }
    panel.add(new TextBlock({ x: INSET, y: 240, width, height: 4 * 26, text: "The server runs the game and checks every move. Both players add randomness to the shuffle after the server has committed to its own, and the whole game is recorded so it can be verified later.", size: "small", colorKey: "textMuted" }));
    const y = COLUMNS.height - INSET - BUTTON.height;
    if (state.status === OnlineStatus.SEARCHING) {
      return panel.add(new Button({ id: "online.cancel", x: INSET, y, width, height: BUTTON.height, text: "Stop searching", onActivate: () => online.leaveQueue() }));
    }
    if (state.status === OnlineStatus.PLAYING && state.session !== null) {
      return panel.add(new Button({ id: "online.resume", x: INSET, y, width, height: BUTTON.height, text: "Resume your game", variant: "primary", onActivate: () => this.services.navigate(SceneId.MATCH, { session: online.resume(), againScene: SceneId.ONLINE }) }));
    }
    const canQueue = state.status === OnlineStatus.IDLE || state.status === OnlineStatus.OVER;
    return panel.add(
      new Button({
        id: "online.find",
        x: INSET,
        y,
        width,
        height: BUTTON.height,
        text: "Find a match",
        variant: "primary",
        enabled: canQueue && this.#selectedId !== null,
        onActivate: () => {
          online.dismissGame();
          online.queue(/** @type {string} */ (this.#selectedId));
        },
      }),
    );
  }

  #leave() {
    const online = this.#online();
    if (online.state.status === OnlineStatus.SEARCHING) {
      online.leaveQueue();
    }
    this.services.navigate(SceneId.MAIN_MENU);
  }

  #online() {
    if (this.#app.online === undefined) {
      throw new Error("OnlineScene needs the online service");
    }
    return this.#app.online;
  }
}
