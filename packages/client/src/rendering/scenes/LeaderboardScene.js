/**
 * The ranked leaderboard of the current season: settled ratings ranked
 * first, then provisional ones (listed with no rank yet), with the
 * player's own line highlighted and their standing above.
 */
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { COLUMNS, HEADER, INSET, ROW, rowY, rowsHeight } from "./deckBuilder/layout.js";
import { standingText } from "./OnlineScene.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

export class LeaderboardScene extends Scene {
  #app;
  /** @type {(() => void) | null} */
  #unsubscribe = null;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#app = app;
  }

  enter() {
    const ranking = this.#ranking();
    this.#unsubscribe = ranking.subscribe(() => this.#rebuild());
    ranking.refresh();
    this.#rebuild();
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.exit();
  }

  onCancel() {
    this.services.navigate(SceneId.ONLINE);
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
    this.root.add(new Label({ x: HEADER.sideMargin, y: HEADER.y, width: 900, height: HEADER.height, text: season === null ? "Leaderboard" : `Leaderboard — ${season}`, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const back = this.root.add(new Button({ id: "leaderboard.back", x: viewport.logicalWidth - HEADER.sideMargin - HEADER.backWidth, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: "Back", onActivate: () => this.onCancel() }));
    const width = viewport.logicalWidth - 2 * COLUMNS.left.x;
    const panel = this.root.add(new Panel({ x: COLUMNS.left.x, y: COLUMNS.top, width, height: COLUMNS.height }));
    panel.add(new TextBlock({ id: "leaderboard.standing", x: INSET, y: 16, width: width - 2 * INSET, height: 30, text: standingText(state), size: "body", colorKey: "text" }));
    const list = panel.add(new ScrollList({ id: "leaderboard.list", x: INSET, y: 60, width: width - 2 * INSET, height: COLUMNS.height - 60 - INSET }));
    this.#fill(list, state);
    this.focus(back);
    this.services.requestRender();
  }

  /**
   * @param {ScrollList} list
   * @param {import("../../application/ranking/RankingService.js").RankingState} state
   */
  #fill(list, state) {
    const entries = state.leaderboard?.entries ?? [];
    if (entries.length === 0) {
      const text = state.loading ? "Loading…" : "Nobody has played ranked yet this season.";
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * ROW.height, text, size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * ROW.height;
      return;
    }
    const me = this.#app.identity?.state.user?.account ?? null;
    entries.forEach((entry, index) => {
      const draws = entry.draws > 0 ? `–${entry.draws}` : "";
      list.add(
        new OptionRow({
          id: `leaderboard.row.${index + 1}`,
          x: 0,
          y: rowY(index),
          width: list.rowWidth,
          height: ROW.height,
          text: entry.rank === null ? `—  @${entry.account}` : `#${entry.rank}  @${entry.account}`,
          subtitle: `rating ${entry.rating}${entry.rank === null ? " (provisional)" : ""} · ${entry.wins}–${entry.losses}${draws} in ${entry.games} game(s)`,
          selected: entry.account === me,
          onActivate: () => undefined,
        }),
      );
    });
    list.contentHeight = rowsHeight(entries.length);
  }

  #ranking() {
    if (this.#app.ranking === undefined) {
      throw new Error("LeaderboardScene needs the ranking service");
    }
    return this.#app.ranking;
  }
}
