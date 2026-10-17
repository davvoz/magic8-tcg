/**
 * The ranked lobby: the season's games, which change the player's rating
 * and feed the season's jackpot, and which take ranked entries. Its panel,
 * lit in gold, puts first what ranked play needs:
 *
 * - the season and the player's standing (their rating crest once they
 *   play it);
 * - the ranked entries they hold, drawn as the stack of tickets they are,
 *   with what one costs and the button to get more right there (a dialog:
 *   no trip to the shop, EntryPurchaseDialog);
 * - "ready to play": ranked open to them, entries held, a playable deck,
 *   each ticked or saying what is missing (and leading to it);
 * - the two ways to play ranked, live or the auto list, then the status and
 *   the big button: find a ranked match, saying what it takes — or, while
 *   something is missing, what gets it (casual games, entries).
 *
 * On a phone the panel keeps the tickets with their button, the standing in
 * short, the ways to play, the status and the big button. While nothing is
 * going on, how ranked works (RankedGuide) takes the status's place; the
 * whole of it, in words, is the Info screen's Ranked topic, which the bar's
 * How ranked works opens. The leaderboard is reached from the season's prize
 * over the decks (PrizeShowcase), or from the bar when there is none.
 *
 * The auto list (docs/tcg/23-automatica.md) needs nobody online: the player
 * chooses a deck and an AI style and joins it, paying a ranked entry; the AI
 * plays their deck against the next player who joins, even hours later, and
 * the result arrives as a notification. Once in, the player stays in: the
 * lobby says since when and offers no way out, and the dialog before
 * joining says so.
 */
import { AUTO_STYLES, AutoListStatus, AutoStyle } from "../../application/auto/AutoListService.js";
import { entriesText, rankedEntriesText, rankedFeeText } from "../../application/entries/EntryService.js";
import { OnlineStatus } from "../../application/online/OnlineService.js";
import { ShopStatus } from "../../application/shop/ShopService.js";
import { InfoTopicId } from "../../application/info/infoTopics.js";
import { Button } from "../ui/Button.js";
import { Icon } from "../ui/icons.js";
import { Label } from "../ui/Label.js";
import { TextBlock } from "../ui/TextBlock.js";
import { EntryPurchaseDialog } from "./entries/EntryPurchaseDialog.js";
import { EntryTickets } from "./entries/EntryTickets.js";
import { PrizeShowcase, SHOWCASE_HEIGHT } from "./jackpot/PrizeShowcase.js";
import { ActiveKeyDialog } from "./ActiveKeyDialog.js";
import { casualGamesText, shortStandingText, standingText } from "./lobby/lobbyText.js";
import { LobbyScene } from "./lobby/LobbyScene.js";
import { PlayKind } from "./online/lobbyIcons.js";
import { jackpotAmountText, rankedGuideFor, rankedPriceText } from "./online/rankedGuideFor.js";
import { RatingCrest } from "./online/RatingCrest.js";
import { StepList, StepState } from "./online/StepList.js";
import { TintedBand } from "./online/TintedBand.js";
import { timeAgo } from "./NotificationsScene.js";
import { SceneId } from "./sceneIds.js";

const RankedWay = Object.freeze({ LIVE: "live", AUTO: "auto" });
/**
 * The panel on a wide screen: the rating crest (top right, below the painted corner and in from it), where the standing
 * sits, the band of the entries held (its tickets, its words, its button), the ready-to-play list and the gaps.
 */
const WIDE = Object.freeze({
  crest: Object.freeze({ width: 62, height: 72, y: 24, inset: 8 }),
  standingY: 52,
  band: Object.freeze({ y: 102, height: 124, pad: 12, caption: 22, count: 40, button: 160 }),
  ready: Object.freeze({ caption: 24, row: 33, trail: 170 }),
  gap: 12,
});
/** The phone's row of tickets: its height, the button beside it and the gap after it. */
const COMPACT = Object.freeze({ tickets: 46, button: 76, gap: 6 });
/** The least room how ranked works needs in the panel (else the status is shown). */
const GUIDE_ROOM = Object.freeze({ least: 120 });
/** What the auto list says before the player joins it, wide and on a phone. */
const AUTO_INTRO = Object.freeze({
  full: "Choose a deck and a style: the AI plays it against the next player who joins, even hours from now. It counts for the season, at a fifth of a game played by hand.",
  short: "The AI plays your deck in this style against the next player who joins, even hours from now.",
});
/** The ways to play ranked, as the panel names them (wide, and in short on a phone). */
const RANKED_WAYS = Object.freeze([
  Object.freeze({ way: RankedWay.LIVE, id: "online.mode.live", name: "Live match", short: "Live" }),
  Object.freeze({ way: RankedWay.AUTO, id: "online.mode.auto", name: "Auto · the AI plays", short: "Auto" }),
]);
/** The AI styles, as the lobby names and explains them. */
const STYLE_TEXT = Object.freeze({
  [AutoStyle.AGGRESSIVE]: Object.freeze({ name: "Aggressive", hint: "Attacks often, goes for the face once the opponent is low, keeps its creatures for attacking." }),
  [AutoStyle.BALANCED]: Object.freeze({ name: "Balanced", hint: "Attacks when it is safe, trades evenly, blocks to stay alive." }),
  [AutoStyle.DEFENSIVE]: Object.freeze({ name: "Defensive", hint: "Attacks only when nothing can stop it, blocks often and gives up creatures to protect its life." }),
});
/** At the panel's foot: what counts as a game, and the limit between two players (docs/tcg/09). @type {import("./lobby/LobbyScene.js").Foot} */
const RANKED_RULES = Object.freeze({ id: "online.rules", text: "A ranked game started is a game played: conceding, leaving or running out of time all count. At most 3 ranked games against the same opponent in 24 hours.", colorKey: "textMuted" });

export class RankedScene extends LobbyScene {
  /** The way to play ranked chosen: live or the auto list. @type {string} */
  #way = RankedWay.LIVE;
  /** The AI style chosen for the auto list. @type {string} */
  #style = AutoStyle.BALANCED;
  /** The auto list's status last seen: joining took an entry, a ticket that closed gave it back. @type {string | null} */
  #lastAutoStatus = null;
  /** Getting entries here, kept while the screen shows (how many, whose purchase). */
  #purchase;
  /** Whether closing the purchase goes back where the player was (it was opened from the bar's tickets, elsewhere). */
  #backAfterPurchase = false;
  /** The active key a payment with the player's own keys needs, asked for over the screen. @type {ActiveKeyDialog | null} */
  #activeKey = null;
  /** The season's prize over the decks and the players, while there is a jackpot to show. @type {PrizeShowcase | null} */
  #showcase = null;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {() => number} [now]
   */
  constructor(services, app, now = () => Date.now()) {
    super(services, app, { scene: SceneId.RANKED, title: "Ranked", now });
    this.#purchase = new EntryPurchaseDialog(app, { onClose: () => this.#closePurchase(), onPlay: () => this.#playAfterPurchase(), refresh: () => this.rebuild() });
  }

  /**
   * @param {{ back?: string, buy?: boolean, quick?: boolean }} [params] `buy`: opens on getting tickets (a ranked
   *   challenge the player could not pay for, elsewhere); `quick`: only for that (the bar's tickets, clicked elsewhere):
   *   closing the purchase goes back
   */
  enter(params = {}) {
    this.#activeKey = this.app.activeKeys === undefined ? null : new ActiveKeyDialog(this, this.app.activeKeys);
    this.#activeKey?.start();
    super.enter(params);
    this.#backAfterPurchase = params.buy === true && params.quick === true;
    if (params.buy === true) {
      this.getEntries();
    }
  }

  exit() {
    this.#activeKey?.stop();
    this.#activeKey = null;
    this.#showcase = null;
    super.exit();
  }

  /** @param {number} dtMs */
  update(dtMs) {
    const ticked = this.#showcase?.tick() ?? false;
    return super.update(dtMs) || ticked;
  }

  /** The season's prize, when the season has a jackpot. */
  bannerHeight() {
    if ((this.app.jackpot?.state.jackpot ?? null) === null) {
      return 0;
    }
    return this.screen.compact ? SHOWCASE_HEIGHT.compact : SHOWCASE_HEIGHT.wide;
  }

  /** @param {{ x: number, y: number, width: number, height: number }} frame */
  buildBanner(frame) {
    const service = /** @type {NonNullable<import("../../application/AppContext.js").AppContext["jackpot"]>} */ (this.app.jackpot);
    const jackpot = /** @type {import("../../application/ports/JackpotApi.contract.js").Jackpot} */ (service.state.jackpot);
    const viewer = { account: this.app.account?.state.account ?? null, standing: this.app.ranking?.state.standing ?? null };
    const onLeaderboard = () => this.#openLeaderboard();
    this.#showcase = this.root.add(new PrizeShowcase({ id: "ranked.prize", ...frame, jackpot, now: () => service.now(), compact: this.screen.compact, viewer, onLeaderboard }));
  }

  relayout() {
    super.relayout();
    this.#activeKey?.relayout();
  }

  watchServices() {
    const { app } = this;
    // The shop's listing says what an entry costs, and sells them here.
    const shop = app.shop;
    if (shop !== undefined) {
      this.watch(shop.subscribe(() => this.rebuild()));
      if (shop.state.listing === null && shop.state.status !== ShopStatus.LOADING) {
        void shop.load();
      }
    }
    if (app.balance !== undefined) {
      this.watch(app.balance.subscribe(() => this.rebuild()));
    }
    // The band says how much the season's jackpot holds.
    const jackpot = app.jackpot;
    if (jackpot !== undefined) {
      this.watch(jackpot.subscribe(() => this.rebuild()), jackpot.watch());
    }
    const autoList = app.autoList;
    if (autoList !== undefined) {
      this.#lastAutoStatus = autoList.state.status;
      this.watch(autoList.subscribe((state) => this.#onAutoChange(state)));
      autoList.start();
      void autoList.refresh();
    }
  }

  /** @returns {"ranked"} */
  get queueMode() {
    return "ranked";
  }

  get panelGlow() {
    return "accent";
  }

  idleText() {
    return "Choose a deck, then find a ranked opponent or challenge a player online. Win to climb the season's leaderboard.";
  }

  lobbyNotice() {
    if (this.rankedLocked()) {
      return "Ranked opens once you have played a few casual games, or practice games against the AI while signed in. Each one brings it closer.";
    }
    const status = this.online().state.status;
    const idle = status === OnlineStatus.IDLE || status === OnlineStatus.OVER || status === OnlineStatus.CANCELLED;
    if (idle && this.rankedAllowed() && !this.hasEntries()) {
      return "You need a ranked ticket to play: buy some below. They never expire, and every one goes into the season's jackpot.";
    }
    return null;
  }

  /** @returns {import("./lobby/LobbyScene.js").MainAction | null} */
  gateAction() {
    if (this.rankedLocked()) {
      return { id: "online.unlock", text: "Play casual to unlock", variant: "primary", onActivate: () => this.services.navigate(SceneId.CASUAL) };
    }
    if (!this.hasEntries() && this.#purchase.available) {
      return { id: "online.getEntries", text: "Buy ranked tickets", variant: "primary", onActivate: () => this.getEntries() };
    }
    return null;
  }

  findText() {
    const fee = this.#perGame();
    const text = this.screen.compact ? "Find a match" : "Find a ranked match";
    return fee === null ? text : `${text} · ${entriesText(fee)}`;
  }

  mayQueue() {
    return this.app.ranking === undefined || this.rankedAllowed();
  }

  /** @param {import("../../application/online/OnlineService.js").OnlineDeck | null} _deck */
  challengeTerms(_deck) {
    if (!this.rankedAllowed()) {
      return { note: " Ranked opens once you have played enough casual games, or enough practice games against the AI.", enabled: false, send: "Send challenge" };
    }
    if (!this.hasEntries()) {
      /** @type {import("./lobby/LobbyScene.js").DialogButton} */
      const extra = { id: "challenge.getEntries", text: "Buy tickets", variant: "secondary", enabled: this.#purchase.available, onActivate: () => this.getEntries() };
      return { note: " A ranked game takes a ranked ticket from each of you, and you have none.", enabled: false, send: "Send challenge", extra };
    }
    const fee = rankedFeeText(this.app.entries?.ranked ?? null);
    return { note: fee === null ? "" : ` The game takes ${fee} from each of you when it starts.`, enabled: true, send: "Send challenge" };
  }

  /** The purchase closed: back where the player was when they came only for it, else this screen. */
  #closePurchase() {
    this.closeDialog();
    if (this.#backAfterPurchase) {
      this.#backAfterPurchase = false;
      this.goBack();
    }
  }

  /** The tickets bought, the player goes on to play: this screen, whatever brought them here. */
  #playAfterPurchase() {
    this.#backAfterPurchase = false;
    this.closeDialog();
  }

  /** Gets entries right here: the purchase dialog. */
  getEntries() {
    if (!this.#purchase.available) {
      return;
    }
    this.#purchase.prepare();
    this.openDialog({ kind: "tickets" });
  }

  /** @param {import("./lobby/LobbyScene.js").Dialog} dialog */
  ownDialog(dialog) {
    const { compact, inset } = this.screen;
    if (dialog.kind === "tickets") {
      return this.#purchase.build({ viewport: this.services.viewport, compact, inset });
    }
    return dialog.kind === "auto" ? this.#autoModal() : null;
  }

  /**
   * The season and the standing, the entries held, what playing needs (wide), the ways to play, then the status and
   * the big button (or the auto list's).
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {{ width: number, height: number }} room
   */
  buildGame(panel, room) {
    this.#buildBarActions();
    const { width } = room;
    const auto = this.rankedAllowed() && this.#way === RankedWay.AUTO && this.app.autoList !== undefined;
    const top = this.screen.compact ? this.#buildHeadCompact(panel, width) : this.#buildHead(panel, width);
    const y = this.#buildWays(panel, width, top);
    if (auto) {
      return this.#buildAuto(panel, room, y);
    }
    if (this.#guideInPlace()) {
      const button = this.#buildGuideAndPlay(panel, room, y);
      if (button !== null) {
        return button;
      }
    }
    return this.buildPlay(panel, room, { top: y, fair: false, foot: RANKED_RULES });
  }

  /**
   * Whether how ranked works takes the status's place: while nothing is going on (no search, no game, no challenge out,
   * no error) and, on a phone, nothing is missing that only the status would say (a wide screen's ready list says it).
   */
  #guideInPlace() {
    const online = this.online().state;
    const lobby = this.app.lobby?.state ?? null;
    const quiet = online.status === OnlineStatus.IDLE && online.error === null && (lobby === null || (lobby.error === null && lobby.outgoing === null));
    return quiet && (!this.screen.compact || this.lobbyNotice() === null);
  }

  /**
   * How ranked works, where the status would be, then the rules (a wide screen) and the big button; null when there is
   * no room for the guide (the status then).
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {{ width: number, height: number }} room
   * @param {number} top
   * @returns {Button | null}
   */
  #buildGuideAndPlay(panel, { width, height }, top) {
    const { inset, compact } = this.screen;
    const buttonY = height - inset - this.metrics.button;
    const footY = buttonY - 14 - 2 * 26;
    const bottom = compact ? buttonY - 6 : footY - 8;
    const space = bottom - top;
    if (space < GUIDE_ROOM.least) {
      return null;
    }
    if (compact) {
      panel.add(rankedGuideFor(this.app, { x: inset, y: top, width, height: space, compact: true, brief: true }, this.now()));
    } else {
      // A wide screen: under its caption, each step on a plate of its own.
      panel.add(new Label({ id: "ranked.guide.caption", x: inset, y: top, width, height: WIDE.ready.caption, text: "HOW RANKED WORKS", size: "tiny", weight: "bold", colorKey: "accent", align: "left", fit: true }));
      const platesTop = top + WIDE.ready.caption + 4;
      panel.add(rankedGuideFor(this.app, { x: inset, y: platesTop, width, height: bottom - platesTop, compact: false, plates: true }, this.now()));
    }
    if (!compact) {
      panel.add(new TextBlock({ ...RANKED_RULES, x: inset, y: footY, width, height: 2 * 26, size: "small" }));
    }
    return this.buildMainButton(panel, this.mainAction(), { width, y: buttonY });
  }

  /**
   * In the bar: how ranked works, and the leaderboard while the season's prize (which leads there) is not on show.
   */
  #buildBarActions() {
    // The whole of it, in the Info screen's Ranked topic; Back comes back here.
    const guide = { id: "ranked.guide", icon: Icon.BOOK, caption: "How ranked works", enabled: this.services.hasScene(SceneId.INFO), onActivate: () => this.services.navigate(SceneId.INFO, { topic: InfoTopicId.RANKED, ...this.backHere() }) };
    const leaderboard = { id: "ranked.season", icon: Icon.SEASON, caption: "Leaderboard", enabled: this.services.hasScene(SceneId.SEASON), onActivate: () => this.#openLeaderboard() };
    this.setBarActions(this.bannerHeight() > 0 ? [guide] : [guide, leaderboard]);
  }

  #openLeaderboard() {
    this.services.navigate(SceneId.SEASON, this.backHere());
  }

  /**
   * On a wide screen: the season's name, the standing beside the rating crest, the band of entries and the ready list.
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {number} width
   * @returns {number} where what follows starts
   */
  #buildHead(panel, width) {
    const inset = this.screen.inset;
    const ranking = this.app.ranking;
    const textWidth = this.#buildCrest(panel, width) ? width - WIDE.crest.width - WIDE.crest.inset - 16 : width;
    const titleInset = this.screen.titleInset;
    panel.add(new Label({ id: "online.season", x: titleInset, y: this.metrics.titleY, width: textWidth - (titleInset - inset), height: 36, text: ranking?.state.standing?.season?.name ?? "Ranked game", size: "subheading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    if (ranking !== undefined) {
      panel.add(new TextBlock({ id: "online.standing", x: inset, y: WIDE.standingY, width: textWidth, height: 2 * 20, text: standingText(ranking.state), size: "small", colorKey: this.rankedLocked() ? "accent" : "textMuted" }));
    }
    const bandBottom = this.#buildBand(panel, width, WIDE.band.y);
    return this.#buildReady(panel, width, bandBottom + WIDE.gap);
  }

  /**
   * The rating crest, top right, once the player plays ranked this season.
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {number} width
   * @returns {boolean} whether there is one
   */
  #buildCrest(panel, width) {
    const standing = this.app.ranking?.state.standing ?? null;
    if (standing === null || standing.season === null || !standing.eligible) {
      return false;
    }
    const place = standing.provisional || standing.rank === null ? "NEW" : `#${standing.rank}`;
    panel.add(new RatingCrest({ x: this.screen.inset + width - WIDE.crest.width - WIDE.crest.inset, y: WIDE.crest.y, width: WIDE.crest.width, height: WIDE.crest.height, rating: standing.rating, place }));
    return true;
  }

  /**
   * The entries the player holds, as a band: the stack of tickets, how many, what they are for and cost, and the button
   * to get more. Nothing while ranked play is free (or the entries are not known yet).
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {number} width
   * @param {number} y
   * @returns {number} where the band ends
   */
  #buildBand(panel, width, y) {
    const ranked = this.app.entries?.ranked ?? null;
    if (ranked === null || ranked.perGame === 0) {
      return y;
    }
    const inset = this.screen.inset;
    const band = WIDE.band;
    const none = !this.hasEntries();
    panel.add(new TintedBand({ id: "ranked.band", x: inset, y, width, height: band.height, kind: PlayKind.RANKED, alert: none }));
    const ticketsHeight = band.height - 2 * band.pad;
    const ticketsWidth = EntryTickets.widthFor(ticketsHeight);
    panel.add(new EntryTickets({ id: "online.tickets", x: inset + band.pad, y: y + band.pad, width: ticketsWidth, height: ticketsHeight, count: ranked.balance, title: "Ranked", face: rankedPriceText(this.app), seed: "lobby" }));
    const x = inset + band.pad + ticketsWidth + 18;
    const textWidth = inset + width - band.pad - x;
    const buy = this.#purchase.available;
    panel.add(new Label({ id: "ranked.band.caption", x, y: y + band.pad, width: textWidth, height: band.caption, text: "YOUR RANKED TICKETS", size: "tiny", weight: "bold", colorKey: "accent", align: "left", fit: true }));
    const countY = y + band.pad + band.caption;
    const count = ranked.balance === 0 ? "None yet" : entriesText(ranked.balance);
    panel.add(new Label({ id: "online.entries", x, y: countY, width: textWidth - (buy ? band.button + 12 : 0), height: band.count, text: count, size: "heading", weight: "bold", colorKey: none ? "danger" : "accentLight", align: "left", fit: true }));
    if (buy) {
      panel.add(new Button({ id: "ranked.buy", x: x + textWidth - band.button, y: countY, width: band.button, height: band.count, text: none ? "Buy tickets" : "Buy", textSize: "small", onActivate: () => this.getEntries() }));
    }
    const aboutY = countY + band.count + 4;
    panel.add(new TextBlock({ id: "ranked.band.about", x, y: aboutY, width: textWidth, height: y + band.height - aboutY - 4, text: this.#entriesAbout(ranked.perGame), size: "small", colorKey: "textMuted" }));
    return y + band.height;
  }

  /**
   * What an entry is for and what it costs, in two lines: "A game uses 1 · 1.000 STEEM each", "All go into the jackpot: 866.666 STEEM".
   * @param {number} perGame
   */
  #entriesAbout(perGame) {
    const price = rankedPriceText(this.app);
    const jackpot = jackpotAmountText(this.app, this.now());
    const use = price === null ? `A game uses ${perGame}` : `A game uses ${perGame} · ${price} each`;
    const pot = jackpot === null ? "All go into the season's jackpot" : `All go into the jackpot: ${jackpot}`;
    return `${use}\n${pot}`;
  }

  /**
   * Ready to play? Ranked open to the player, entries held, a playable deck: each ticked, or saying what is missing,
   * with the way to it beside (casual games).
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {number} width
   * @param {number} y
   * @returns {number} where what follows starts
   */
  #buildReady(panel, width, y) {
    const inset = this.screen.inset;
    const { caption, row, trail } = WIDE.ready;
    panel.add(new Label({ id: "ranked.ready.caption", x: inset, y, width, height: caption, text: "READY TO PLAY?", size: "tiny", weight: "bold", colorKey: "accent", align: "left", fit: true }));
    const steps = [this.#openStep(), this.#entriesStep(), this.#deckStep()];
    const top = y + caption;
    const list = panel.add(new StepList({ id: "ranked.ready", x: inset, y: top, width, height: steps.length * row, kind: PlayKind.RANKED, steps }));
    if (this.rankedLocked()) {
      panel.add(new Button({ id: "ranked.toCasual", x: inset + width - trail, y: top + list.rowY(0) + 3, width: trail, height: row - 6, text: "Play casual", textSize: "small", onActivate: () => this.services.navigate(SceneId.CASUAL) }));
    }
    return top + steps.length * row + WIDE.gap;
  }

  /** @returns {import("./online/StepList.js").Step} */
  #openStep() {
    const standing = this.app.ranking?.state.standing ?? null;
    if (standing === null) {
      return { text: "Reading your ranked standing…" };
    }
    if (standing.season === null) {
      return { text: "No ranked season is running right now.", state: StepState.MISSING };
    }
    if (!standing.eligible) {
      // In a line beside Play casual: the practice games that count too are in the standing above.
      return { text: `Opens after ${casualGamesText(standing.casualGamesNeeded)}.`, state: StepState.LOCKED, colorKey: "accent", trail: WIDE.ready.trail + 10 };
    }
    return { text: "Ranked is open to you.", state: StepState.DONE };
  }

  /** @returns {import("./online/StepList.js").Step} */
  #entriesStep() {
    const ranked = this.app.entries?.ranked ?? null;
    if (ranked === null) {
      return { text: "Reading your ranked entries…" };
    }
    if (ranked.perGame === 0) {
      return { text: "Free this season: no ticket needed.", state: StepState.DONE };
    }
    if (!this.hasEntries()) {
      return { text: `No ranked tickets: a game uses ${ranked.perGame}. Buy some above.`, state: StepState.MISSING };
    }
    const games = Math.floor(ranked.balance / ranked.perGame);
    return { text: `${rankedEntriesText(ranked.balance)}: enough for ${games} game${games === 1 ? "" : "s"}.`, state: StepState.DONE };
  }

  /** @returns {import("./online/StepList.js").Step} */
  #deckStep() {
    const deck = this.selectedDeck();
    return deck === null ? { text: "Choose a playable deck on the left.", state: StepState.MISSING } : { text: `Your deck: “${deck.name}”.`, state: StepState.DONE };
  }

  /**
   * On a phone: the tickets held — their stack, how many and what one costs — with the button to buy more; nothing
   * else there. While tickets are free (or not known yet), the standing in short instead.
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {number} width
   * @returns {number} where what follows starts
   */
  #buildHeadCompact(panel, width) {
    const inset = this.screen.inset;
    const ranked = this.app.entries?.ranked ?? null;
    const y = this.metrics.top;
    const height = COMPACT.tickets;
    if (ranked === null || ranked.perGame === 0) {
      const ranking = this.app.ranking;
      if (ranking !== undefined) {
        panel.add(new TextBlock({ id: "online.standing", x: inset, y, width, height, text: shortStandingText(ranking.state), size: "small", colorKey: this.rankedLocked() ? "accent" : "text", valign: "middle" }));
      }
      return y + height + COMPACT.gap;
    }
    const ticketsWidth = EntryTickets.widthFor(height);
    panel.add(new EntryTickets({ id: "online.tickets", x: inset, y, width: ticketsWidth, height, count: ranked.balance, title: "Ranked", face: rankedPriceText(this.app), seed: "lobby" }));
    const x = inset + ticketsWidth + 10;
    let right = inset + width;
    if (this.#purchase.available) {
      right -= COMPACT.button;
      panel.add(new Button({ id: "ranked.buy", x: right, y, width: COMPACT.button, height, text: "Buy", textSize: "small", onActivate: () => this.getEntries() }));
      right -= 8;
    }
    const none = !this.hasEntries();
    const price = rankedPriceText(this.app);
    panel.add(new Label({ id: "online.entries", x, y: y + 2, width: Math.max(0, right - x), height: height / 2, text: ranked.balance === 0 ? "No tickets" : entriesText(ranked.balance), size: "body", weight: "bold", colorKey: none ? "danger" : "accentLight", align: "left", fit: true }));
    panel.add(new Label({ id: "ranked.band.about", x, y: y + height / 2, width: Math.max(0, right - x), height: height / 2 - 2, text: price === null ? `${ranked.perGame} a game` : `${price} each`, size: "tiny", colorKey: "textMuted", align: "left", fit: true }));
    return y + height + COMPACT.gap;
  }

  /**
   * The ways to play ranked, live or the auto list (when there is one).
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {number} width
   * @param {number} y
   * @returns {number} where what follows starts
   */
  #buildWays(panel, width, y) {
    if (this.app.autoList === undefined) {
      return y;
    }
    const { compact, inset } = this.screen;
    const ROW = this.metrics.row;
    const size = (width - (RANKED_WAYS.length - 1) * ROW.gap) / RANKED_WAYS.length;
    const enabled = this.rankedAllowed() && !this.searching();
    RANKED_WAYS.forEach((way, index) =>
      panel.add(
        new Button({
          id: way.id,
          x: inset + index * (size + ROW.gap),
          y,
          width: size,
          height: ROW.height,
          text: compact ? way.short : way.name,
          textSize: "small",
          variant: this.#way === way.way ? "primary" : "secondary",
          enabled,
          onActivate: () => {
            this.#way = way.way;
            this.rebuild();
          },
        }),
      ),
    );
    return y + ROW.height + (compact ? 6 : 12);
  }

  /**
   * Before joining the auto list: what will happen, what it costs, and that there is no way out.
   * @returns {import("../ui/Modal.js").Modal | null}
   */
  #autoModal() {
    const autoList = this.app.autoList;
    const deck = this.selectedDeck();
    if (autoList === undefined || deck === null || autoList.state.status !== AutoListStatus.IDLE) {
      return null;
    }
    const style = styleText(this.#style).name;
    const fee = rankedFeeText(this.app.entries?.ranked ?? null) ?? "a ranked ticket";
    const join = () => {
      this.closeDialog();
      void autoList.join(deck.id, this.#style).then(() => this.app.entries?.refresh());
    };
    return this.dialogFrame({
      account: this.app.account?.state.account ?? null,
      title: "Join the auto list",
      message: `The AI plays “${deck.name}” ${style.toLowerCase()} against the next player who joins, even hours from now. It costs ${fee}. Once you join you stay in the list until someone plays you.`,
      buttons: [
        { id: "auto.close", text: "Cancel", variant: "secondary", enabled: true, onActivate: () => this.closeDialog() },
        { id: "auto.join", text: `Join · ${style}`, variant: "primary", enabled: true, onActivate: join },
      ],
    });
  }

  /**
   * The auto list in the panel: where the player's ticket stands, the style, and the button to join; returns the big button.
   * Wide, the styles sit over their hint above the button; on a phone they come first and the status takes the rest (no hint).
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {{ width: number, height: number }} room
   * @param {number} top where the auto list starts
   */
  #buildAuto(panel, { width, height }, top) {
    const autoList = /** @type {import("../../application/auto/AutoListService.js").AutoListService} */ (this.app.autoList);
    const auto = autoList.state;
    const { button, row: ROW } = this.metrics;
    const { compact, inset } = this.screen;
    const line = compact ? 22 : 26;
    const buttonY = height - inset - button;
    const hintY = buttonY - 10 - 2 * line;
    const stylesY = compact ? top : hintY - 6 - ROW.height;
    const statusTop = compact ? top + ROW.height + 6 : top;
    const statusBottom = compact ? buttonY - 6 : stylesY - 8;
    const errorHeight = auto.error === null ? 0 : 2 * line;
    panel.add(new TextBlock({ id: "online.auto.status", x: inset, y: statusTop, width, height: Math.max(0, statusBottom - errorHeight - statusTop), text: this.#autoStatusText(auto), size: "small", colorKey: "text" }));
    if (auto.error !== null) {
      panel.add(new TextBlock({ id: "online.error", x: inset, y: statusBottom - errorHeight, width, height: errorHeight, text: auto.error.message, size: "small", colorKey: "danger" }));
    }
    const inList = auto.status === AutoListStatus.WAITING || auto.status === AutoListStatus.JOINING;
    // In the list, the style is the ticket's: frozen with it.
    const shown = inList && auto.ticket !== null ? auto.ticket.style : this.#style;
    const size = (width - 2 * ROW.gap) / 3;
    AUTO_STYLES.forEach((style, index) =>
      panel.add(
        new Button({
          id: `online.style.${style}`,
          x: inset + index * (size + ROW.gap),
          y: stylesY,
          width: size,
          height: ROW.height,
          text: styleText(style).name,
          textSize: "small",
          variant: style === shown ? "primary" : "secondary",
          enabled: !inList,
          onActivate: () => {
            this.#style = style;
            this.rebuild();
          },
        }),
      ),
    );
    if (!compact) {
      panel.add(new TextBlock({ id: "online.style.hint", x: inset, y: hintY, width, height: 2 * line, text: styleText(shown).hint, size: "small", colorKey: "textMuted" }));
    }
    return this.buildMainButton(panel, this.#autoAction(auto), { width, y: buttonY });
  }

  /**
   * The big button of the auto list: join it, get the entries it takes, or say the player is in.
   * @param {import("../../application/auto/AutoListService.js").AutoListState} auto
   * @returns {import("./lobby/LobbyScene.js").MainAction}
   */
  #autoAction(auto) {
    const none = () => undefined;
    if (auto.status === AutoListStatus.WAITING) {
      return { id: "online.auto.waiting", text: "In the auto list · waiting for an opponent", enabled: false, onActivate: none };
    }
    if (auto.status === AutoListStatus.JOINING) {
      return { id: "online.auto.joining", text: "Joining the auto list…", enabled: false, onActivate: none };
    }
    const gate = this.gateAction();
    if (gate !== null) {
      return gate;
    }
    const status = this.online().state.status;
    const connected = status !== OnlineStatus.OFFLINE && status !== OnlineStatus.CONNECTING;
    const fee = this.#perGame();
    // A phone says less: the Auto button above says which list.
    const text = this.screen.compact ? "Join the list" : "Join the auto list";
    return {
      id: "online.auto.join",
      text: fee === null ? text : `${text} · ${entriesText(fee)}`,
      variant: "primary",
      enabled: auto.status === AutoListStatus.IDLE && connected && this.selectedDeck() !== null,
      onActivate: () => this.openDialog({ kind: "auto" }),
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
      const deck = this.online().decks().find((candidate) => candidate.id === auto.ticket?.deckId)?.name ?? "your deck";
      // A phone has room for less: the result comes as a notification, the rest is in Info.
      const next = this.screen.compact ? "A notification will tell you the result." : "The AI plays it against the next player who joins: a notification will tell you the result.";
      return `You joined ${timeAgo(auto.ticket.since, this.now())} with “${deck}”, ${styleText(auto.ticket.style).name.toLowerCase()}. ${next} ${count}`;
    }
    const intro = this.screen.compact ? AUTO_INTRO.short : AUTO_INTRO.full;
    return [lastTicketText(auto), intro, auto.waiting > 0 ? count : ""].filter((part) => part !== "").join(" ");
  }

  /** @param {import("../../application/auto/AutoListService.js").AutoListState} state */
  #onAutoChange(state) {
    // Joining took a ranked entry; a ticket that closed without a game gave it back.
    if (state.status !== this.#lastAutoStatus && (state.status === AutoListStatus.WAITING || state.closed !== null)) {
      void this.app.entries?.refresh();
    }
    this.#lastAutoStatus = state.status;
    this.rebuild();
  }

  /** How many entries a ranked game takes now, or null when it is free (or not known yet). */
  #perGame() {
    const ranked = this.app.entries?.ranked ?? null;
    return ranked === null || ranked.perGame === 0 ? null : ranked.perGame;
  }
}

/** @param {string} style */
const styleText = (style) => STYLE_TEXT[/** @type {keyof typeof STYLE_TEXT} */ (style)] ?? STYLE_TEXT[AutoStyle.BALANCED];

/**
 * What became of the player's last auto ticket, when the lobby knows ("" otherwise).
 * @param {import("../../application/auto/AutoListService.js").AutoListState} auto
 */
function lastTicketText(auto) {
  if (auto.closed === "season_ended") {
    return "The season ended before an opponent came: your ranked ticket is back.";
  }
  if (auto.closed === "failed") {
    return "Your last auto game could not be played: your ranked ticket is back.";
  }
  return auto.lastGame === null ? "" : "Your auto game has been played: watch it from your notifications or your games.";
}
