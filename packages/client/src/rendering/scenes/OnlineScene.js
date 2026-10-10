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
 * The entries are drawn as a stack of old tickets with a seal saying how
 * many the player holds (a faded outline when none).
 *
 * The third mode, Auto (docs/tcg/23-automatica.md), needs nobody online:
 * the player chooses a deck and an AI style and joins the auto list, paying
 * a ranked entry; the AI plays their deck against the next player who
 * joins, even hours later, and the result arrives as a notification. Once
 * in, the player stays in: the lobby says since when and offers no way out,
 * and the dialog before joining says so.
 */
import { AUTO_STYLES, AutoListStatus, AutoStyle } from "../../application/auto/AutoListService.js";
import { entriesNoteText, entriesText, rankedFeeText } from "../../application/entries/EntryService.js";
import { ChallengeMode, PlayerActivity } from "../../application/lobby/LobbyService.js";
import { OnlineStatus } from "../../application/online/OnlineService.js";
import { ShopStatus } from "../../application/shop/ShopService.js";
import { ShopCategory, rankedEntryPrice } from "../../application/shop/shopCatalog.js";
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
import { EntryTickets } from "./entries/EntryTickets.js";
import { timeAgo } from "./NotificationsScene.js";
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
/** Between the ranked tickets and what they say. */
const TICKETS_GAP = 14;
const DIALOG = Object.freeze({ width: 680, height: 320, avatar: 72, buttonHeight: 52, gap: 14 });
export const QueueMode = Object.freeze({ CASUAL: "casual", RANKED: "ranked", AUTO: "auto" });
/** @typedef {typeof QueueMode[keyof typeof QueueMode]} Mode */
/** @typedef {{ kind: "challenge", account: string } | { kind: "answer", challengeId: string } | { kind: "auto" }} Dialog */

/** The AI styles, as the lobby names and explains them. */
export const STYLE_TEXT = Object.freeze({
  [AutoStyle.AGGRESSIVE]: Object.freeze({ name: "Aggressive", hint: "Attacks often, goes for the face once the opponent is low, keeps its creatures for attacking." }),
  [AutoStyle.BALANCED]: Object.freeze({ name: "Balanced", hint: "Attacks when it is safe, trades evenly, blocks to stay alive." }),
  [AutoStyle.DEFENSIVE]: Object.freeze({ name: "Defensive", hint: "Attacks only when nothing can stop it, blocks often and gives up creatures to protect its life." }),
});

/** What the lobby says in each state. */
const STATUS_TEXT = Object.freeze({
  [OnlineStatus.OFFLINE]: () => "Not connected to the game server. Reconnecting…",
  [OnlineStatus.CONNECTING]: () => "Connecting to the game server…",
  [OnlineStatus.IDLE]: () => "Choose a deck, then find an opponent or challenge a player online. The first player is drawn by lot.",
  [OnlineStatus.SEARCHING]: (state) => state.notice ?? "Looking for an opponent…",
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
  /** The AI style chosen for the auto list. @type {string} */
  #style = AutoStyle.BALANCED;
  /** The auto list's status last seen: joining took an entry, a ticket that closed gave it back. @type {string | null} */
  #lastAutoStatus = null;
  #now;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {() => number} [now]
   */
  constructor(services, app, now = () => Date.now()) {
    super(services);
    this.#app = app;
    this.#now = now;
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
    // The shop's listing says what an entry costs, so the lobby shows the price of a ranked game in STEEM.
    const shop = this.#app.shop;
    if (shop !== undefined) {
      this.#unsubscribes.push(shop.subscribe(() => this.#rebuild()));
      if (shop.state.listing === null && shop.state.status !== ShopStatus.LOADING) {
        void shop.load();
      }
    }
    this.#lastStatus = online.state.status;
    const lobby = this.#app.lobby;
    if (lobby !== undefined) {
      this.#unsubscribes.push(lobby.subscribe(() => this.#rebuild()));
      lobby.start();
      this.#unsubscribes.push(lobby.watch());
    }
    const autoList = this.#app.autoList;
    if (autoList !== undefined) {
      this.#lastAutoStatus = autoList.state.status;
      this.#unsubscribes.push(autoList.subscribe((state) => this.#onAutoChange(state)));
      autoList.start();
      void autoList.refresh();
    }
    this.#rebuild();
  }

  /** @param {import("../../application/auto/AutoListService.js").AutoListState} state */
  #onAutoChange(state) {
    // Joining took a ranked entry; a ticket that closed without a game gave it back.
    if (state.status !== this.#lastAutoStatus && (state.status === AutoListStatus.WAITING || state.closed !== null)) {
      void this.#app.entries?.refresh();
    }
    this.#lastAutoStatus = state.status;
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
    const back = this.root.add(new Button({ keepPlate: true, id: "online.back", x: viewport.logicalWidth - this.#screen.header.sideMargin - this.#screen.header.backWidth, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: this.#screen.backText, onActivate: () => this.#leave() }));
    if (this.#app.ranking !== undefined && this.services.hasScene(SceneId.LEADERBOARD)) {
      this.root.add(new Button({ keepPlate: true, id: "online.leaderboard", x: viewport.logicalWidth - this.#screen.header.sideMargin - 2 * this.#screen.header.backWidth - 16, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: "Leaderboard", onActivate: () => this.services.navigate(SceneId.LEADERBOARD) }));
    }
    if (this.services.hasScene(SceneId.LIVE_GAMES)) {
      this.root.add(new Button({ keepPlate: true, id: "online.watch", x: viewport.logicalWidth - this.#screen.header.sideMargin - 3 * this.#screen.header.backWidth - 32, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: "Watch", onActivate: () => this.services.navigate(SceneId.LIVE_GAMES) }));
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
    panel.add(new Label({ x: this.#screen.inset, y: titleY, width, height: 36, text: MODE_TITLE[this.#mode], size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const top = this.#buildModes(panel, width, state);
    if (this.#mode === QueueMode.AUTO) {
      return this.#buildAuto(panel, width, top);
    }
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
    return panel.add(new Button({ keepPlate: true, ...this.#mainAction(), x: this.#screen.inset, y: buttonY, width, height: button }));
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
      text: this.#mode === QueueMode.RANKED ? withFee("Find a match", this.#rankedFee()) : "Find a match",
      variant: "primary",
      enabled: canQueue && this.#selectedId !== null,
      onActivate: () => {
        online.dismissGame();
        this.#app.lobby?.clearError();
        online.queue(/** @type {string} */ (this.#selectedId), /** @type {"casual" | "ranked"} the auto list has its own button */ (this.#mode));
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
    const compact = this.#screen.compact;
    const modes = this.#app.autoList === undefined ? 2 : 3;
    const size = (width - (modes - 1) * MODE.gap) / modes;
    /**
     * @param {Mode} mode
     * @param {number} index
     * @param {string} text
     * @param {boolean} enabled
     */
    const choice = (mode, index, text, enabled) =>
      panel.add(
        new Button({
          id: `online.mode.${mode}`,
          x: this.#screen.inset + index * (size + MODE.gap),
          y: MODE.y,
          width: size,
          height: MODE.height,
          text,
          textSize: modes === 3 ? "small" : "body",
          variant: this.#mode === mode ? "primary" : "secondary",
          enabled: enabled && idle,
          onActivate: () => this.#choose(mode),
        }),
      );
    choice(QueueMode.CASUAL, 0, "Casual", true);
    // Three in a row on a phone leave no room for the price: the main button says it.
    choice(QueueMode.RANKED, 1, compact && modes === 3 ? "Ranked" : withFee("Ranked", this.#rankedFee()), eligible);
    if (modes === 3) {
      choice(QueueMode.AUTO, 2, "Auto", eligible);
    }
    const line = compact ? 22 : 26;
    const standingY = MODE.y + MODE.height + (compact ? 4 : 10);
    panel.add(new TextBlock({ id: "online.standing", x: this.#screen.inset, y: standingY, width, height: 2 * line, text: standingText(ranking.state), size: "small", colorKey: "textMuted" }));
    return MODE.y + MODE.height + (compact ? 52 : 70) + this.#buildEntries(panel, width, standingY + 2 * line);
  }

  /**
   * The ranked tickets the player holds, then what they are for: three lines wide, two on a phone (where the tickets alone say how many).
   * @param {Panel} panel
   * @param {number} width
   * @param {number} y
   * @returns {number} the height they take (0 while ranked play is free, or not known yet)
   */
  #buildEntries(panel, width, y) {
    const compact = this.#screen.compact;
    const ranked = this.#app.entries?.ranked ?? null;
    const price = this.#entryPrice();
    const entries = compact ? entriesNoteText(ranked) : entriesText(ranked, price);
    if (entries === null || ranked === null) {
      return 0;
    }
    const height = compact ? 2 * 22 : 3 * 26;
    const ticketsWidth = EntryTickets.widthFor(height);
    panel.add(new EntryTickets({ id: "online.tickets", x: this.#screen.inset, y, width: ticketsWidth, height, count: ranked.balance, title: "Ranked", face: price === null ? null : `${price.amount} ${price.asset}`, seed: "lobby" }));
    const textX = this.#screen.inset + ticketsWidth + TICKETS_GAP;
    panel.add(new TextBlock({ id: "online.entries", x: textX, y, width: width - ticketsWidth - TICKETS_GAP, height, text: entries, size: "small", colorKey: this.#hasEntries() ? "accent" : "danger" }));
    return height;
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
    if (dialog.kind === "auto") {
      return this.#autoModal();
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
    const ranked = this.#rankedAllowed() ? this.#entriesNote() : " Ranked opens once you have played enough casual games, or enough practice games against the AI.";
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
        { id: "challenge.ranked", text: withFee("Ranked game", this.#rankedFee()), variant: "primary", enabled: deck !== null && this.#rankedAllowed() && this.#hasEntries(), onActivate: () => send(ChallengeMode.RANKED) },
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
   * Before joining the auto list: what will happen, what it costs, and that there is no way out.
   * @returns {Modal | null}
   */
  #autoModal() {
    const autoList = this.#app.autoList;
    const deck = this.#selectedDeck();
    if (autoList === undefined || deck === null || autoList.state.status !== AutoListStatus.IDLE) {
      return null;
    }
    const style = styleText(this.#style).name;
    const fee = this.#rankedFee() ?? "a ranked entry";
    const join = () => {
      this.#dialog = null;
      void autoList.join(deck.id, this.#style).then(() => this.#app.entries?.refresh());
      this.#rebuild();
    };
    return this.#dialogFrame({
      account: this.#app.account?.state.account ?? null,
      title: "Join the auto list",
      message: `The AI plays “${deck.name}” ${style.toLowerCase()} against the next player who joins, even hours from now. It costs ${fee}. Once you join you stay in the list until someone plays you.`,
      buttons: [
        { id: "auto.close", text: "Cancel", variant: "secondary", enabled: true, onActivate: () => this.#closeDialog() },
        { id: "auto.join", text: `Join · ${style}`, variant: "primary", enabled: true, onActivate: join },
      ],
    });
  }

  /**
   * The auto list in the game column: where the player's ticket stands, the style, and the button to join; returns the main action.
   * @param {Panel} panel
   * @param {number} width
   * @param {number} top where the status text starts
   */
  #buildAuto(panel, width, top) {
    const autoList = /** @type {import("../../application/auto/AutoListService.js").AutoListService} */ (this.#app.autoList);
    const auto = autoList.state;
    const { button, statusSize, mode: MODE } = this.#m;
    const compact = this.#screen.compact;
    const line = compact ? 22 : 26;
    const buttonY = this.#screen.columns.height - this.#screen.inset - button;
    const hintY = buttonY - 10 - 2 * line;
    const stylesY = hintY - 6 - MODE.height;
    const errorHeight = auto.error === null ? 0 : 2 * line;
    panel.add(new TextBlock({ id: "online.auto.status", x: this.#screen.inset, y: top, width, height: Math.max(0, stylesY - 8 - errorHeight - top), text: this.#autoStatusText(auto), size: statusSize, colorKey: "text" }));
    if (auto.error !== null) {
      panel.add(new TextBlock({ id: "online.error", x: this.#screen.inset, y: stylesY - 8 - errorHeight, width, height: errorHeight, text: auto.error.message, size: "small", colorKey: "danger" }));
    }
    const inList = auto.status === AutoListStatus.WAITING || auto.status === AutoListStatus.JOINING;
    // In the list, the style is the ticket's: frozen with it.
    const shown = inList && auto.ticket !== null ? auto.ticket.style : this.#style;
    const size = (width - 2 * MODE.gap) / 3;
    AUTO_STYLES.forEach((style, index) =>
      panel.add(
        new Button({
          id: `online.style.${style}`,
          x: this.#screen.inset + index * (size + MODE.gap),
          y: stylesY,
          width: size,
          height: MODE.height,
          text: styleText(style).name,
          textSize: "small",
          variant: style === shown ? "primary" : "secondary",
          enabled: !inList,
          onActivate: () => {
            this.#style = style;
            this.#rebuild();
          },
        }),
      ),
    );
    panel.add(new TextBlock({ id: "online.style.hint", x: this.#screen.inset, y: hintY, width, height: 2 * line, text: styleText(shown).hint, size: "small", colorKey: "textMuted" }));
    return panel.add(new Button({ keepPlate: true, ...this.#autoAction(auto), x: this.#screen.inset, y: buttonY, width, height: button }));
  }

  /**
   * The big button of the auto list: join it, get the entries it takes, or say the player is in.
   * @param {import("../../application/auto/AutoListService.js").AutoListState} auto
   * @returns {{ id: string, text: string, variant?: import("../ui/Button.js").ButtonVariant, enabled?: boolean, onActivate: () => void }}
   */
  #autoAction(auto) {
    const none = () => undefined;
    if (auto.status === AutoListStatus.WAITING) {
      return { id: "online.auto.waiting", text: "In the auto list · waiting for an opponent", enabled: false, onActivate: none };
    }
    if (auto.status === AutoListStatus.JOINING) {
      return { id: "online.auto.joining", text: "Joining the auto list…", enabled: false, onActivate: none };
    }
    if (!this.#hasEntries() && this.services.hasScene(SceneId.SHOP)) {
      return { id: "online.getEntries", text: "Get ranked entries", variant: "primary", onActivate: () => this.#getEntries() };
    }
    const connected = this.#online().state.status !== OnlineStatus.OFFLINE && this.#online().state.status !== OnlineStatus.CONNECTING;
    return {
      id: "online.auto.join",
      text: withFee("Join the auto list", this.#rankedFee()),
      variant: "primary",
      enabled: auto.status === AutoListStatus.IDLE && connected && this.#selectedDeck() !== null,
      onActivate: () => this.#openDialog({ kind: "auto" }),
    };
  }

  /**
   * What the auto list says: where the player's ticket stands, what became of the last one, how many wait.
   * @param {import("../../application/auto/AutoListService.js").AutoListState} auto
   */
  #autoStatusText(auto) {
    const count = auto.waiting === 1 ? "1 player is in the auto list." : `${auto.waiting} players are in the auto list.`;
    if (auto.status === AutoListStatus.JOINING) {
      return "Joining the auto list…";
    }
    if (auto.status === AutoListStatus.WAITING && auto.ticket !== null) {
      const deck = this.#online().decks().find((candidate) => candidate.id === auto.ticket?.deckId)?.name ?? "your deck";
      return `You joined ${timeAgo(auto.ticket.since, this.#now())} with “${deck}”, ${styleText(auto.ticket.style).name.toLowerCase()}. The AI plays it against the next player who joins: a notification will tell you the result. ${count}`;
    }
    const intro = "Choose a deck and a style: the AI plays it against the next player who joins, even hours from now. It counts for the season, at a fifth of a game played by hand.";
    return [lastTicketText(auto), intro, auto.waiting > 0 ? count : ""].filter((part) => part !== "").join(" ");
  }

  /**
   * A dialog: a player's portrait (none for nobody), a title, a message and a row of buttons.
   * @param {{ account: string | null, title: string, message: string, buttons: readonly { id: string, text: string, variant: import("../ui/Button.js").ButtonVariant, enabled: boolean, onActivate: () => void }[] }} content
   */
  #dialogFrame({ account, title, message, buttons }) {
    const { viewport } = this.services;
    const modal = new Modal({ id: "challenge", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: DIALOG.width, panelHeight: DIALOG.height, onDismiss: () => this.#closeDialog() });
    const { panel } = modal;
    const inner = DIALOG.width - 2 * this.#screen.inset;
    if (account !== null) {
      panel.add(new AvatarNode({ x: this.#screen.inset, y: this.#screen.inset, size: DIALOG.avatar, account }));
    }
    const textX = account === null ? this.#screen.inset : this.#screen.inset + DIALOG.avatar + 20;
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

  /** What one ranked entry costs in the shop, once its listing is read. */
  #entryPrice() {
    return rankedEntryPrice(this.#app.shop?.state.listing ?? null);
  }

  /** What a ranked game costs now ("1.000 STEEM"), or null when it is free or not known yet. */
  #rankedFee() {
    return rankedFeeText(this.#app.entries?.ranked ?? null, this.#entryPrice());
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

/**
 * "Ranked · 1.000 STEEM": a button that says what it costs, when it costs something.
 * @param {string} text
 * @param {string | null} fee
 */
function withFee(text, fee) {
  return fee === null ? text : `${text} · ${fee}`;
}

/** The title of the game column, by mode. */
const MODE_TITLE = Object.freeze({ [QueueMode.CASUAL]: "Casual game", [QueueMode.RANKED]: "Ranked game", [QueueMode.AUTO]: "Auto ranked" });

/** @param {string} style */
const styleText = (style) => STYLE_TEXT[/** @type {keyof typeof STYLE_TEXT} */ (style)] ?? STYLE_TEXT[AutoStyle.BALANCED];

/**
 * What became of the player's last auto ticket, when the lobby knows ("" otherwise).
 * @param {import("../../application/auto/AutoListService.js").AutoListState} auto
 */
function lastTicketText(auto) {
  if (auto.closed === "season_ended") {
    return "The season ended before an opponent came: your ranked entry is back.";
  }
  if (auto.closed === "failed") {
    return "Your last auto game could not be played: your ranked entry is back.";
  }
  return auto.lastGame === null ? "" : "Your auto game has been played: watch it from your notifications or your games.";
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
    const practice = standing.practiceGamesNeeded > 0 ? `, or ${standing.practiceGamesNeeded} more practice game(s) vs AI` : "";
    return `Ranked opens after ${standing.casualGamesNeeded} more casual game(s)${practice}.`;
  }
  const draws = standing.draws > 0 ? `–${standing.draws}` : "";
  const record = `${standing.wins}–${standing.losses}${draws}`;
  const place = standing.provisional ? "provisional" : `#${standing.rank}`;
  return `${standing.season.name}: rating ${standing.rating} (${place}), ${record} in ${standing.games} game(s).`;
}
