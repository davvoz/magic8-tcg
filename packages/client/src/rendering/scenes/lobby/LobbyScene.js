/**
 * What the two online lobbies, Casual and Ranked, have in common: pick one
 * of your account decks (left), see who else is online (middle) and, on the
 * right, the lobby's own panel: how its games work, where the player stands
 * and its big button, which finds an opponent in the queue of that lobby's
 * mode. A click on a player proposes a game of that mode with the selected
 * deck. A challenge received of the lobby's mode takes the status's place in
 * the panel (who, the time left to answer, the deck the player would play
 * with) and its big button becomes Accept, beside Decline; one of the other
 * mode is answered in that mode's lobby (the toast and the notifications
 * lead there). The match screen takes over when the server starts the game; a game
 * already running (after a reload or a dropped connection) is offered for
 * resuming. The list of players is read again every few seconds while a
 * lobby is shown.
 *
 * Once matched (protocol v2), the game waits until both players accept it
 * with Keychain: the lobby says who has. If either does not, the game is
 * cancelled, the lobby says who did not accept, and a new search can start.
 *
 * A ranked challenge the player holds no entries for offers to get them in
 * place of Accept (the Ranked lobby's purchase).
 *
 * The lobbies extend this: `queueMode`, the panel (`buildGame`) and what it
 * says when nothing is going on (`idleText`); the hooks below have defaults.
 */
import { PlayerActivity } from "../../../application/lobby/LobbyService.js";
import { OnlineStatus } from "../../../application/online/OnlineService.js";
import { deckSummary, mixBands } from "../../cards/deckStripe.js";
import { AvatarNode } from "../../ui/AvatarNode.js";
import { drawSceneBackdrop } from "../../ui/backdrop.js";
import { Button } from "../../ui/Button.js";
import { Label } from "../../ui/Label.js";
import { Modal } from "../../ui/Modal.js";
import { OptionRow } from "../../ui/OptionRow.js";
import { Panel } from "../../ui/Panel.js";
import { ScrollList } from "../../ui/ScrollList.js";
import { TextBlock } from "../../ui/TextBlock.js";
import { screenLayout } from "../deckBuilder/layout.js";
import { SceneId } from "../sceneIds.js";
import { SectionScene } from "../SectionScene.js";
import { ACTIVITY_TEXT, STATUS_TEXT, answerTimeText, lobbyOf, modeName } from "./lobbyText.js";

const LIST_ID = "online.decks";
const PLAYERS_ID = "online.players";
const ANSWER_TIME_ID = "online.answer.time";
/**
 * Sizes of a lobby, wide and compact (a phone in landscape: the three columns share its width).
 * @typedef {Readonly<{ button: number, row: { height: number, gap: number }, playerRow: { height: number, gap: number }, titleY: number, listTop: number, statusSize: "body" | "small", note: boolean, top: number }>} LobbyMetrics
 *   `row`: a row of buttons inside the panel; `note`: room for the paragraphs a phone leaves out; `top`: where a phone's
 *   panel content starts, below its painted corners
 */
/** @type {LobbyMetrics} */
const WIDE = Object.freeze({ button: 60, row: Object.freeze({ height: 48, gap: 12 }), playerRow: Object.freeze({ height: 64, gap: 8 }), titleY: 14, listTop: 60, statusSize: "body", note: true, top: 14 });
/** @type {LobbyMetrics} */
const COMPACT = Object.freeze({ button: 46, row: Object.freeze({ height: 46, gap: 6 }), playerRow: Object.freeze({ height: 52, gap: 6 }), titleY: 8, listTop: 50, statusSize: "small", note: false, top: 16 });
/** The three columns (your decks, the players online, the lobby's panel): their share of the width and the gap between them. */
const COLUMN_SPLIT = Object.freeze({
  wide: Object.freeze({ shares: Object.freeze([0.278, 0.278, 0.444]), gap: 20 }),
  compact: Object.freeze({ shares: Object.freeze([0.3, 0.31, 0.39]), gap: 8 }),
});
/** The status and the error under it, on a wide screen: what a line at the foot of the panel must leave them. */
const STATUS_ROOM = 176;
const DIALOG = Object.freeze({ width: 680, height: 320, avatar: 72, buttonHeight: 52, gap: 14 });
/**
 * A challenge received, in the panel: the challenger's portrait, the title beside it, the line of the time left under
 * it, the gap before the words, a line of an error over the buttons, and how much of the buttons' row Accept takes (its
 * plate's ornate ends are wider than Decline's: on a phone, half the row would set its word smaller).
 */
const ANSWER = Object.freeze({
  wide: Object.freeze({ avatar: 64, title: 34, line: 26, gap: 14, errorLine: 26, titleSize: "subheading", lineSize: "small", acceptShare: 0.5 }),
  compact: Object.freeze({ avatar: 40, title: 22, line: 18, gap: 6, errorLine: 20, titleSize: "body", lineSize: "tiny", acceptShare: 0.56 }),
});

/**
 * @typedef {{ kind: "challenge", account: string } | { kind: string }} Dialog
 *   a lobby's own dialogs are named by their `kind`
 * @typedef {{ id: string, text: string, colorKey: string }} Foot a line at the foot of the panel, over its button
 * @typedef {{ id: string, text: string, variant?: import("../../ui/Button.js").ButtonVariant, enabled?: boolean, onActivate: () => void }} MainAction
 * @typedef {{ id: string, text: string, variant: import("../../ui/Button.js").ButtonVariant, enabled: boolean, onActivate: () => void }} DialogButton
 * @typedef {Readonly<{ x: number, width: number }>} Column
 */

export class LobbyScene extends SectionScene {
  #app;
  #now;
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** @type {string | null} */
  #selectedId = null;
  /** The dialog open, if any (rebuilt with the scene). @type {Dialog | null} */
  #dialog = null;
  /** Scroll offsets by list id, kept across rebuilds (the list of players refreshes every few seconds). @type {Record<string, number>} */
  #scroll = {};
  /** The online status last seen: a game created or called off changes the player's entries. @type {string | null} */
  #lastStatus = null;

  /**
   * @param {import("../Scene.js").SceneServices} services
   * @param {import("../../../application/AppContext.js").AppContext} app
   * @param {{ scene: string, title: string, now?: () => number }} options
   */
  constructor(services, app, { scene, title, now = () => Date.now() }) {
    super(services, app, { scene, title });
    this.#app = app;
    this.#now = now;
  }

  // ——— What each lobby says and does ———

  /**
   * The mode the queue and the challenges sent from here are in.
   * @returns {"casual" | "ranked"}
   */
  get queueMode() {
    throw new Error("a lobby names its mode");
  }

  /**
   * The lobby's panel, inside the right column's: what its games are, then its status and its big button.
   * @param {Panel} _panel
   * @param {{ width: number, height: number }} _room the panel's inner width and its height
   * @returns {Button | null} the big button
   */
  buildGame(_panel, _room) {
    throw new Error("a lobby builds its panel");
  }

  /** What the lobby says while nothing is going on. */
  idleText() {
    return "";
  }

  /** The light around the lobby's panel (null: none). @returns {string | null} */
  get panelGlow() {
    return null;
  }

  /**
   * What the lobby says instead of its status, when it must (ranked play not open yet); null to say the status.
   * @returns {string | null}
   */
  lobbyNotice() {
    return null;
  }

  /**
   * What stands before a search, as the big button (ranked play locked, no entries); null when nothing does.
   * @returns {MainAction | null}
   */
  gateAction() {
    return null;
  }

  /** What the big button says to find a match. */
  findText() {
    return "Find a match";
  }

  /** Whether the player may queue in this lobby's mode now (as far as the lobby knows: the server decides). */
  mayQueue() {
    return true;
  }

  /**
   * A dialog of the lobby's own (rebuilt with the scene), or null when it no longer applies.
   * @param {Dialog} _dialog
   * @returns {Modal | null}
   */
  ownDialog(_dialog) {
    return null;
  }

  /**
   * What proposing a game to a player says and offers in this lobby: a sentence added to the dialog's message, and
   * whether it can be sent; `extra`: a button beside Send (getting what is missing).
   * @param {import("../../../application/online/OnlineService.js").OnlineDeck | null} _deck the deck the player would play with
   * @returns {{ note: string, enabled: boolean, send: string, extra?: DialogButton }}
   */
  challengeTerms(_deck) {
    return { note: "", enabled: true, send: "Send challenge" };
  }

  /** Gets ranked entries: the Ranked lobby with its purchase open (Back comes back here). The Ranked lobby opens it in place. */
  getEntries() {
    this.services.navigate(SceneId.RANKED, { buy: true, ...this.backHere() });
  }

  /** How tall the band the lobby puts over its decks and players is (0: none). */
  bannerHeight() {
    return 0;
  }

  /**
   * Builds that band, across the decks and the players.
   * @param {{ x: number, y: number, width: number, height: number }} _frame
   */
  buildBanner(_frame) {
    // None by default.
  }

  /** The lobby's services to follow while it is shown, besides the game and the players online. */
  watchServices() {
    // Nothing more by default.
  }

  // ——— For the lobbies ———

  get app() {
    return this.#app;
  }

  /** The time now. */
  now() {
    return this.#now();
  }

  /** The frame for the screen in use (the compact one on a phone). */
  get screen() {
    return screenLayout(this.services.viewport, { toolbar: false });
  }

  /** @returns {LobbyMetrics} */
  get metrics() {
    return this.screen.compact ? COMPACT : WIDE;
  }

  /**
   * Follows a service while the lobby is shown.
   * @param {...(() => void)} unsubscribes
   */
  watch(...unsubscribes) {
    this.#unsubscribes.push(...unsubscribes);
  }

  online() {
    if (this.#app.online === undefined) {
      throw new Error("a lobby needs the online service");
    }
    return this.#app.online;
  }

  /** The deck the player plays with, when it is playable; else null. */
  selectedDeck() {
    return this.online().decks().find((deck) => deck.id === this.#selectedId && deck.playable) ?? null;
  }

  /** Whether the player may challenge or accept now: not in a game, and none starting. */
  free() {
    const status = this.online().state.status;
    return status !== OnlineStatus.MATCHED && status !== OnlineStatus.PLAYING && status !== OnlineStatus.OFFLINE && status !== OnlineStatus.CONNECTING;
  }

  /**
   * The challenge the panel answers: the oldest received in the lobby's mode, while the player is free to take it; else null.
   * @returns {import("../../../application/lobby/LobbyService.js").Challenge | null}
   */
  incomingChallenge() {
    return this.free() ? this.#incoming()[0] ?? null : null;
  }

  /** The challenges received in the lobby's mode, oldest first. */
  #incoming() {
    return (this.#app.lobby?.state.incoming ?? []).filter((challenge) => challenge.mode === this.queueMode);
  }

  /** Whether the player is looking for an opponent. */
  searching() {
    return this.online().state.status === OnlineStatus.SEARCHING;
  }

  /** Whether the player holds what a ranked game costs (true when it is free, or not known: the server decides). */
  hasEntries() {
    return this.#app.entries?.canPlayRanked ?? true;
  }

  /** Whether a season is running that the player may not play ranked in yet (not while their standing is still being read). */
  rankedLocked() {
    const standing = this.#app.ranking?.state.standing ?? null;
    return standing !== null && standing.season !== null && !standing.eligible;
  }

  /** Whether the server says the player may play ranked. */
  rankedAllowed() {
    return this.#app.ranking?.state.standing?.eligible === true;
  }

  /** Lays the lobby out again from what the services say. */
  rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.#rememberScroll();
    if (this.modal !== null) {
      this.closeModal();
    }
    this.root.clear();
    this.#buildBanner();
    const firstDeck = this.#buildDecks();
    this.#buildPlayers();
    const action = this.#buildGameColumn();
    this.focus(this.findNode(focusedId) ?? action ?? firstDeck ?? this.backButton);
    this.#reopenDialog(focusedId);
    this.services.requestRender();
  }

  /**
   * Opens a dialog (and keeps it open across rebuilds while it still applies).
   * @param {Dialog} dialog
   */
  openDialog(dialog) {
    this.#dialog = dialog;
    this.#app.lobby?.clearError();
    this.rebuild();
  }

  closeDialog() {
    this.#dialog = null;
    this.rebuild();
  }

  /** The dialog open, if any. */
  get dialog() {
    return this.#dialog;
  }

  /**
   * The status of the panel and its big button; on a wide screen, the paragraph on fair play and a line at the foot,
   * over the button (left out where an error would cover it). A challenge received takes their place.
   * @param {Panel} panel
   * @param {{ width: number, height: number }} room
   * @param {{ top: number, fair: boolean, foot: Foot | null }} options `top`: where the status starts; `fair`: the
   *   paragraph on how games are kept fair
   */
  buildPlay(panel, { width, height }, { top, fair, foot }) {
    const inset = this.screen.inset;
    const { button, note } = this.metrics;
    const buttonY = height - inset - button;
    const error = this.#error();
    const challenge = this.incomingChallenge();
    if (challenge !== null) {
      return this.#buildAnswer(panel, challenge, { width, top, buttonY, error });
    }
    this.#buildStatus(panel, width, { top, bottom: buttonY - 6, error });
    if (note && fair) {
      panel.add(new TextBlock({ x: inset, y: top + 190, width, height: 5 * 26, text: "The server runs the game and checks every move. Both players add randomness to the shuffle after the server has committed to its own, and every move of the game is recorded.", size: "small", colorKey: "textMuted" }));
    }
    const footY = buttonY - 14 - 2 * 26;
    if (note && foot !== null && (error === null || top + STATUS_ROOM <= footY)) {
      panel.add(new TextBlock({ ...foot, x: inset, y: footY, width, height: 2 * 26, size: "small" }));
    }
    return this.buildMainButton(panel, this.mainAction(), { width, y: buttonY });
  }

  /**
   * The panel's big button, at its foot.
   * @param {Panel} panel
   * @param {MainAction} action
   * @param {{ width: number, y: number }} where
   */
  buildMainButton(panel, action, { width, y }) {
    return panel.add(new Button({ keepPlate: true, ...action, x: this.screen.inset, y, width, height: this.metrics.button }));
  }

  /**
   * The big button: what is going on first (searching, a game, a challenge out), then what stands before a search,
   * else find a match.
   * @returns {MainAction}
   */
  mainAction() {
    return this.busyAction() ?? this.gateAction() ?? this.#findAction();
  }

  /**
   * Stop searching, resume the game, or withdraw the challenge; null when none is going on.
   * @returns {MainAction | null}
   */
  busyAction() {
    const online = this.online();
    const state = online.state;
    if (state.status === OnlineStatus.SEARCHING) {
      return { id: "online.cancel", text: "Stop searching", onActivate: () => online.leaveQueue() };
    }
    if (state.status === OnlineStatus.PLAYING && state.session !== null) {
      return { id: "online.resume", text: "Resume your game", variant: "primary", onActivate: () => this.services.navigate(SceneId.MATCH, { session: online.resume(), againScene: lobbyOf(state.mode) }) };
    }
    if (this.#waitingChallenge() !== null) {
      return { id: "online.withdraw", text: "Withdraw challenge", onActivate: () => this.#app.lobby?.cancel() };
    }
    return null;
  }

  /**
   * A dialog: a player's portrait (none for nobody), a title, a message and a row of buttons.
   * @param {{ id?: string, account: string | null, title: string, message: string, buttons: readonly DialogButton[] }} content
   */
  dialogFrame({ id = "challenge", account, title, message, buttons }) {
    const { viewport } = this.services;
    const inset = this.screen.inset;
    const width = Math.min(DIALOG.width, viewport.logicalWidth - 2 * inset);
    const height = Math.min(DIALOG.height, viewport.logicalHeight - 2 * inset);
    const modal = new Modal({ id, width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: () => this.closeDialog() });
    const { panel } = modal;
    const inner = width - 2 * inset;
    if (account !== null) {
      panel.add(new AvatarNode({ x: inset, y: inset, size: DIALOG.avatar, account }));
    }
    const textX = account === null ? inset : inset + DIALOG.avatar + 20;
    const textWidth = width - inset - textX;
    panel.add(new Label({ id: "challenge.title", x: textX, y: inset + 4, width: textWidth, height: 40, text: title, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const buttonY = height - inset - DIALOG.buttonHeight;
    panel.add(new TextBlock({ id: "challenge.message", x: textX, y: inset + 52, width: textWidth, height: Math.max(0, buttonY - 8 - inset - 52), text: message, size: "small", colorKey: "textMuted" }));
    const buttonWidth = (inner - (buttons.length - 1) * DIALOG.gap) / buttons.length;
    buttons.forEach((button, index) => panel.add(new Button({ ...button, x: inset + index * (buttonWidth + DIALOG.gap), y: buttonY, width: buttonWidth, height: DIALOG.buttonHeight, textSize: "small" })));
    return modal;
  }

  // ——— The scene ———

  /**
   * @param {{ back?: string }} [params] `back`: where Back leads (Play by default)
   */
  enter(params = {}) {
    this.routeBack(params);
    const online = this.online();
    this.watch(online.subscribe((state) => this.#onChange(state)));
    online.start();
    if (this.#app.ranking !== undefined) {
      this.watch(this.#app.ranking.subscribe(() => this.rebuild()));
      this.#app.ranking.refresh();
    }
    const entries = this.#app.entries;
    if (entries !== undefined) {
      this.watch(entries.subscribe(() => this.rebuild()));
      void entries.refresh();
    }
    this.#lastStatus = online.state.status;
    const lobby = this.#app.lobby;
    if (lobby !== undefined) {
      this.watch(lobby.subscribe(() => this.rebuild()));
      lobby.start();
      this.watch(lobby.watch());
    }
    this.watchServices();
    this.rebuild();
  }

  exit() {
    this.#unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#unsubscribes = [];
    this.#dialog = null;
    super.exit();
  }

  relayout() {
    this.rebuild();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "online" });
    super.render(context);
  }

  /**
   * Moves the time left to answer a challenge on.
   * @param {number} dtMs
   */
  update(dtMs) {
    const base = super.update(dtMs);
    const label = this.root.findById(ANSWER_TIME_ID);
    const challenge = this.incomingChallenge();
    if (!(label instanceof Label) || challenge === null || this.#app.lobby === undefined) {
      return base;
    }
    const text = answerTimeText(challenge.mode, this.#app.lobby.secondsLeft(challenge), { short: this.screen.compact });
    if (label.text === text) {
      return base;
    }
    label.text = text;
    return true;
  }

  /** Back: out of the queue first, when the player is in it. */
  goBack() {
    if (this.searching()) {
      this.online().leaveQueue();
    }
    return super.goBack();
  }

  /** The three columns for the screen in use. */
  get #columns() {
    const screen = this.screen;
    const split = screen.compact ? COLUMN_SPLIT.compact : COLUMN_SPLIT.wide;
    const { sideMargin } = screen.header;
    const inner = this.services.viewport.logicalWidth - 2 * sideMargin - 2 * split.gap;
    const [decks, players] = split.shares.map((share) => Math.round(inner * share));
    const game = inner - decks - players;
    return {
      decks: { x: sideMargin, width: decks },
      players: { x: sideMargin + decks + split.gap, width: players },
      game: { x: sideMargin + decks + players + 2 * split.gap, width: game },
    };
  }

  /** Where the decks and the players stand: the columns' frame, below the band when the lobby has one. */
  get #lists() {
    const { columns } = this.screen;
    const banner = this.bannerHeight();
    const gap = banner > 0 ? this.#split.gap : 0;
    return { top: columns.top + banner + gap, height: columns.height - banner - gap };
  }

  get #split() {
    return this.screen.compact ? COLUMN_SPLIT.compact : COLUMN_SPLIT.wide;
  }

  /** The lobby's band over the decks and the players, when it has one. */
  #buildBanner() {
    const height = this.bannerHeight();
    if (height === 0) {
      return;
    }
    const { decks, players } = this.#columns;
    this.buildBanner({ x: decks.x, y: this.screen.columns.top, width: players.x + players.width - decks.x, height });
  }

  /** @param {import("../../../application/online/OnlineService.js").OnlineState} state */
  #onChange(state) {
    // A game found takes the entries it costs; a game called off gives them back.
    if (state.status !== this.#lastStatus && (state.status === OnlineStatus.MATCHED || state.status === OnlineStatus.CANCELLED)) {
      void this.#app.entries?.refresh();
    }
    this.#lastStatus = state.status;
    // The match screen takes over as soon as the server has sent the first state of the game.
    if (state.status === OnlineStatus.PLAYING && state.session?.hasSnapshot && !state.session.isStopped) {
      this.services.navigate(SceneId.MATCH, { session: state.session, againScene: lobbyOf(state.mode ?? this.queueMode) });
      return;
    }
    this.rebuild();
  }

  /** @returns {Button | null} */
  #buildDecks() {
    const screen = this.screen;
    const column = this.#columns.decks;
    const { titleY, listTop } = this.metrics;
    const { top, height } = this.#lists;
    const panel = this.root.add(new Panel({ ...screen.panel, x: column.x, y: top, width: column.width, height }));
    const width = column.width - 2 * screen.inset;
    panel.add(new Label({ x: screen.titleInset, y: titleY, width: width - 2 * (screen.titleInset - screen.inset), height: 36, text: "Your decks", size: "subheading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const list = panel.add(new ScrollList({ id: LIST_ID, x: screen.inset, y: listTop, width, height: height - listTop - screen.inset }));
    const decks = this.online().decks();
    if (!decks.some((deck) => deck.id === this.#selectedId && deck.playable)) {
      // The deck the player plays with, wherever they chose it; else the first that can be played.
      const playable = (/** @type {import("../../../application/online/OnlineService.js").OnlineDeck} */ deck) => deck.playable;
      const chosen = this.#app.selectedDeck?.pick(decks, { idOf: deckKey, playable }) ?? decks.find(playable) ?? null;
      this.#selectedId = chosen?.id ?? null;
    }
    if (decks.length === 0) {
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 3 * screen.row.height, text: "You have no decks in your account yet. Take your free starter deck, or build a deck in the Deck Builder.", size: "small", colorKey: "textMuted" }));
      list.contentHeight = 3 * screen.row.height;
      return null;
    }
    /** @type {Button | null} */
    let first = null;
    decks.forEach((deck, index) => {
      const row = list.add(
        new OptionRow({
          id: `online.deck.${deck.id}`,
          x: 0,
          y: screen.rowY(index),
          width: list.rowWidth,
          height: screen.row.height,
          text: deck.name,
          subtitle: deck.playable ? deckSummary(deck.totalCards, deck.mix) : `not playable: ${deck.problem ?? "fix it in the Deck Builder"}`,
          enabled: deck.playable,
          selected: deck.id === this.#selectedId,
          stripe: mixBands(this.services.theme, deck.mix),
          onActivate: () => {
            this.#selectedId = deck.id;
            this.#app.selectedDeck?.choose(deckKey(deck));
            this.rebuild();
          },
        }),
      );
      first ??= row;
    });
    list.contentHeight = screen.rowsHeight(decks.length);
    list.scrollTo(this.#scroll[LIST_ID] ?? 0);
    return first;
  }

  /** The players online, each once: one challenging the player in the lobby's mode says so (the panel answers it). */
  #buildPlayers() {
    const screen = this.screen;
    const column = this.#columns.players;
    const { titleY, listTop, playerRow: PLAYER_ROW } = this.metrics;
    const { top, height } = this.#lists;
    const panel = this.root.add(new Panel({ ...screen.panel, x: column.x, y: top, width: column.width, height }));
    const width = column.width - 2 * screen.inset;
    const lobby = this.#app.lobby;
    const players = lobby?.state.players ?? [];
    const titleIndent = screen.titleInset - screen.inset;
    panel.add(new Label({ x: screen.titleInset, y: titleY, width: width - 40 - titleIndent, height: 36, text: screen.compact ? "Online" : "Players online", size: "subheading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    if (lobby?.state.loaded) {
      panel.add(new Label({ id: "online.players.count", x: screen.inset, y: titleY, width: width - titleIndent, height: 36, text: String(players.length), size: "body", weight: "bold", colorKey: "textMuted", align: "right" }));
    }
    const list = panel.add(new ScrollList({ id: PLAYERS_ID, x: screen.inset, y: listTop, width, height: height - listTop - screen.inset }));
    if (lobby === undefined) {
      return;
    }
    const { outgoing } = lobby.state;
    const canChallenge = this.free();
    const answering = this.incomingChallenge();
    const challengers = new Set(answering === null ? [] : this.#incoming().map((challenge) => challenge.from));
    /** @type {{ id: string, text: string, subtitle: string, avatar: string, selected: boolean, enabled: boolean, onActivate: () => void }[]} */
    const rows = players.map((player) => {
      const challenged = outgoing?.to === player.account;
      const challenger = challengers.has(player.account);
      const base = { id: `online.player.${player.account}`, text: `@${player.account}`, avatar: player.account };
      if (challenger) {
        // Answered in the panel: the row leads there.
        return { ...base, subtitle: "Challenging you", selected: true, enabled: true, onActivate: () => this.#focusAnswer() };
      }
      return {
        ...base,
        subtitle: challenged ? `${modeName(outgoing.mode)} challenge sent · waiting for an answer` : (ACTIVITY_TEXT[/** @type {keyof typeof ACTIVITY_TEXT} */ (player.status)] ?? ""),
        selected: challenged,
        enabled: canChallenge && !challenged && player.status !== PlayerActivity.PLAYING,
        onActivate: () => this.openDialog({ kind: "challenge", account: player.account }),
      };
    });
    rows.forEach((row, index) => list.add(new OptionRow({ ...row, x: 0, y: index * (PLAYER_ROW.height + PLAYER_ROW.gap), width: list.rowWidth, height: PLAYER_ROW.height })));
    if (rows.length === 0) {
      const text = lobby.state.loaded ? "Nobody else is online right now. Find a match in the queue, or wait here: players appear as they arrive." : "Looking for players online…";
      list.add(new TextBlock({ id: "online.players.empty", x: 0, y: 0, width: list.rowWidth, height: 4 * 26, text, size: "small", colorKey: "textMuted" }));
      list.contentHeight = 4 * 26;
      return;
    }
    list.contentHeight = rows.length * (PLAYER_ROW.height + PLAYER_ROW.gap) - PLAYER_ROW.gap;
    list.scrollTo(this.#scroll[PLAYERS_ID] ?? 0);
  }

  /** The right column: the lobby's panel. @returns {Button | null} the big button */
  #buildGameColumn() {
    const screen = this.screen;
    const column = this.#columns.game;
    const height = screen.columns.height;
    const panel = this.root.add(new Panel({ ...screen.panel, x: column.x, y: screen.columns.top, width: column.width, height, glowKey: this.panelGlow }));
    return this.buildGame(panel, { width: column.width - 2 * screen.inset, height });
  }

  /** The error to show: the game's, else the lobby's; null when none. */
  #error() {
    return this.online().state.error ?? this.#app.lobby?.state.error ?? null;
  }

  /**
   * The status and the error, if any: under the status on a wide screen; on a phone right above the button, the
   * status taking what is left above it.
   * @param {Panel} panel
   * @param {number} width
   * @param {{ top: number, bottom: number, error: { message: string } | null }} room
   */
  #buildStatus(panel, width, { top, bottom, error }) {
    const inset = this.screen.inset;
    const { statusSize, note } = this.metrics;
    const errorHeight = note ? 2 * 28 : 2 * 22;
    const errorY = note ? top + 120 : bottom - errorHeight;
    const statusBottom = error === null ? bottom : errorY;
    panel.add(new TextBlock({ id: "online.status", x: inset, y: top, width, height: note ? 4 * 28 : Math.max(0, statusBottom - top), text: this.#statusText(), size: statusSize, colorKey: "text" }));
    if (error !== null) {
      panel.add(new TextBlock({ id: "online.error", x: inset, y: errorY, width, height: errorHeight, text: error.message, size: "small", colorKey: "danger" }));
    }
  }

  #statusText() {
    const state = this.online().state;
    const waiting = this.#waitingChallenge();
    if (waiting !== null) {
      return `Waiting for @${waiting.to} to accept your ${modeName(waiting.mode).toLowerCase()} challenge. They have a minute to answer.`;
    }
    const notice = this.lobbyNotice();
    if (notice !== null) {
      return notice;
    }
    if (state.status === OnlineStatus.IDLE) {
      return this.idleText();
    }
    return STATUS_TEXT[/** @type {keyof typeof STATUS_TEXT} */ (state.status)]?.(state) ?? "";
  }

  /** The challenge the player has out, while they wait for an answer (not once a game is on). */
  #waitingChallenge() {
    const outgoing = this.#app.lobby?.state.outgoing ?? null;
    return outgoing !== null && this.free() ? outgoing : null;
  }

  /**
   * Find a match in the lobby's mode, with what it takes.
   * @returns {MainAction}
   */
  #findAction() {
    const online = this.online();
    const status = online.state.status;
    const canQueue = status === OnlineStatus.IDLE || status === OnlineStatus.OVER || status === OnlineStatus.CANCELLED;
    return {
      id: "online.find",
      text: this.findText(),
      variant: "primary",
      enabled: canQueue && this.mayQueue() && this.#selectedId !== null,
      onActivate: () => {
        online.dismissGame();
        this.#app.lobby?.clearError();
        online.queue(/** @type {string} */ (this.#selectedId), this.queueMode);
      },
    };
  }

  /**
   * Shows the open dialog again after a rebuild, or forgets it when it no longer applies
   * (the player left, the challenge closed).
   * @param {string} focusedId
   */
  #reopenDialog(focusedId) {
    const modal = this.#dialog === null ? null : this.#dialogModal(this.#dialog);
    if (modal === null) {
      this.#dialog = null;
      return;
    }
    this.openModal(modal);
    const focused = modal.findById(focusedId);
    if (focused !== null && focused.focusable) {
      this.focus(focused);
    }
  }

  /**
   * @param {Dialog} dialog
   * @returns {Modal | null}
   */
  #dialogModal(dialog) {
    const lobby = this.#app.lobby;
    if (dialog.kind === "challenge" && "account" in dialog) {
      const player = lobby?.state.players.find((candidate) => candidate.account === dialog.account);
      return player === undefined || player.status === PlayerActivity.PLAYING || !this.free() ? null : this.#challengeModal(player.account);
    }
    return this.ownDialog(dialog);
  }

  /**
   * Proposes a game of the lobby's mode to a player, with the selected deck.
   * @param {string} account
   */
  #challengeModal(account) {
    const deck = this.selectedDeck();
    const mode = this.queueMode;
    const message = deck === null ? "Choose one of your playable decks first: it is the deck you will play with." : `You play with “${deck.name}”. @${account} has a minute to accept, with a deck of their own.`;
    const terms = this.challengeTerms(deck);
    const send = () => {
      this.#dialog = null;
      void this.#app.lobby?.challenge(account, mode, /** @type {{ id: string }} */ (deck).id);
      this.rebuild();
    };
    return this.dialogFrame({
      account,
      title: `Challenge @${account} to a ${modeName(mode).toLowerCase()} game`,
      message: `${message}${terms.note}`,
      buttons: [
        { id: "challenge.close", text: "Cancel", variant: "secondary", enabled: true, onActivate: () => this.closeDialog() },
        ...(terms.extra === undefined ? [] : [terms.extra]),
        { id: "challenge.send", text: terms.send, variant: "primary", enabled: deck !== null && terms.enabled, onActivate: send },
      ],
    });
  }

  /**
   * A challenge received, where the status would be: the challenger's portrait and name, the time left to answer, the
   * deck the player would play with (and what the game takes); then Decline and Accept (with the selected deck) in
   * place of the big button. What accepting needs and the player lacks (ranked tickets) takes Accept's place.
   * @param {Panel} panel
   * @param {import("../../../application/lobby/LobbyService.js").Challenge} challenge
   * @param {{ width: number, top: number, buttonY: number, error: { message: string } | null }} room
   * @returns {Button} Accept, or what takes its place
   */
  #buildAnswer(panel, challenge, { width, top, buttonY, error }) {
    const { inset, compact } = this.screen;
    const sizes = compact ? ANSWER.compact : ANSWER.wide;
    const lobby = /** @type {import("../../../application/lobby/LobbyService.js").LobbyService} */ (this.#app.lobby);
    panel.add(new AvatarNode({ id: "online.answer.avatar", x: inset, y: top, size: sizes.avatar, account: challenge.from }));
    const textX = inset + sizes.avatar + (compact ? 8 : 16);
    const textWidth = inset + width - textX;
    panel.add(new Label({ id: "online.answer.title", x: textX, y: top, width: textWidth, height: sizes.title, text: `@${challenge.from} challenges you`, size: sizes.titleSize, weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    panel.add(new Label({ id: ANSWER_TIME_ID, x: textX, y: top + sizes.title, width: textWidth, height: sizes.line, text: answerTimeText(challenge.mode, lobby.secondsLeft(challenge), { short: compact }), size: sizes.lineSize, colorKey: "accent", align: "left", fit: true }));
    const deck = this.selectedDeck();
    const terms = this.challengeTerms(deck);
    const others = this.#incoming().length - 1;
    const deckLine = deck === null ? "Choose one of your playable decks on the left to accept." : `You play with “${deck.name}” (or choose another on the left). The game starts as soon as you accept.`;
    const more = others > 0 ? ` ${moreChallenges(others)} after this one.` : "";
    const wordsY = top + Math.max(sizes.avatar, sizes.title + sizes.line) + sizes.gap;
    const errorHeight = error === null ? 0 : 2 * sizes.errorLine + 4;
    const wordsBottom = buttonY - 6 - errorHeight;
    panel.add(new TextBlock({ id: "online.answer.message", x: inset, y: wordsY, width, height: Math.max(0, wordsBottom - wordsY), text: `${deckLine}${terms.note}${more}`, size: "small", colorKey: "text" }));
    if (error !== null) {
      panel.add(new TextBlock({ id: "online.error", x: inset, y: wordsBottom, width, height: errorHeight - 4, text: error.message, size: "small", colorKey: "danger" }));
    }
    const { button, row } = this.metrics;
    const declineWidth = Math.round((width - row.gap) * (1 - sizes.acceptShare));
    panel.add(new Button({ id: "online.answer.decline", x: inset, y: buttonY, width: declineWidth, height: button, text: "Decline", variant: "secondary", keepPlate: true, onActivate: () => void lobby.decline(challenge.id) }));
    /** @type {MainAction} */
    const accept = {
      id: "online.answer.accept",
      text: "Accept",
      variant: "primary",
      enabled: deck !== null && terms.enabled,
      onActivate: () => {
        this.online().dismissGame();
        void lobby.accept(challenge.id, /** @type {{ id: string }} */ (deck).id);
      },
    };
    // A ranked challenge the player cannot pay for: getting tickets first, where Accept would be.
    const action = !terms.enabled && terms.extra !== undefined ? { ...terms.extra, variant: /** @type {const} */ ("primary") } : accept;
    return panel.add(new Button({ keepPlate: true, ...action, x: inset + declineWidth + row.gap, y: buttonY, width: width - declineWidth - row.gap, height: button }));
  }

  /** A click on a player challenging this one: their challenge's answer, in the panel. */
  #focusAnswer() {
    const accept = this.findNode("online.answer.accept") ?? this.findNode("online.answer.decline");
    if (accept !== null) {
      this.focus(accept);
    }
  }

  #rememberScroll() {
    for (const id of [LIST_ID, PLAYERS_ID]) {
      const list = this.root.findById(id);
      if (list instanceof ScrollList) {
        this.#scroll[id] = list.scrollY;
      }
    }
  }
}

/**
 * How the player's decks name an online deck (SelectedDeck): its id in the account's repository.
 * @param {import("../../../application/online/OnlineService.js").OnlineDeck} deck
 */
export function deckKey(deck) {
  return deck.localId ?? deck.id;
}

/**
 * "1 more challenge", "2 more challenges".
 * @param {number} count
 */
function moreChallenges(count) {
  return `${count} more challenge${count === 1 ? "" : "s"}`;
}
