/**
 * The Season section's screen: the ranked leaderboard of the current
 * season on the left — settled ratings ranked first, then provisional ones
 * (listed with no rank yet), each with the player's profile picture, the
 * player's own line lit and where they stand above it; a line opens that
 * player's season in a dialog (their figures, and the way to their games). On the right, the season's jackpot (the amount, the time
 * left, what each paying place wins and who holds it now), how ranked play
 * works (the entries, a game, the jackpot) and the way into a ranked game:
 * the screen's gold button, or locked with what is missing.
 *
 * On a phone the jackpot is a banner and how ranked works is told in a few
 * words under it (where the player stands is their lit line in the list).
 */
import { AccountStatus } from "../../application/account/AccountService.js";
import { ShopStatus } from "../../application/shop/ShopService.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Icon } from "../ui/icons.js";
import { IconButton } from "../ui/IconButton.js";
import { Label } from "../ui/Label.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { JACKPOT_HEIGHT, JackpotPanel } from "./jackpot/JackpotPanel.js";
import { rankedGuideFor } from "./online/rankedGuideFor.js";
import { standingText } from "./lobby/lobbyText.js";
import { SceneId } from "./sceneIds.js";
import { buildPlayerSeasonDialog } from "./season/PlayerSeasonDialog.js";
import { SectionScene } from "./SectionScene.js";

const LIST_ID = "season.list";
/** The leaderboard's share of the width the two columns share. */
const LIST_SHARE = 0.56;
/** Sizes, wide and compact (a phone in landscape). */
const WIDE = Object.freeze({ titleY: 14, title: 36, standing: 30, listGap: 10, gap: 16, guide: 236, note: 26, button: 56 });
const COMPACT = Object.freeze({ titleY: 6, title: 28, standing: 0, listGap: 6, gap: 6, guide: 0, note: 40, button: 46 });
/** The least room the guide is drawn in, wide and on a phone (a short window leaves it out). */
const GUIDE_MIN = Object.freeze({ wide: 160, compact: 120 });
/** A wide screen's guide: its caption's height, and the most its plates take. */
const GUIDE_CAPTION = 24;
const GUIDE_PLATES = 160;

export class SeasonScene extends SectionScene {
  #app;
  #now;
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** @type {JackpotPanel | null} */
  #jackpotPanel = null;
  /** The player whose season is open in a dialog, or null. @type {string | null} */
  #player = null;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {() => number} [now]
   */
  constructor(services, app, now = () => Date.now()) {
    super(services, app, { scene: SceneId.SEASON, title: "Season" });
    this.#app = app;
    this.#now = now;
  }

  /** @param {Readonly<Record<string, unknown>>} [params] `{ back?: string }`: opened from a screen that said so, Back leads there */
  enter(params = {}) {
    this.routeBack(params);
    const ranking = this.#ranking();
    this.#unsubscribes.push(ranking.subscribe(() => this.#rebuild()));
    ranking.refresh();
    const { jackpot, entries, shop } = this.#app;
    if (jackpot !== undefined) {
      this.#unsubscribes.push(jackpot.subscribe(() => this.#rebuild()), jackpot.watch());
    }
    // How ranked works says what an entry costs (the shop's listing) and how many the player holds.
    if (entries !== undefined) {
      this.#unsubscribes.push(entries.subscribe(() => this.#rebuild()));
    }
    if (shop !== undefined) {
      this.#unsubscribes.push(shop.subscribe(() => this.#rebuild()));
      if (shop.state.listing === null && shop.state.status !== ShopStatus.LOADING) {
        void shop.load();
      }
    }
    this.#rebuild();
  }

  exit() {
    this.#unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#unsubscribes = [];
    this.#jackpotPanel = null;
    this.#player = null;
    super.exit();
  }

  /** @param {number} dtMs */
  update(dtMs) {
    const base = super.update(dtMs);
    return (this.#jackpotPanel?.tick() ?? false) || base;
  }

  relayout() {
    this.#rebuild();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "leaderboard" });
    super.render(context);
  }

  /** The two columns: the leaderboard (the wider), and the jackpot with ranked play. */
  get #frame() {
    const screen = screenLayout(this.services.viewport, { toolbar: false });
    const { left, right } = screen.columns;
    const gap = right.x - left.x - left.width;
    const shared = left.width + right.width;
    const listWidth = Math.round(shared * LIST_SHARE);
    return Object.freeze({
      screen,
      m: screen.compact ? COMPACT : WIDE,
      list: Object.freeze({ x: left.x, width: listWidth }),
      side: Object.freeze({ x: left.x + listWidth + gap, width: shared - listWidth }),
    });
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    if (this.modal !== null) {
      this.closeModal();
    }
    this.root.clear();
    const state = this.#ranking().state;
    this.setHeading({ title: seasonName(state) });
    const first = this.#buildBoard(state);
    const play = this.#buildSide();
    this.focus(this.findNode(focusedId) ?? play ?? first ?? this.backButton);
    this.#showPlayer(state, focusedId);
    this.services.requestRender();
  }

  /**
   * A player's season, from their line: a dialog (kept open across rebuilds while they are on the leaderboard).
   * @param {string} account
   */
  #openPlayer(account) {
    this.#player = account;
    this.#rebuild();
  }

  /**
   * The dialog of the player whose line was opened, when it still applies.
   * @param {import("../../application/ranking/RankingService.js").RankingState} state
   * @param {string} focusedId
   */
  #showPlayer(state, focusedId) {
    const entry = this.#player === null ? undefined : state.leaderboard?.entries.find((candidate) => candidate.account === this.#player);
    if (entry === undefined) {
      this.#player = null;
      return;
    }
    const close = () => {
      this.#player = null;
      this.closeModal();
    };
    const canOpen = this.services.hasScene(SceneId.GAME_HISTORY);
    const onGames = canOpen ? () => this.services.navigate(SceneId.GAME_HISTORY, { account: entry.account, ...this.backHere() }) : null;
    const mine = entry.account === (this.#app.identity?.state.user?.account ?? null);
    const modal = buildPlayerSeasonDialog({ viewport: this.services.viewport, compact: this.#frame.screen.compact, season: seasonName(state), entry, mine, onGames, onClose: close });
    this.openModal(modal);
    const focused = modal.findById(focusedId);
    if (focused !== null && focused.focusable) {
      this.focus(focused);
    }
  }

  /**
   * The leaderboard, with where the player stands above it (on a wide screen).
   * @param {import("../../application/ranking/RankingService.js").RankingState} state
   * @returns {OptionRow | null} the first line
   */
  #buildBoard(state) {
    const { screen, m, list: column } = this.#frame;
    const { columns, inset } = screen;
    const panel = this.root.add(new Panel({ ...screen.panel, x: column.x, y: columns.top, width: column.width, height: columns.height }));
    const width = column.width - 2 * inset;
    panel.add(new Label({ id: "season.title", x: screen.titleInset, y: m.titleY, width: width - 2 * (screen.titleInset - inset), height: m.title, text: "Leaderboard", size: "subheading", weight: "bold", colorKey: "accentLight", align: "left" }));
    let y = m.titleY + m.title + m.listGap;
    if (m.standing > 0) {
      panel.add(new TextBlock({ id: "season.standing", x: inset, y, width, height: m.standing, text: standingText(state), size: "body", colorKey: "text", align: "left" }));
      y += m.standing + m.listGap;
    }
    const list = panel.add(new ScrollList({ id: LIST_ID, x: inset, y, width, height: columns.height - y - inset }));
    return this.#fill(list, state);
  }

  /**
   * @param {ScrollList} list
   * @param {import("../../application/ranking/RankingService.js").RankingState} state
   * @returns {OptionRow | null}
   */
  #fill(list, state) {
    const { screen } = this.#frame;
    const entries = state.leaderboard?.entries ?? [];
    if (entries.length === 0) {
      const text = state.loading ? "Loading…" : "Nobody has played ranked yet this season.";
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * screen.row.height, text, size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * screen.row.height;
      return null;
    }
    const me = this.#app.identity?.state.user?.account ?? null;
    /** @type {OptionRow | null} */
    let first = null;
    entries.forEach((entry, index) => {
      const draws = entry.draws > 0 ? `–${entry.draws}` : "";
      const row = list.add(
        new OptionRow({
          id: `season.row.${index + 1}`,
          x: 0,
          y: screen.rowY(index),
          width: list.rowWidth,
          height: screen.row.height,
          text: entry.rank === null ? `—  @${entry.account}` : `#${entry.rank}  @${entry.account}`,
          subtitle: `rating ${entry.rating}${entry.rank === null ? " (provisional)" : ""} · ${entry.wins}–${entry.losses}${draws} in ${entry.games} game(s)`,
          selected: entry.account === me,
          avatar: entry.account,
          onActivate: () => this.#openPlayer(entry.account),
        }),
      );
      first ??= row;
    });
    list.contentHeight = screen.rowsHeight(entries.length);
    return first;
  }

  /**
   * The jackpot, how ranked works, and the way into a ranked game.
   * @returns {Button | null} Play ranked, when it can be pressed
   */
  #buildSide() {
    const { screen, m, side } = this.#frame;
    const { columns } = screen;
    let y = columns.top;
    y += this.#buildJackpot({ x: side.x, y, width: side.width });
    const bottom = columns.top + columns.height;
    const actionsTop = bottom - m.button - m.note;
    // How ranked works, in the room between the jackpot and Play ranked: in a few words on a phone (the player's
    // standing is their line on the leaderboard, lit).
    const room = actionsTop - m.gap - y;
    this.#buildGuide({ x: side.x, y, width: side.width, height: screen.compact ? room : Math.min(m.guide, room) });
    return this.#buildPlay({ x: side.x, y: actionsTop, width: side.width });
  }

  /**
   * The season's jackpot, when it has one: a card on a wide screen, a banner on a phone.
   * @param {{ x: number, y: number, width: number }} at
   * @returns {number} the height it takes, with the gap below it
   */
  #buildJackpot({ x, y, width }) {
    const service = this.#app.jackpot;
    const jackpot = service?.state.jackpot ?? null;
    if (service === undefined || jackpot === null) {
      this.#jackpotPanel = null;
      return 0;
    }
    const { screen, m } = this.#frame;
    const layout = screen.compact ? "banner" : "card";
    this.#jackpotPanel = this.root.add(new JackpotPanel({ id: "season.jackpot", x, y, width, height: JACKPOT_HEIGHT[layout], jackpot, now: () => service.now(), layout }));
    return JACKPOT_HEIGHT[layout] + m.gap;
  }

  /**
   * How ranked works: under its own header on a wide screen, each step in a few words on a phone.
   * @param {{ x: number, y: number, width: number, height: number }} frame
   */
  #buildGuide(frame) {
    const compact = this.#frame.screen.compact;
    if (frame.height < (compact ? GUIDE_MIN.compact : GUIDE_MIN.wide)) {
      return;
    }
    if (compact) {
      this.root.add(rankedGuideFor(this.#app, { id: "season.guide.steps", ...frame, compact, brief: true }, this.#now()));
      return;
    }
    // As on the Ranked screen: under its caption, each step on a plate of its own.
    this.root.add(new Label({ id: "season.guide.caption", x: frame.x, y: frame.y, width: frame.width, height: GUIDE_CAPTION, text: "HOW RANKED WORKS", size: "tiny", weight: "bold", colorKey: "accent", align: "left", fit: true }));
    const top = frame.y + GUIDE_CAPTION + 4;
    this.root.add(rankedGuideFor(this.#app, { id: "season.guide.steps", x: frame.x, y: top, width: frame.width, height: Math.min(GUIDE_PLATES, frame.y + frame.height - top), compact: false, plates: true }, this.#now()));
  }

  /**
   * Into a ranked game (the lobby, on its Ranked tab): the gold button, or locked with what is missing above it.
   * @param {{ x: number, y: number, width: number }} at
   * @returns {Button | null}
   */
  #buildPlay({ x, y, width }) {
    const { m } = this.#frame;
    const reason = this.#rankedLock();
    const frame = { id: "season.play", x, y: y + m.note, width, height: m.button, keepPlate: true };
    if (reason !== null) {
      this.root.add(new TextBlock({ id: "season.play.note", x, y, width, height: m.note, text: reason, size: "small", colorKey: "textMuted", align: "left" }));
      this.root.add(new IconButton({ ...frame, icon: Icon.LOCK, caption: "Play ranked", enabled: false, onActivate: () => undefined }));
      return null;
    }
    return this.root.add(new Button({ ...frame, text: "Play ranked", variant: "primary", onActivate: () => this.services.navigate(SceneId.RANKED, this.backHere()) }));
  }

  /** Why the player cannot go into a ranked game from here, or null when they can. */
  #rankedLock() {
    if (!this.services.hasScene(SceneId.RANKED)) {
      return "Not available offline.";
    }
    if (this.#app.account?.state.status !== AccountStatus.READY) {
      return "Sign in to play ranked.";
    }
    const standing = this.#ranking().state.standing;
    if (standing !== null && standing.season === null) {
      return "No ranked season is running.";
    }
    if (standing !== null && !standing.eligible) {
      const games = standing.casualGamesNeeded;
      return `Ranked unlocks after ${games} more casual game${games === 1 ? "" : "s"}.`;
    }
    return null;
  }

  #ranking() {
    if (this.#app.ranking === undefined) {
      throw new Error("SeasonScene needs the ranking service");
    }
    return this.#app.ranking;
  }
}

/**
 * The season's name, as the leaderboard or the player's standing gives it ("Season" until either is read).
 * @param {import("../../application/ranking/RankingService.js").RankingState} state
 */
function seasonName(state) {
  return state.leaderboard?.season?.name ?? state.standing?.season?.name ?? "Season";
}
