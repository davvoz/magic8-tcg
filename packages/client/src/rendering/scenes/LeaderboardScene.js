/**
 * The ranked leaderboard of the current season: settled ratings ranked
 * first, then provisional ones (listed with no rank yet), each with the
 * player's profile picture, the player's own line highlighted and their
 * standing above. When the season has a jackpot, it heads the screen: the
 * amount, the countdown to the season's end, and what each paying place
 * wins and who holds it now. A line opens that player's games; "My games"
 * the player's own.
 */
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { JACKPOT_HEIGHT, JackpotPanel } from "./jackpot/JackpotPanel.js";
import { standingText } from "./OnlineScene.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

export class LeaderboardScene extends Scene {
  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return screenLayout(this.services.viewport);
  }

  #app;
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** Where Back leads: the lobby, or the menu when the jackpot there opened this screen. @type {string} */
  #back = SceneId.ONLINE;
  /** @type {JackpotPanel | null} */
  #jackpotPanel = null;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#app = app;
  }

  /** @param {{ back?: string }} [params] */
  enter(params) {
    this.#back = params?.back ?? SceneId.ONLINE;
    const ranking = this.#ranking();
    this.#unsubscribes.push(ranking.subscribe(() => this.#rebuild()));
    ranking.refresh();
    const jackpot = this.#app.jackpot;
    if (jackpot !== undefined) {
      this.#unsubscribes.push(jackpot.subscribe(() => this.#rebuild()), jackpot.watch());
    }
    this.#rebuild();
  }

  exit() {
    this.#unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#unsubscribes = [];
    this.#jackpotPanel = null;
    super.exit();
  }

  onCancel() {
    this.services.navigate(this.#back);
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

  #rebuild() {
    this.root.clear();
    const { viewport } = this.services;
    const state = this.#ranking().state;
    const season = state.leaderboard?.season?.name ?? state.standing?.season?.name ?? null;
    const back = this.#buildHeader(season);
    const width = viewport.logicalWidth - 2 * this.#screen.columns.left.x;
    const compact = this.#screen.compact;
    const jackpotHeight = this.#buildJackpot(width);
    const top = this.#screen.columns.top + jackpotHeight;
    const height = this.#screen.columns.height - jackpotHeight;
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.left.x, y: top, width, height }));
    const listTop = compact ? 46 : 60;
    panel.add(new TextBlock({ id: "leaderboard.standing", x: this.#screen.inset, y: compact ? 10 : 16, width: width - 2 * this.#screen.inset, height: 30, text: standingText(state), size: compact ? "small" : "body", colorKey: "text" }));
    const list = panel.add(new ScrollList({ id: "leaderboard.list", x: this.#screen.inset, y: listTop, width: width - 2 * this.#screen.inset, height: height - listTop - this.#screen.inset }));
    this.#fill(list, state);
    this.focus(back);
    this.services.requestRender();
  }

  /**
   * The title, Back and, when the history screen exists, "My games".
   * @param {string | null} season
   * @returns {Button} Back
   */
  #buildHeader(season) {
    const { viewport } = this.services;
    const history = this.services.hasScene(SceneId.GAME_HISTORY);
    const buttons = history ? 2 : 1;
    const titleWidth = Math.min(900, viewport.logicalWidth - 2 * this.#screen.header.sideMargin - buttons * (this.#screen.header.backWidth + 16));
    this.root.add(new Label({ x: this.#screen.header.sideMargin, y: this.#screen.header.y, width: titleWidth, height: this.#screen.header.height, text: season === null ? "Leaderboard" : `Leaderboard — ${season}`, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true, fit: true }));
    const back = this.root.add(new Button({ id: "leaderboard.back", x: viewport.logicalWidth - this.#screen.header.sideMargin - this.#screen.header.backWidth, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: "Back", onActivate: () => this.onCancel() }));
    if (history) {
      this.root.add(new Button({ id: "leaderboard.history", x: viewport.logicalWidth - this.#screen.header.sideMargin - 2 * this.#screen.header.backWidth - 16, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: "My games", onActivate: () => this.#openHistory() }));
    }
    return back;
  }

  /**
   * The season's jackpot across the top of the screen, when it has one.
   * @param {number} width
   * @returns {number} the height it takes, with the gap below it
   */
  #buildJackpot(width) {
    const service = this.#app.jackpot;
    const jackpot = service?.state.jackpot ?? null;
    if (service === undefined || jackpot === null) {
      this.#jackpotPanel = null;
      return 0;
    }
    const layout = this.#screen.compact ? "banner" : "wide";
    const gap = this.#screen.compact ? 6 : 16;
    this.#jackpotPanel = this.root.add(new JackpotPanel({ x: this.#screen.columns.left.x, y: this.#screen.columns.top, width, height: JACKPOT_HEIGHT[layout], jackpot, now: () => service.now(), layout }));
    return JACKPOT_HEIGHT[layout] + gap;
  }

  /**
   * @param {ScrollList} list
   * @param {import("../../application/ranking/RankingService.js").RankingState} state
   */
  #fill(list, state) {
    const entries = state.leaderboard?.entries ?? [];
    if (entries.length === 0) {
      const text = state.loading ? "Loading…" : "Nobody has played ranked yet this season.";
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * this.#screen.row.height, text, size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * this.#screen.row.height;
      return;
    }
    const me = this.#app.identity?.state.user?.account ?? null;
    entries.forEach((entry, index) => {
      const draws = entry.draws > 0 ? `–${entry.draws}` : "";
      list.add(
        new OptionRow({
          id: `leaderboard.row.${index + 1}`,
          x: 0,
          y: this.#screen.rowY(index),
          width: list.rowWidth,
          height: this.#screen.row.height,
          text: entry.rank === null ? `—  @${entry.account}` : `#${entry.rank}  @${entry.account}`,
          subtitle: `rating ${entry.rating}${entry.rank === null ? " (provisional)" : ""} · ${entry.wins}–${entry.losses}${draws} in ${entry.games} game(s)`,
          selected: entry.account === me,
          avatar: entry.account,
          onActivate: () => this.#openHistory(entry.account),
        }),
      );
    });
    list.contentHeight = this.#screen.rowsHeight(entries.length);
  }

  /**
   * A player's games (the signed-in player's when none is given); Back returns here, as this screen was opened.
   * @param {string} [account]
   */
  #openHistory(account) {
    if (this.services.hasScene(SceneId.GAME_HISTORY)) {
      this.services.navigate(SceneId.GAME_HISTORY, { ...(account === undefined ? {} : { account }), back: SceneId.LEADERBOARD, backParams: { back: this.#back } });
    }
  }

  #ranking() {
    if (this.#app.ranking === undefined) {
      throw new Error("LeaderboardScene needs the ranking service");
    }
    return this.#app.ranking;
  }
}
