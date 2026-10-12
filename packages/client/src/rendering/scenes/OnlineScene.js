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
 * The game column has two tabs, Casual and Ranked, each opening its own
 * panel. Casual is plain: free, nothing at stake. Ranked is lit in gold: the
 * season and the player's rating (a crest), then how ranked play works as
 * three pictures — the ranked entries they hold, drawn as a stack of old
 * tickets with a seal saying how many; a game, which takes an entry; the
 * season's jackpot, which every entry feeds — then how many entries they
 * hold, and the two ways to play ranked: live, or the auto list. A player
 * without enough entries is offered to get them (the shop's Ranked shelf:
 * many entries, one payment) instead of a search that would be refused.
 * Ranked opens even before the player may play it: it says what is missing
 * and leads back to casual. On a phone the pictures open in a dialog ("?").
 *
 * The third mode, Auto (docs/tcg/23-automatica.md), needs nobody online:
 * the player chooses a deck and an AI style and joins the auto list, paying
 * a ranked entry; the AI plays their deck against the next player who
 * joins, even hours later, and the result arrives as a notification. Once
 * in, the player stays in: the lobby says since when and offers no way out,
 * and the dialog before joining says so.
 */
import { AUTO_STYLES, AutoListStatus, AutoStyle } from "../../application/auto/AutoListService.js";
import { entriesNoteText, heldEntriesText, rankedFeeText } from "../../application/entries/EntryService.js";
import { describeJackpot } from "../../application/jackpot/describeJackpot.js";
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
import { PlayKind } from "./online/lobbyIcons.js";
import { ModeTab } from "./online/ModeTab.js";
import { Perks } from "./online/Perks.js";
import { RankedGuide } from "./online/RankedGuide.js";
import { RatingCrest } from "./online/RatingCrest.js";
import { timeAgo } from "./NotificationsScene.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const LIST_ID = "online.decks";
const PLAYERS_ID = "online.players";
/**
 * Sizes of the lobby, wide and compact (a phone in landscape: the three columns share its width).
 * @typedef {Readonly<{ button: number, mode: { y: number, height: number, gap: number }, playerRow: { height: number, gap: number }, titleY: number, listTop: number, statusSize: "body" | "small", note: boolean, title: number, tab: number, tabGap: number }>} LobbyMetrics
 *   `mode`: the row of the ranked ways to play (and, without tabs, where the status starts); `note`: the paragraph on how games are kept fair;
 *   `title`: the width of the screen's title; `tab`: the height of the Casual and Ranked tabs, `tabGap` the space between them
 */
/** @type {LobbyMetrics} */
const WIDE = Object.freeze({ button: 60, mode: Object.freeze({ y: 64, height: 48, gap: 12 }), playerRow: Object.freeze({ height: 64, gap: 8 }), titleY: 14, listTop: 60, statusSize: "body", note: true, title: 400, tab: 64, tabGap: 10 });
/** @type {LobbyMetrics} */
const COMPACT = Object.freeze({ button: 46, mode: Object.freeze({ y: 50, height: 46, gap: 6 }), playerRow: Object.freeze({ height: 52, gap: 6 }), titleY: 8, listTop: 50, statusSize: "small", note: false, title: 200, tab: 46, tabGap: 6 });
/** The three columns: your decks, the players online, the game (its two tabs over its panel). */
const LAYOUT = Object.freeze({
  decks: Object.freeze({ x: 60, width: 400 }),
  players: Object.freeze({ x: 480, width: 400 }),
  game: Object.freeze({ x: 900, width: 640 }),
});
/** On a compact screen: the columns' share of the width (decks, players, game) and the gap between them. */
const COMPACT_COLUMNS = Object.freeze({ shares: Object.freeze([0.3, 0.31, 0.39]), gap: 8 });
/** The status and the error under it, on a wide screen: what a line at the foot of the panel must leave them. */
const STATUS_ROOM = 176;
/**
 * The ranked panel on a wide screen: the rating crest (top right, below the painted corner and in from it), where the standing and the guide sit, the row saying
 * how many entries the player holds (with its button to buy more), and the gap between those parts.
 */
const RANKED = Object.freeze({ crest: Object.freeze({ width: 62, height: 72, y: 24, inset: 8 }), standingY: 52, guide: Object.freeze({ y: 100, height: 204 }), entries: Object.freeze({ height: 40, button: 190 }), gap: 8 });
/** The casual panel on a wide screen: its pills under the title, and the room they take. */
const CASUAL = Object.freeze({ perks: Object.freeze({ y: 60, height: 30 }), top: 112 });
/** On a phone, where the game column's panel content starts: below its painted corners. */
const COMPACT_TOP = 16;
/** Between the ranked tickets and what they say. */
const TICKETS_GAP = 14;
const DIALOG = Object.freeze({ width: 680, height: 320, avatar: 72, buttonHeight: 52, gap: 14 });
/** The phone's dialog on how ranked works: its margin from the screen's edges, its title and its button. */
const GUIDE_DIALOG = Object.freeze({ margin: 12, maxWidth: 760, height: 290, title: 34, button: 46 });
export const QueueMode = Object.freeze({ CASUAL: "casual", RANKED: "ranked", AUTO: "auto" });
/** @typedef {typeof QueueMode[keyof typeof QueueMode]} Mode */
/** @typedef {{ id: string, text: string, colorKey: string }} Foot a line at the foot of the game column, over its button */
/** @typedef {{ id: string, text: string, variant?: import("../ui/Button.js").ButtonVariant, enabled?: boolean, onActivate: () => void }} MainAction */
/** What the auto list says before the player joins it, wide and on a phone. */
const AUTO_INTRO = Object.freeze({
  full: "Choose a deck and a style: the AI plays it against the next player who joins, even hours from now. It counts for the season, at a fifth of a game played by hand.",
  short: "The AI plays your deck in this style against the next player who joins, even hours from now.",
});
/** The ways to play ranked, as the ranked panel names them (wide, and in short on a phone). */
const RANKED_WAYS = Object.freeze([
  Object.freeze({ mode: QueueMode.RANKED, id: "online.mode.live", name: "Live match", short: "Live" }),
  Object.freeze({ mode: QueueMode.AUTO, id: "online.mode.auto", name: "Auto · the AI plays", short: "Auto" }),
]);
/** @typedef {{ kind: "challenge", account: string } | { kind: "answer", challengeId: string } | { kind: "auto" } | { kind: "guide" }} Dialog */

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
/** What the ranked panel says instead, while nothing is going on: ready to play, or what is missing. */
const RANKED_IDLE_TEXT = "Choose a deck, then find a ranked opponent or challenge a player online. Win to climb the season's leaderboard.";
/** At the ranked panel's foot: what counts as a game, and the limit between two players (docs/tcg/09). @type {Foot} */
const RANKED_RULES = Object.freeze({ id: "online.rules", text: "A ranked game started is a game played: conceding, leaving or running out of time all count. At most 3 ranked games against the same opponent in 24 hours.", colorKey: "textMuted" });
const RANKED_LOCKED_TEXT = "Ranked opens once you have played a few casual games, or practice games against the AI while signed in. Here is how it works meanwhile.";

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
  /** The way to play ranked last chosen (live or auto): the Ranked tab opens on it. @type {Mode} */
  #rankedMode = QueueMode.RANKED;
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
    // The ranked panel shows how much the season's jackpot holds.
    const jackpot = this.#app.jackpot;
    if (jackpot !== undefined) {
      this.#unsubscribes.push(jackpot.subscribe(() => this.#rebuild()), jackpot.watch());
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

  /**
   * The game column: the Casual and Ranked tabs over the panel of the one open (just the casual panel when there is no ranked play).
   * @returns {Button | null} the main action
   */
  #buildActions() {
    const state = this.#online().state;
    const column = this.#columns.game;
    const tabs = this.#app.ranking !== undefined;
    // The tabs stand clear of the panel, so its painted corners show whole.
    const tabHeight = tabs ? this.#m.tab + this.#m.tabGap : 0;
    const ranked = tabs && this.#mode !== QueueMode.CASUAL;
    const height = this.#screen.columns.height - tabHeight;
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: column.x, y: this.#screen.columns.top + tabHeight, width: column.width, height, glowKey: ranked ? "accent" : null }));
    if (tabs) {
      this.#buildTabs(column, state);
    }
    const width = column.width - 2 * this.#screen.inset;
    return ranked ? this.#buildRanked(panel, width, height, state) : this.#buildCasual(panel, width, height, tabs);
  }

  /**
   * The two tabs over the game column: Casual, free; Ranked, with what a game costs, or a padlock and how far it is.
   * They do not change while the player is in the queue.
   * @param {{ x: number, width: number }} column
   * @param {import("../../application/online/OnlineService.js").OnlineState} state
   */
  #buildTabs(column, state) {
    const { tab, tabGap } = this.#m;
    const width = (column.width - tabGap) / 2;
    const frame = { y: this.#screen.columns.top, width, height: tab, enabled: state.status !== OnlineStatus.SEARCHING };
    const casual = this.#mode === QueueMode.CASUAL;
    this.root.add(new ModeTab({ ...frame, id: "online.mode.casual", x: column.x, kind: PlayKind.CASUAL, text: "Casual", subtitle: this.#screen.compact ? "Free" : "Free · no rating at stake", selected: casual, onActivate: () => this.#choose(QueueMode.CASUAL) }));
    this.root.add(new ModeTab({ ...frame, id: "online.mode.ranked", x: column.x + width + tabGap, kind: PlayKind.RANKED, text: "Ranked", subtitle: this.#rankedTabLine(), selected: !casual, locked: this.#rankedLocked(), onActivate: () => this.#choose(this.#rankedMode) }));
  }

  /** The line under the Ranked tab: how many games open it, or what a game costs (and where the money goes). */
  #rankedTabLine() {
    if (this.#rankedLocked()) {
      const needed = this.#app.ranking?.state.standing?.casualGamesNeeded ?? 0;
      return `${needed} game${needed === 1 ? "" : "s"} to unlock`;
    }
    const fee = this.#rankedFee();
    if (this.#screen.compact) {
      return fee ?? "Rating";
    }
    return fee === null ? "Rating · leaderboard · jackpot" : `${fee} a game · jackpot`;
  }

  /**
   * The casual panel: what casual play is (wide), then the status and the main button.
   * @param {Panel} panel
   * @param {number} width
   * @param {number} height the panel's
   * @param {boolean} tabs whether the tabs are over it (else it says its own name)
   */
  #buildCasual(panel, width, height, tabs) {
    const inset = this.#screen.inset;
    if (tabs && this.#screen.compact) {
      return this.#buildPlay(panel, width, height, { top: COMPACT_TOP, fair: false, foot: null });
    }
    panel.add(new Label({ x: inset, y: this.#m.titleY, width, height: 36, text: "Casual game", size: "heading", weight: "bold", colorKey: tabs ? "focus" : "accentLight", align: "left", fit: true }));
    if (!tabs) {
      return this.#buildPlay(panel, width, height, { top: this.#m.mode.y, fair: true, foot: null });
    }
    panel.add(new Perks({ id: "online.perks", x: inset, y: CASUAL.perks.y, width, height: CASUAL.perks.height, items: ["Free to play", "No rating at stake", "Challenge anyone"], kind: PlayKind.CASUAL }));
    return this.#buildPlay(panel, width, height, { top: CASUAL.top, fair: true, foot: this.#unlockFoot() });
  }

  /**
   * The ranked panel: the season and the player's standing, how ranked play works (a dialog on a phone), the entries
   * the player holds, live or auto, then the status and the main button.
   * @param {Panel} panel
   * @param {number} width
   * @param {number} height the panel's
   * @param {import("../../application/online/OnlineService.js").OnlineState} state
   */
  #buildRanked(panel, width, height, state) {
    const auto = this.#rankedAllowed() && this.#mode === QueueMode.AUTO && this.#app.autoList !== undefined;
    const y = this.#buildRankedWays(panel, width, this.#buildRankedTop(panel, width, auto), state);
    if (auto) {
      return this.#buildAuto(panel, width, y, height);
    }
    return this.#buildPlay(panel, width, height, { top: y, fair: false, foot: RANKED_RULES });
  }

  /**
   * The top of the ranked panel; on a phone the auto list needs the room, its styles taking the place of the standing.
   * @param {Panel} panel
   * @param {number} width
   * @param {boolean} auto
   * @returns {number} where what follows starts
   */
  #buildRankedTop(panel, width, auto) {
    if (!this.#screen.compact) {
      return this.#buildRankedHead(panel, width);
    }
    return auto ? COMPACT_TOP : this.#buildRankedHeadCompact(panel, width);
  }

  /**
   * On a wide screen: the season's name, the standing beside the rating crest, the guide, and the entries the player holds.
   * @param {Panel} panel
   * @param {number} width
   * @returns {number} where what follows starts
   */
  #buildRankedHead(panel, width) {
    const inset = this.#screen.inset;
    const ranking = /** @type {import("../../application/ranking/RankingService.js").RankingService} */ (this.#app.ranking);
    const textWidth = this.#buildCrest(panel, width) ? width - RANKED.crest.width - RANKED.crest.inset - 16 : width;
    panel.add(new Label({ id: "online.season", x: inset, y: this.#m.titleY, width: textWidth, height: 36, text: ranking.state.standing?.season?.name ?? "Ranked game", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    panel.add(new TextBlock({ id: "online.standing", x: inset, y: RANKED.standingY, width: textWidth, height: 2 * 20, text: standingText(ranking.state), size: "small", colorKey: this.#rankedLocked() ? "accent" : "textMuted" }));
    panel.add(this.#guide({ x: inset, y: RANKED.guide.y, width, height: RANKED.guide.height, compact: false }));
    return this.#buildHeld(panel, width, RANKED.guide.y + RANKED.guide.height + RANKED.gap);
  }

  /**
   * The rating crest, top right, once the player plays ranked this season.
   * @param {Panel} panel
   * @param {number} width
   * @returns {boolean} whether there is one
   */
  #buildCrest(panel, width) {
    const standing = this.#app.ranking?.state.standing ?? null;
    if (standing === null || standing.season === null || !standing.eligible) {
      return false;
    }
    const place = standing.provisional || standing.rank === null ? "NEW" : `#${standing.rank}`;
    panel.add(new RatingCrest({ x: this.#screen.inset + width - RANKED.crest.width - RANKED.crest.inset, y: RANKED.crest.y, width: RANKED.crest.width, height: RANKED.crest.height, rating: standing.rating, place }));
    return true;
  }

  /**
   * How many ranked entries the player holds (in red when none), and the button to buy more while they have some
   * (with none, the main button offers them).
   * @param {Panel} panel
   * @param {number} width
   * @param {number} y
   * @returns {number} where what follows starts
   */
  #buildHeld(panel, width, y) {
    const held = heldEntriesText(this.#app.entries?.ranked ?? null);
    if (held === null) {
      return y;
    }
    const inset = this.#screen.inset;
    const more = this.#hasEntries() && this.services.hasScene(SceneId.SHOP);
    const room = more ? width - RANKED.entries.button - 12 : width;
    panel.add(new Label({ id: "online.entries", x: inset, y, width: room, height: RANKED.entries.height, text: held, size: "body", weight: "bold", colorKey: this.#hasEntries() ? "accentLight" : "danger", align: "left", fit: true }));
    if (more) {
      panel.add(new Button({ id: "online.moreEntries", x: inset + width - RANKED.entries.button, y, width: RANKED.entries.button, height: RANKED.entries.height, text: "Buy more entries", textSize: "small", onActivate: () => this.#getEntries() }));
    }
    return y + RANKED.entries.height + RANKED.gap;
  }

  /**
   * On a phone: the tickets the player holds and, beside them, their standing in short.
   * @param {Panel} panel
   * @param {number} width
   * @returns {number} where what follows starts
   */
  #buildRankedHeadCompact(panel, width) {
    const inset = this.#screen.inset;
    const ranked = this.#app.entries?.ranked ?? null;
    const y = COMPACT_TOP;
    const height = 2 * 22;
    let x = inset;
    if (ranked !== null && entriesNoteText(ranked) !== null) {
      const ticketsWidth = EntryTickets.widthFor(height);
      panel.add(new EntryTickets({ id: "online.tickets", x, y, width: ticketsWidth, height, count: ranked.balance, title: "Ranked", face: this.#priceText(), seed: "lobby" }));
      x += ticketsWidth + TICKETS_GAP;
    }
    const ranking = /** @type {import("../../application/ranking/RankingService.js").RankingService} */ (this.#app.ranking);
    panel.add(new TextBlock({ id: "online.standing", x, y, width: inset + width - x, height, text: shortStandingText(ranking.state), size: "small", colorKey: this.#rankedLocked() ? "accent" : "text" }));
    return y + height + 6;
  }

  /**
   * The ways to play ranked, live or the auto list (when there is one), and on a phone the button that shows how ranked works.
   * @param {Panel} panel
   * @param {number} width
   * @param {number} y
   * @param {import("../../application/online/OnlineService.js").OnlineState} state
   * @returns {number} where what follows starts
   */
  #buildRankedWays(panel, width, y, state) {
    const compact = this.#screen.compact;
    const ways = this.#app.autoList === undefined ? [] : RANKED_WAYS;
    if (ways.length === 0 && !compact) {
      return y;
    }
    const MODE = this.#m.mode;
    const room = compact ? this.#buildGuideButton(panel, width, y, ways.length === 0) : width;
    const size = (room - (ways.length - 1) * MODE.gap) / Math.max(1, ways.length);
    const enabled = this.#rankedAllowed() && state.status !== OnlineStatus.SEARCHING;
    ways.forEach((way, index) =>
      panel.add(
        new Button({
          id: way.id,
          x: this.#screen.inset + index * (size + MODE.gap),
          y,
          width: size,
          height: MODE.height,
          text: compact ? way.short : way.name,
          textSize: "small",
          variant: this.#mode === way.mode ? "primary" : "secondary",
          enabled,
          onActivate: () => this.#choose(way.mode),
        }),
      ),
    );
    return y + MODE.height + (compact ? 6 : 12);
  }

  /**
   * On a phone, the button that opens the guide: "?" at the end of the row, or the whole row when it is alone in it.
   * @param {Panel} panel
   * @param {number} width
   * @param {number} y
   * @param {boolean} alone
   * @returns {number} the width left in the row for the ways to play
   */
  #buildGuideButton(panel, width, y, alone) {
    const MODE = this.#m.mode;
    const size = alone ? width : MODE.height;
    panel.add(new Button({ id: "online.guide.open", x: this.#screen.inset + width - size, y, width: size, height: MODE.height, text: alone ? "How ranked works" : "?", textSize: "small", onActivate: () => this.#openDialog({ kind: "guide" }) }));
    return alone ? 0 : width - size - MODE.gap;
  }

  /**
   * How ranked play works, with the player's tickets and the season's jackpot.
   * @param {{ x: number, y: number, width: number, height: number, compact: boolean }} frame
   */
  #guide(frame) {
    const ranked = this.#app.entries?.ranked ?? null;
    const steps = rankedSteps({ price: this.#priceText(), perGame: ranked?.perGame ?? null, places: this.#app.jackpot?.state.jackpot?.places.length ?? null });
    return new RankedGuide({ ...frame, steps, tickets: { count: ranked === null || ranked.perGame === 0 ? null : ranked.balance, face: this.#priceText() }, jackpot: this.#jackpotAmount() });
  }

  /** What the season's jackpot holds ("866.666 STEEM"), or null when there is none or it is not known yet. */
  #jackpotAmount() {
    const jackpot = this.#app.jackpot?.state.jackpot ?? null;
    return jackpot === null || jackpot.jackpot === null ? null : describeJackpot(jackpot, this.#now()).amount;
  }

  /**
   * The status of the game column and its main button; on a wide screen, the paragraph on fair play and a line at the
   * foot, over the button (left out where an error would cover it).
   * @param {Panel} panel
   * @param {number} width
   * @param {number} height the panel's
   * @param {{ top: number, fair: boolean, foot: Foot | null }} options `top`: where the status starts; `fair`: the paragraph
   *   on how games are kept fair
   */
  #buildPlay(panel, width, height, { top, fair, foot }) {
    const inset = this.#screen.inset;
    const { button, note } = this.#m;
    const buttonY = height - inset - button;
    const error = this.#error();
    this.#buildStatus(panel, width, { top, bottom: buttonY - 6, error });
    if (note && fair) {
      panel.add(new TextBlock({ x: inset, y: top + 190, width, height: 5 * 26, text: "The server runs the game and checks every move. Both players add randomness to the shuffle after the server has committed to its own, and every move of the game is recorded.", size: "small", colorKey: "textMuted" }));
    }
    const footY = buttonY - 14 - 2 * 26;
    if (note && foot !== null && (error === null || top + STATUS_ROOM <= footY)) {
      panel.add(new TextBlock({ ...foot, x: inset, y: footY, width, height: 2 * 26, size: "small" }));
    }
    return panel.add(new Button({ keepPlate: true, ...this.#mainAction(), x: inset, y: buttonY, width, height: button }));
  }

  /** The error to show: the game's, else the lobby's; null when none. */
  #error() {
    return this.#online().state.error ?? this.#app.lobby?.state.error ?? null;
  }

  /**
   * The status and the error, if any: under the status on a wide screen; on a phone right above the button, the
   * status taking what is left above it.
   * @param {Panel} panel
   * @param {number} width
   * @param {{ top: number, bottom: number, error: { message: string } | null }} room
   */
  #buildStatus(panel, width, { top, bottom, error }) {
    const inset = this.#screen.inset;
    const { statusSize, note } = this.#m;
    const errorHeight = note ? 2 * 28 : 2 * 22;
    const errorY = note ? top + 120 : bottom - errorHeight;
    const statusBottom = error === null ? bottom : errorY;
    panel.add(new TextBlock({ id: "online.status", x: inset, y: top, width, height: note ? 4 * 28 : Math.max(0, statusBottom - top), text: this.#statusText(), size: statusSize, colorKey: "text" }));
    if (error !== null) {
      panel.add(new TextBlock({ id: "online.error", x: inset, y: errorY, width, height: errorHeight, text: error.message, size: "small", colorKey: "danger" }));
    }
  }

  /** At the casual panel's foot while ranked is locked: how many casual games open it. @returns {Foot | null} */
  #unlockFoot() {
    if (!this.#rankedLocked()) {
      return null;
    }
    const needed = this.#app.ranking?.state.standing?.casualGamesNeeded ?? 0;
    return { id: "online.unlockHint", text: `Every casual game brings Ranked closer: ${needed} more to go.`, colorKey: "accent" };
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
    const ranked = this.#app.ranking !== undefined && this.#mode !== QueueMode.CASUAL;
    if (ranked && this.#rankedLocked()) {
      return RANKED_LOCKED_TEXT;
    }
    if (ranked && state.status === OnlineStatus.IDLE) {
      return RANKED_IDLE_TEXT;
    }
    return STATUS_TEXT[/** @type {keyof typeof STATUS_TEXT} */ (state.status)]?.(state) ?? "";
  }

  /**
   * The big button of the game column: what is going on first (searching, a game, a challenge out), then on the
   * Ranked tab what is missing, else find a match.
   * @returns {MainAction}
   */
  #mainAction() {
    const ranked = this.#mode !== QueueMode.CASUAL;
    return this.#busyAction() ?? (ranked ? this.#rankedGate() : null) ?? this.#findAction(ranked);
  }

  /**
   * Stop searching, resume the game, or withdraw the challenge; null when none is going on.
   * @returns {MainAction | null}
   */
  #busyAction() {
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
    return null;
  }

  /**
   * What ranked play still needs: back to casual while it is locked, entries when the player has none; null when nothing.
   * @returns {MainAction | null}
   */
  #rankedGate() {
    if (this.#rankedLocked()) {
      return { id: "online.unlock", text: "Play casual to unlock", variant: "primary", onActivate: () => this.#choose(QueueMode.CASUAL) };
    }
    if (!this.#hasEntries() && this.services.hasScene(SceneId.SHOP)) {
      return { id: "online.getEntries", text: "Get ranked entries", variant: "primary", onActivate: () => this.#getEntries() };
    }
    return null;
  }

  /**
   * Find a match in the mode chosen, with what a ranked one costs; ranked waits for the server to say the player may play it.
   * @param {boolean} ranked
   * @returns {MainAction}
   */
  #findAction(ranked) {
    const online = this.#online();
    const status = online.state.status;
    const canQueue = status === OnlineStatus.IDLE || status === OnlineStatus.OVER || status === OnlineStatus.CANCELLED;
    const allowed = !ranked || this.#app.ranking === undefined || this.#rankedAllowed();
    return {
      id: "online.find",
      text: ranked ? withFee("Find a match", this.#rankedFee()) : "Find a match",
      variant: "primary",
      enabled: canQueue && allowed && this.#selectedId !== null,
      onActivate: () => {
        online.dismissGame();
        this.#app.lobby?.clearError();
        online.queue(/** @type {string} */ (this.#selectedId), /** @type {"casual" | "ranked"} the auto list has its own button */ (this.#mode));
      },
    };
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
    if (dialog.kind === "guide") {
      return this.#guideModal();
    }
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

  /** On a phone: how ranked play works, in a dialog over the lobby. */
  #guideModal() {
    const { viewport } = this.services;
    const width = Math.min(GUIDE_DIALOG.maxWidth, viewport.logicalWidth - 2 * GUIDE_DIALOG.margin);
    const height = Math.min(GUIDE_DIALOG.height, viewport.logicalHeight - 2 * GUIDE_DIALOG.margin);
    const modal = new Modal({ id: "guide", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: () => this.#closeDialog() });
    const inset = this.#screen.inset;
    const inner = width - 2 * inset;
    modal.panel.add(new Label({ id: "guide.title", x: inset, y: 8, width: inner, height: GUIDE_DIALOG.title, text: "How ranked works", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const buttonY = height - inset - GUIDE_DIALOG.button;
    const guideY = 8 + GUIDE_DIALOG.title + 6;
    modal.panel.add(this.#guide({ x: inset, y: guideY, width: inner, height: buttonY - 8 - guideY, compact: true }));
    modal.panel.add(new Button({ id: "guide.close", x: inset + inner - 160, y: buttonY, width: 160, height: GUIDE_DIALOG.button, text: "Got it", variant: "primary", onActivate: () => this.#closeDialog() }));
    return modal;
  }

  /**
   * The auto list in the ranked panel: where the player's ticket stands, the style, and the button to join; returns the main action.
   * Wide, the styles sit over their hint above the button; on a phone they come first and the status takes the rest (no hint).
   * @param {Panel} panel
   * @param {number} width
   * @param {number} top where the auto list starts
   * @param {number} height the panel's
   */
  #buildAuto(panel, width, top, height) {
    const autoList = /** @type {import("../../application/auto/AutoListService.js").AutoListService} */ (this.#app.autoList);
    const auto = autoList.state;
    const { button, mode: MODE } = this.#m;
    const compact = this.#screen.compact;
    const line = compact ? 22 : 26;
    const buttonY = height - this.#screen.inset - button;
    const hintY = buttonY - 10 - 2 * line;
    const stylesY = compact ? top : hintY - 6 - MODE.height;
    const statusTop = compact ? top + MODE.height + 6 : top;
    const statusBottom = compact ? buttonY - 6 : stylesY - 8;
    const errorHeight = auto.error === null ? 0 : 2 * line;
    panel.add(new TextBlock({ id: "online.auto.status", x: this.#screen.inset, y: statusTop, width, height: Math.max(0, statusBottom - errorHeight - statusTop), text: this.#autoStatusText(auto), size: "small", colorKey: "text" }));
    if (auto.error !== null) {
      panel.add(new TextBlock({ id: "online.error", x: this.#screen.inset, y: statusBottom - errorHeight, width, height: errorHeight, text: auto.error.message, size: "small", colorKey: "danger" }));
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
    if (!compact) {
      panel.add(new TextBlock({ id: "online.style.hint", x: this.#screen.inset, y: hintY, width, height: 2 * line, text: styleText(shown).hint, size: "small", colorKey: "textMuted" }));
    }
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
      // A phone says less: the Auto button above says which list.
      text: withFee(this.#screen.compact ? "Join the list" : "Join the auto list", this.#rankedFee()),
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
      // A phone has room for less: the result comes as a notification, the rest is in Info.
      const next = this.#screen.compact ? "A notification will tell you the result." : "The AI plays it against the next player who joins: a notification will tell you the result.";
      return `You joined ${timeAgo(auto.ticket.since, this.#now())} with “${deck}”, ${styleText(auto.ticket.style).name.toLowerCase()}. ${next} ${count}`;
    }
    const intro = this.#screen.compact ? AUTO_INTRO.short : AUTO_INTRO.full;
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

  /** Whether a season is running that the player may not play ranked in yet (not while their standing is still being read). */
  #rankedLocked() {
    const standing = this.#app.ranking?.state.standing ?? null;
    return standing !== null && standing.season !== null && !standing.eligible;
  }

  /** What one ranked entry costs in the shop, once its listing is read. */
  #entryPrice() {
    return rankedEntryPrice(this.#app.shop?.state.listing ?? null);
  }

  /** What one ranked entry costs ("1.000 STEEM"), or null until the shop's listing is read. */
  #priceText() {
    const price = this.#entryPrice();
    return price === null ? null : `${price.amount} ${price.asset}`;
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
    if (mode !== QueueMode.CASUAL) {
      this.#rankedMode = mode;
    }
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

/**
 * The three steps of ranked play as the guide words them: get entries, play (a game takes some), win the jackpot (which
 * every entry feeds).
 * @param {{ price: string | null, perGame: number | null, places: number | null }} facts what one entry costs ("1.000 STEEM"),
 *   how many a game takes (0: ranked is free; null: not known yet) and how many places the jackpot pays (null: not known)
 * @returns {[import("./online/RankedGuide.js").GuideStep, import("./online/RankedGuide.js").GuideStep, import("./online/RankedGuide.js").GuideStep]}
 */
export function rankedSteps({ price, perGame, places }) {
  const free = perGame === 0;
  const buy = price === null ? "From the shop: buy many with one payment." : `${price} each. Buy many with one payment.`;
  const take = perGame === null || perGame === 1 ? "A game takes 1 entry" : `A game takes ${perGame} entries`;
  const share = places === null ? "the best of the season share it" : `the top ${places} share it`;
  return [
    { title: "Get entries", text: free ? "Free this season: no entry needed." : buy },
    { title: "Play ranked", text: free ? "Win to climb the season's leaderboard." : `${take}, given back if it is called off before it starts.` },
    { title: "Win the jackpot", text: `Every entry goes into it. When the season ends, ${share}.` },
  ];
}

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

/**
 * The player's ranked standing in two short lines, beside their tickets on a phone.
 * @param {import("../../application/ranking/RankingService.js").RankingState} state
 */
export function shortStandingText(state) {
  const standing = state.standing;
  if (standing === null) {
    return state.error === null ? "Loading your standing…" : "Standing unavailable.";
  }
  if (standing.season === null) {
    return "No ranked season is running.";
  }
  if (!standing.eligible) {
    return `Opens after ${standing.casualGamesNeeded} more casual game(s).`;
  }
  const draws = standing.draws > 0 ? `–${standing.draws}` : "";
  const place = standing.provisional ? "new" : `#${standing.rank}`;
  return `Rating ${standing.rating} · ${place}\n${standing.wins}–${standing.losses}${draws} in ${standing.games} game(s)`;
}
