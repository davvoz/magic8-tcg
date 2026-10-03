/**
 * The online lobby: pick one of your account decks, then either find an
 * opponent in the queue (casual, or ranked once the server says you may)
 * or challenge one of the players online — and go to the match when the
 * server starts the game. A game already running (after a reload or a
 * dropped connection) is offered for resuming. Your ranked standing and
 * the leaderboard come from the server.
 *
 * The middle column lists who else is online, with their profile picture
 * and what they are doing; the challenges you received come first. A click
 * on a player proposes a casual or ranked game with the selected deck; a
 * click on a challenge accepts it (with the selected deck) or declines it.
 * The list is read again every few seconds while the lobby is shown.
 *
 * Once matched (protocol v2), the game waits until both players accept it
 * with Keychain: the lobby says who has. If either does not, the game is
 * cancelled, the lobby says who did not accept, and a new search can start.
 *
 * When the season charges an entry fee, the lobby says how many ranked
 * entries the player holds and that every entry goes into the jackpot; a
 * player without enough is offered to get them (the shop's Ranked shelf:
 * many entries, one payment) instead of a search that would be refused.
 */
import { entriesText } from "../../application/entries/EntryService.js";
import { ChallengeMode, PlayerActivity } from "../../application/lobby/LobbyService.js";
import { OnlineStatus } from "../../application/online/OnlineService.js";
import { ShopCategory } from "../../application/shop/shopCatalog.js";
import { deckSummary, mixBands } from "../cards/deckStripe.js";
import { AvatarNode } from "../ui/AvatarNode.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const LIST_ID = "online.decks";
const PLAYERS_ID = "online.players";
/**
 * Sizes of the lobby, wide and compact (a phone in landscape: the three columns share its width).
 * @typedef {Readonly<{ button: number, mode: { y: number, height: number, gap: number }, playerRow: { height: number, gap: number }, titleY: number, listTop: number, statusSize: "body" | "small", note: boolean, title: number }>} LobbyMetrics
 *   `note`: the paragraph on how games are kept fair; `title`: the width of the screen's title
 */
/** @type {LobbyMetrics} */
const WIDE = Object.freeze({ button: 60, mode: Object.freeze({ y: 64, height: 48, gap: 12 }), playerRow: Object.freeze({ height: 64, gap: 8 }), titleY: 14, listTop: 60, statusSize: "body", note: true, title: 400 });
/** @type {LobbyMetrics} */
const COMPACT = Object.freeze({ button: 46, mode: Object.freeze({ y: 50, height: 46, gap: 8 }), playerRow: Object.freeze({ height: 52, gap: 6 }), titleY: 8, listTop: 50, statusSize: "small", note: false, title: 200 });
/** The three columns: your decks, the players online, the game. */
const LAYOUT = Object.freeze({
  decks: Object.freeze({ x: 60, width: 440 }),
  players: Object.freeze({ x: 520, width: 500 }),
  game: Object.freeze({ x: 1040, width: 500 }),
});
/** On a compact screen: the columns' share of the width (decks, players, game) and the gap between them. */
const COMPACT_COLUMNS = Object.freeze({ shares: Object.freeze([0.32, 0.34, 0.34]), gap: 8 });
const DIALOG = Object.freeze({ width: 680, height: 320, avatar: 72, buttonHeight: 52, gap: 14 });
export const QueueMode = Object.freeze({ CASUAL: "casual", RANKED: "ranked" });
/** @typedef {typeof QueueMode[keyof typeof QueueMode]} Mode */
/** @typedef {{ kind: "challenge", account: string } | { kind: "answer", challengeId: string }} Dialog */

/** What the lobby says in each state. */
const STATUS_TEXT = Object.freeze({
  [OnlineStatus.OFFLINE]: () => "Not connected to the game server. Reconnecting…",
  [OnlineStatus.CONNECTING]: () => "Connecting to the game server…",
  [OnlineStatus.IDLE]: () => "Choose a deck, then find an opponent or challenge a player online. The first player is drawn by lot.",
  [OnlineStatus.SEARCHING]: () => "Looking for an opponent…",
  [OnlineStatus.MATCHED]: (state) => matchedText(state),
  [OnlineStatus.PLAYING]: (state) => `Your game against @${state.opponent ?? "?"} is in progress.`,
  [OnlineStatus.OVER]: () => "The game is over.",
  [OnlineStatus.CANCELLED]: () => "The game was cancelled before it started.",
});

/** What a player online is doing, as their row says it. */
const ACTIVITY_TEXT = Object.freeze({
  [PlayerActivity.IDLE]: "Ready to play · click to challenge",
  [PlayerActivity.SEARCHING]: "Looking for a match · click to challenge",
  [PlayerActivity.PLAYING]: "In a game",
});

export class OnlineScene extends Scene {
  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return screenLayout(this.services.viewport);
  }

  /** @returns {LobbyMetrics} */
  get #m() {
    return this.#screen.compact ? COMPACT : WIDE;
  }

  /** The three columns for the screen in use. */
  get #columns() {
    if (!this.#screen.compact) {
      return LAYOUT;
    }
    const { sideMargin } = this.#screen.header;
    const inner = this.services.viewport.logicalWidth - 2 * sideMargin - 2 * COMPACT_COLUMNS.gap;
    const [decks, players] = COMPACT_COLUMNS.shares.map((share) => Math.round(inner * share));
    const game = inner - decks - players;
    return {
      decks: { x: sideMargin, width: decks },
      players: { x: sideMargin + decks + COMPACT_COLUMNS.gap, width: players },
      game: { x: sideMargin + decks + players + 2 * COMPACT_COLUMNS.gap, width: game },
    };
  }

  relayout() {
    this.#rebuild();
  }

  #app;
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** @type {string | null} */
  #selectedId = null;
  /** @type {Mode} */
  #mode = QueueMode.CASUAL;
  /** The challenge dialog open, if any (rebuilt with the scene). @type {Dialog | null} */
  #dialog = null;
  /** Scroll offsets by list id, kept across rebuilds (the list of players refreshes every few seconds). @type {Record<string, number>} */
  #scroll = {};
  /** The online status last seen: a game created or called off changes the player's entries. @type {string | null} */
  #lastStatus = null;

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
    this.#unsubscribes.push(online.subscribe((state) => this.#onChange(state)));
    online.start();
    if (this.#app.ranking !== undefined) {
      this.#unsubscribes.push(this.#app.ranking.subscribe(() => this.#rebuild()));
      this.#app.ranking.refresh();
    }
    const entries = this.#app.entries;
    if (entries !== undefined) {
      this.#unsubscribes.push(entries.subscribe(() => this.#rebuild()));
      void entries.refresh();
    }
    this.#lastStatus = online.state.status;
    const lobby = this.#app.lobby;
    if (lobby !== undefined) {
      this.#unsubscribes.push(lobby.subscribe(() => this.#rebuild()));
      lobby.start();
      this.#unsubscribes.push(lobby.watch());
    }
    this.#rebuild();
  }

  exit() {
    this.#unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#unsubscribes = [];
    this.#dialog = null;
    super.exit();
  }

  onCancel() {
    if (this.modal !== null) {
      super.onCancel();
      return;
    }
    this.#leave();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "online" });
    super.render(context);
  }

  /** @param {import("../../application/online/OnlineService.js").OnlineState} state */
  #onChange(state) {
    // A game found takes the entries it costs; a game called off gives them back.
    if (state.status !== this.#lastStatus && (state.status === OnlineStatus.MATCHED || state.status === OnlineStatus.CANCELLED)) {
      void this.#app.entries?.refresh();
    }
    this.#lastStatus = state.status;
    // The match screen takes over as soon as the server has sent the first state of the game.
    if (state.status === OnlineStatus.PLAYING && state.session?.hasSnapshot && !state.session.isStopped) {
      this.services.navigate(SceneId.MATCH, { session: state.session, againScene: SceneId.ONLINE });
      return;
    }
    this.#rebuild();
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.#rememberScroll();
    if (this.modal !== null) {
      this.closeModal();
    }
    this.root.clear();
    const { viewport } = this.services;
    this.root.add(new Label({ x: this.#screen.header.sideMargin, y: this.#screen.header.y, width: this.#m.title, height: this.#screen.header.height, text: "Play online", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const back = this.root.add(new Button({ id: "online.back", x: viewport.logicalWidth - this.#screen.header.sideMargin - this.#screen.header.backWidth, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: this.#screen.backText, onActivate: () => this.#leave() }));
    if (this.#app.ranking !== undefined && this.services.hasScene(SceneId.LEADERBOARD)) {
      this.root.add(new Button({ id: "online.leaderboard", x: viewport.logicalWidth - this.#screen.header.sideMargin - 2 * this.#screen.header.backWidth - 16, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: "Leaderboard", onActivate: () => this.services.navigate(SceneId.LEADERBOARD) }));
    }
    if (this.services.hasScene(SceneId.LIVE_GAMES)) {
      this.root.add(new Button({ id: "online.watch", x: viewport.logicalWidth - this.#screen.header.sideMargin - 3 * this.#screen.header.backWidth - 32, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: "Watch", onActivate: () => this.services.navigate(SceneId.LIVE_GAMES) }));
    }
    const firstDeck = this.#buildDecks();
    this.#buildPlayers();
    const action = this.#buildActions();
    this.focus(this.root.findById(focusedId) ?? action ?? firstDeck ?? back);
    this.#reopenDialog(focusedId);
    this.services.requestRender();
  }

  /** @returns {Button | null} */
  #buildDecks() {
    const column = this.#columns.decks;
    const { titleY, listTop } = this.#m;
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: column.x, y: this.#screen.columns.top, width: column.width, height: this.#screen.columns.height }));
    const width = column.width - 2 * this.#screen.inset;
    panel.add(new Label({ x: this.#screen.inset, y: titleY, width, height: 36, text: "Your decks", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const list = panel.add(new ScrollList({ id: LIST_ID, x: this.#screen.inset, y: listTop, width, height: this.#screen.columns.height - listTop - this.#screen.inset }));
    const decks = this.#online().decks();
    if (!decks.some((deck) => deck.id === this.#selectedId && deck.playable)) {
      this.#selectedId = decks.find((deck) => deck.playable)?.id ?? null;
    }
    if (decks.length === 0) {
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 3 * this.#screen.row.height, text: "You have no decks in your account yet. Take your free starter deck, or build a deck in the Deck Builder.", size: "small", colorKey: "textMuted" }));
      list.contentHeight = 3 * this.#screen.row.height;
      return null;
    }
    /** @type {Button | null} */
    let first = null;
    decks.forEach((deck, index) => {
      const row = list.add(
        new OptionRow({
          id: `online.deck.${deck.id}`,
          x: 0,
          y: this.#screen.rowY(index),
          width: list.rowWidth,
          height: this.#screen.row.height,
          text: deck.name,
          subtitle: deck.playable ? deckSummary(deck.totalCards, deck.mix) : `not playable: ${deck.problem ?? "fix it in the Deck Builder"}`,
          enabled: deck.playable,
          selected: deck.id === this.#selectedId,
          stripe: mixBands(this.services.theme, deck.mix),
          onActivate: () => {
            this.#selectedId = deck.id;
            this.#rebuild();
          },
        }),
      );
      first ??= row;
    });
    list.contentHeight = this.#screen.rowsHeight(decks.length);
    list.scrollTo(this.#scroll[LIST_ID] ?? 0);
    return first;
  }

  /** The players online, the challenges received first. */
  #buildPlayers() {
    const column = this.#columns.players;
    const { titleY, listTop, playerRow: PLAYER_ROW } = this.#m;
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: column.x, y: this.#screen.columns.top, width: column.width, height: this.#screen.columns.height }));
    const width = column.width - 2 * this.#screen.inset;
    const lobby = this.#app.lobby;
    const players = lobby?.state.players ?? [];
    panel.add(new Label({ x: this.#screen.inset, y: titleY, width: width - 40, height: 36, text: this.#screen.compact ? "Online" : "Players online", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    if (lobby?.state.loaded) {
      panel.add(new Label({ id: "online.players.count", x: this.#screen.inset, y: titleY, width, height: 36, text: String(players.length), size: "body", weight: "bold", colorKey: "textMuted", align: "right" }));
    }
    const list = panel.add(new ScrollList({ id: PLAYERS_ID, x: this.#screen.inset, y: listTop, width, height: this.#screen.columns.height - listTop - this.#screen.inset }));
    if (lobby === undefined) {
      return;
    }
    const { incoming, outgoing } = lobby.state;
    const canChallenge = this.#free();
    /** @type {{ id: string, text: string, subtitle: string, avatar: string, selected: boolean, enabled: boolean, onActivate: () => void }[]} */
    const rows = [
      ...incoming.map((challenge) => ({
        id: `online.challenge.${challenge.id}`,
        text: `@${challenge.from} challenges you`,
        subtitle: `${modeName(challenge.mode)} game · click to answer`,
        avatar: challenge.from,
        selected: true,
        enabled: this.#online().state.status !== OnlineStatus.PLAYING,
        onActivate: () => this.#openDialog({ kind: "answer", challengeId: challenge.id }),
      })),
      ...players.map((player) => {
        const challenged = outgoing?.to === player.account;
        return {
          id: `online.player.${player.account}`,
          text: `@${player.account}`,
          subtitle: challenged ? `${modeName(outgoing.mode)} challenge sent · waiting for an answer` : (ACTIVITY_TEXT[/** @type {keyof typeof ACTIVITY_TEXT} */ (player.status)] ?? ""),
          avatar: player.account,
          selected: challenged,
          enabled: canChallenge && !challenged && player.status !== PlayerActivity.PLAYING,
          onActivate: () => this.#openDialog({ kind: "challenge", account: player.account }),
        };
      }),
    ];
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

  /** @returns {Button | null} the main action */
  #buildActions() {
    const state = this.#online().state;
    const column = this.#columns.game;
    const { titleY, button, statusSize, note } = this.#m;
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: column.x, y: this.#screen.columns.top, width: column.width, height: this.#screen.columns.height }));
    const width = column.width - 2 * this.#screen.inset;
    panel.add(new Label({ x: this.#screen.inset, y: titleY, width, height: 36, text: this.#mode === QueueMode.RANKED ? "Ranked game" : "Casual game", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const top = this.#buildModes(panel, width, state);
    const buttonY = this.#screen.columns.height - this.#screen.inset - button;
    const error = state.error ?? this.#app.lobby?.state.error ?? null;
    // On a phone the error sits right above the button, the status takes what is left above it.
    const errorY = note ? top + 120 : buttonY - 6 - 2 * 22;
    const statusBottom = error === null ? buttonY - 6 : errorY;
    const statusHeight = note ? 4 * 28 : Math.max(0, statusBottom - top);
    panel.add(new TextBlock({ id: "online.status", x: this.#screen.inset, y: top, width, height: statusHeight, text: this.#statusText(), size: statusSize, colorKey: "text" }));
    if (error !== null) {
      panel.add(new TextBlock({ id: "online.error", x: this.#screen.inset, y: errorY, width, height: note ? 2 * 28 : 2 * 22, text: error.message, size: "small", colorKey: "danger" }));
    }
    if (note) {
      panel.add(new TextBlock({ x: this.#screen.inset, y: top + 190, width, height: 5 * 26, text: "The server runs the game and checks every move. Both players add randomness to the shuffle after the server has committed to its own, and every move of the game is recorded.", size: "small", colorKey: "textMuted" }));
    }
    return panel.add(new Button({ ...this.#mainAction(), x: this.#screen.inset, y: buttonY, width, height: button }));
  }

  /** The challenge the player has out, while they wait for an answer (not once a game is on). */
  #waitingChallenge() {
    const outgoing = this.#app.lobby?.state.outgoing ?? null;
    return outgoing !== null && this.#free() ? outgoing : null;
  }

  #statusText() {
    const state = this.#online().state;
    const waiting = this.#waitingChallenge();
    if (waiting !== null) {
      return `Waiting for @${waiting.to} to accept your ${modeName(waiting.mode).toLowerCase()} challenge. They have a minute to answer.`;
    }
    return STATUS_TEXT[/** @type {keyof typeof STATUS_TEXT} */ (state.status)]?.(state) ?? "";
  }

  /**
   * The big button of the game column: stop searching, resume the game, withdraw the challenge, or find a match.
   * @returns {{ id: string, text: string, variant?: import("../ui/Button.js").ButtonVariant, enabled?: boolean, onActivate: () => void }}
   */
  #mainAction() {
    const online = this.#online();
    const state = online.state;
    if (state.status === OnlineStatus.SEARCHING) {
      return { id: "online.cancel", text: "Stop searching", onActivate: () => online.leaveQueue() };
    }
    if (state.status === OnlineStatus.PLAYING && state.session !== null) {
      return { id: "online.resume", text: "Resume your game", variant: "primary", onActivate: () => this.services.navigate(SceneId.MATCH, { session: online.resume(), againScene: SceneId.ONLINE }) };
    }
    if (this.#waitingChallenge() !== null) {
      return { id: "online.withdraw", text: "Withdraw challenge", onActivate: () => this.#app.lobby?.cancel() };
    }
    const canQueue = state.status === OnlineStatus.IDLE || state.status === OnlineStatus.OVER || state.status === OnlineStatus.CANCELLED;
    if (this.#mode === QueueMode.RANKED && !this.#hasEntries() && this.services.hasScene(SceneId.SHOP)) {
      return { id: "online.getEntries", text: "Get ranked entries", variant: "primary", onActivate: () => this.#getEntries() };
    }
    return {
      id: "online.find",
      text: "Find a match",
      variant: "primary",
      enabled: canQueue && this.#selectedId !== null,
      onActivate: () => {
        online.dismissGame();
        this.#app.lobby?.clearError();
        online.queue(/** @type {string} */ (this.#selectedId), this.#mode);
      },
    };
  }

  /**
   * The casual/ranked choice and the player's ranked standing; returns where the status text starts.
   * @param {Panel} panel
   * @param {number} width
   * @param {import("../../application/online/OnlineService.js").OnlineState} state
   */
  #buildModes(panel, width, state) {
    const ranking = this.#app.ranking;
    const MODE = this.#m.mode;
    if (ranking === undefined) {
      return MODE.y;
    }
    const eligible = this.#rankedAllowed();
    if (!eligible) {
      this.#mode = QueueMode.CASUAL;
    }
    const idle = state.status !== OnlineStatus.SEARCHING;
    const half = (width - MODE.gap) / 2;
    /**
     * @param {Mode} mode
     * @param {number} x
     * @param {string} text
     * @param {boolean} enabled
     */
    const choice = (mode, x, text, enabled) =>
      panel.add(new Button({ id: `online.mode.${mode}`, x, y: MODE.y, width: half, height: MODE.height, text, variant: this.#mode === mode ? "primary" : "secondary", enabled: enabled && idle, onActivate: () => this.#choose(mode) }));
    choice(QueueMode.CASUAL, this.#screen.inset, "Casual", true);
    choice(QueueMode.RANKED, this.#screen.inset + half + MODE.gap, "Ranked", eligible);
    const compact = this.#screen.compact;
    const line = compact ? 22 : 26;
    const standingY = MODE.y + MODE.height + (compact ? 4 : 10);
    panel.add(new TextBlock({ id: "online.standing", x: this.#screen.inset, y: standingY, width, height: 2 * line, text: standingText(ranking.state), size: "small", colorKey: "textMuted" }));
    const entries = eligible ? entriesText(this.#app.entries?.ranked ?? null) : null;
    if (entries === null) {
      return MODE.y + MODE.height + (compact ? 52 : 70);
    }
    panel.add(new TextBlock({ id: "online.entries", x: this.#screen.inset, y: standingY + 2 * line, width, height: 2 * line, text: entries, size: "small", colorKey: this.#hasEntries() ? "accent" : "danger" }));
    return MODE.y + MODE.height + (compact ? 52 + 2 * line : 70 + 2 * line);
  }

  /**
   * Opens a challenge dialog (and keeps it open across rebuilds while it still applies).
   * @param {Dialog} dialog
   */
  #openDialog(dialog) {
    this.#dialog = dialog;
    this.#app.lobby?.clearError();
    this.#rebuild();
  }

  #closeDialog() {
    this.#dialog = null;
    this.#rebuild();
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
    if (lobby === undefined) {
      return null;
    }
    if (dialog.kind === "answer") {
      const challenge = lobby.state.incoming.find((open) => open.id === dialog.challengeId);
      return challenge === undefined ? null : this.#answerModal(challenge);
    }
    const player = lobby.state.players.find((candidate) => candidate.account === dialog.account);
    return player === undefined || player.status === PlayerActivity.PLAYING || !this.#free() ? null : this.#challengeModal(player.account);
  }

  /**
   * Proposes a casual or ranked game to a player, with the selected deck.
   * @param {string} account
   */
  #challengeModal(account) {
    const deck = this.#selectedDeck();
    const message = deck === null ? "Choose one of your playable decks first: it is the deck you will play with." : `You play with “${deck.name}”. @${account} has a minute to accept, with a deck of their own.`;
    const ranked = this.#rankedAllowed() ? this.#entriesNote() : " Ranked opens once you have played enough casual games.";
    const send = (/** @type {string} */ mode) => {
      this.#dialog = null;
      void this.#app.lobby?.challenge(account, mode, /** @type {{ id: string }} */ (deck).id);
      this.#rebuild();
    };
    return this.#dialogFrame({
      account,
      title: `Challenge @${account}`,
      message: message + ranked,
      buttons: [
        { id: "challenge.close", text: "Cancel", variant: "secondary", enabled: true, onActivate: () => this.#closeDialog() },
        { id: "challenge.casual", text: "Casual game", variant: "primary", enabled: deck !== null, onActivate: () => send(ChallengeMode.CASUAL) },
        { id: "challenge.ranked", text: "Ranked game", variant: "primary", enabled: deck !== null && this.#rankedAllowed() && this.#hasEntries(), onActivate: () => send(ChallengeMode.RANKED) },
      ],
    });
  }

  /**
   * Accepts (with the selected deck) or declines a challenge received.
   * @param {import("../../application/lobby/LobbyService.js").Challenge} challenge
   */
  #answerModal(challenge) {
    const deck = this.#selectedDeck();
    const game = `A ${modeName(challenge.mode).toLowerCase()} game.`;
    const payable = challenge.mode !== ChallengeMode.RANKED || this.#hasEntries();
    const accepting = deck === null ? `${game} Choose one of your playable decks to accept it.` : `${game} You play with “${deck.name}”; the game starts as soon as you accept.`;
    const message = payable ? accepting : `${game} It takes a ranked entry you do not have: get ranked entries in the shop to accept it.`;
    const lobby = /** @type {import("../../application/lobby/LobbyService.js").LobbyService} */ (this.#app.lobby);
    return this.#dialogFrame({
      account: challenge.from,
      title: `@${challenge.from} challenges you`,
      message,
      buttons: [
        { id: "challenge.close", text: "Not now", variant: "secondary", enabled: true, onActivate: () => this.#closeDialog() },
        {
          id: "challenge.decline",
          text: "Decline",
          variant: "danger",
          enabled: true,
          onActivate: () => {
            this.#dialog = null;
            void lobby.decline(challenge.id);
          },
        },
        {
          id: "challenge.accept",
          text: "Accept",
          variant: "primary",
          enabled: deck !== null && this.#free() && payable,
          onActivate: () => {
            this.#dialog = null;
            this.#online().dismissGame();
            void lobby.accept(challenge.id, /** @type {{ id: string }} */ (deck).id);
            this.#rebuild();
          },
        },
      ],
    });
  }

  /**
   * A challenge dialog: the other player's portrait, a title, a message and a row of buttons.
   * @param {{ account: string, title: string, message: string, buttons: readonly { id: string, text: string, variant: import("../ui/Button.js").ButtonVariant, enabled: boolean, onActivate: () => void }[] }} content
   */
  #dialogFrame({ account, title, message, buttons }) {
    const { viewport } = this.services;
    const modal = new Modal({ id: "challenge", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: DIALOG.width, panelHeight: DIALOG.height, onDismiss: () => this.#closeDialog() });
    const { panel } = modal;
    const inner = DIALOG.width - 2 * this.#screen.inset;
    panel.add(new AvatarNode({ x: this.#screen.inset, y: this.#screen.inset, size: DIALOG.avatar, account }));
    const textX = this.#screen.inset + DIALOG.avatar + 20;
    const textWidth = DIALOG.width - this.#screen.inset - textX;
    panel.add(new Label({ id: "challenge.title", x: textX, y: this.#screen.inset + 4, width: textWidth, height: 40, text: title, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    panel.add(new TextBlock({ id: "challenge.message", x: textX, y: this.#screen.inset + 52, width: textWidth, height: 4 * 26, text: message, size: "small", colorKey: "textMuted" }));
    const buttonWidth = (inner - (buttons.length - 1) * DIALOG.gap) / buttons.length;
    const y = DIALOG.height - this.#screen.inset - DIALOG.buttonHeight;
    buttons.forEach((button, index) => panel.add(new Button({ ...button, x: this.#screen.inset + index * (buttonWidth + DIALOG.gap), y, width: buttonWidth, height: DIALOG.buttonHeight })));
    return modal;
  }

  /** Whether the player may challenge or accept now: not in a game, and none starting. */
  #free() {
    const status = this.#online().state.status;
    return status !== OnlineStatus.MATCHED && status !== OnlineStatus.PLAYING && status !== OnlineStatus.OFFLINE && status !== OnlineStatus.CONNECTING;
  }

  #rankedAllowed() {
    return this.#app.ranking?.state.standing?.eligible === true;
  }

  /** Whether the player holds what a ranked game costs (true when it is free, or not known: the server decides). */
  #hasEntries() {
    return this.#app.entries?.canPlayRanked ?? true;
  }

  /** What the challenge dialog adds about entries, when ranked play costs some and the player has none. */
  #entriesNote() {
    return this.#hasEntries() ? "" : " A ranked game takes a ranked entry: you have none.";
  }

  /** The shop's Ranked shelf: many entries, one payment; Back comes here. */
  #getEntries() {
    this.services.navigate(SceneId.SHOP, { category: ShopCategory.RANKED, from: SceneId.ONLINE });
  }

  #selectedDeck() {
    return this.#online().decks().find((deck) => deck.id === this.#selectedId && deck.playable) ?? null;
  }

  /** @param {Mode} mode */
  #choose(mode) {
    this.#mode = mode;
    this.#rebuild();
  }

  #rememberScroll() {
    for (const id of [LIST_ID, PLAYERS_ID]) {
      const list = this.root.findById(id);
      if (list instanceof ScrollList) {
        this.#scroll[id] = list.scrollY;
      }
    }
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

/** @param {string} mode */
function modeName(mode) {
  return mode === ChallengeMode.RANKED ? "Ranked" : "Casual";
}

/**
 * The lobby once an opponent is found: in v2, who has accepted the game with
 * Keychain so far (it starts only when both have); in v1, the shuffle.
 * @param {import("../../application/online/OnlineService.js").OnlineState} state
 */
export function matchedText(state) {
  const opponent = `@${state.opponent ?? "?"}`;
  const acceptance = state.acceptance;
  if (acceptance === null) {
    return `Opponent found: ${opponent}. Shuffling with both players' randomness…`;
  }
  const you = acceptance.you ? "you have accepted" : "accept it in Keychain";
  const them = acceptance.opponent ? `${opponent} has accepted` : `waiting for ${opponent}`;
  return `Opponent found: ${opponent}. The game starts once both of you sign it with Keychain: ${you}, ${them}.`;
}

/**
 * One line about the player's ranked standing.
 * @param {import("../../application/ranking/RankingService.js").RankingState} state
 */
export function standingText(state) {
  const standing = state.standing;
  if (standing === null) {
    return state.error === null ? "Loading your ranked standing…" : `Ranked standing unavailable: ${state.error}`;
  }
  if (standing.season === null) {
    return "No ranked season is running.";
  }
  if (!standing.eligible) {
    return `Ranked opens after ${standing.casualGamesNeeded} more casual game(s).`;
  }
  const draws = standing.draws > 0 ? `–${standing.draws}` : "";
  const record = `${standing.wins}–${standing.losses}${draws}`;
  const place = standing.provisional ? "provisional" : `#${standing.rank}`;
  return `${standing.season.name}: rating ${standing.rating} (${place}), ${record} in ${standing.games} game(s).`;
}
