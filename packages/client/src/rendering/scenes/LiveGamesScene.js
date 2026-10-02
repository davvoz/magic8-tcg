/**
 * Games being played now, the most watched first: pick one to watch it
 * (docs/tcg/10-spettatori.md). The list is a snapshot; "Refresh" asks again.
 */
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

/**
 * @param {import("../../application/ports/LiveGamesApi.contract.js").LiveGame} game
 */
export function liveGameSubtitle(game) {
  const watching = game.spectators === 1 ? "1 watching" : `${game.spectators} watching`;
  return `${game.mode} · turn ${game.turn} · ${watching}`;
}

export class LiveGamesScene extends Scene {
  #app;
  /** @type {readonly import("../../application/ports/LiveGamesApi.contract.js").LiveGame[]} */
  #games = [];
  #loading = false;
  /** @type {string | null} */
  #error = null;
  /** Bumped on every load: an answer to an older request is dropped. */
  #generation = 0;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#app = app;
  }

  enter() {
    this.#error = null;
    this.#load();
  }

  onCancel() {
    this.services.navigate(SceneId.ONLINE);
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "live" });
    super.render(context);
  }

  async #load() {
    const generation = (this.#generation += 1);
    this.#loading = true;
    this.#rebuild();
    const result = await this.#online().liveGames();
    if (generation !== this.#generation) {
      return;
    }
    this.#loading = false;
    this.#games = result.ok ? result.value : [];
    this.#error = result.ok ? null : result.error.message;
    this.#rebuild();
  }

  /** @param {string} gameId */
  async #watch(gameId) {
    const result = await this.#online().watch(gameId);
    if (!result.ok) {
      this.#error = result.error.message;
      this.#load();
      return;
    }
    this.services.navigate(SceneId.MATCH, { session: result.value, againScene: SceneId.LIVE_GAMES });
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.root.clear();
    const { viewport } = this.services;
    this.root.add(new Label({ x: HEADER.sideMargin, y: HEADER.y, width: 600, height: HEADER.height, text: "Watch a game", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true }));
    const back = this.root.add(new Button({ id: "live.back", x: viewport.logicalWidth - HEADER.sideMargin - HEADER.backWidth, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: "Back", onActivate: () => this.onCancel() }));
    this.root.add(new Button({ id: "live.refresh", x: viewport.logicalWidth - HEADER.sideMargin - 2 * HEADER.backWidth - 16, y: HEADER.y + 4, width: HEADER.backWidth, height: HEADER.height - 8, text: "Refresh", enabled: !this.#loading, onActivate: () => this.#load() }));
    const width = viewport.logicalWidth - 2 * COLUMNS.left.x;
    const panel = this.root.add(new Panel({ x: COLUMNS.left.x, y: COLUMNS.top, width, height: COLUMNS.height }));
    const status = this.#error === null ? "Spectators see the board, never a hand." : this.#error;
    panel.add(new TextBlock({ id: "live.status", x: INSET, y: 16, width: width - 2 * INSET, height: 30, text: status, size: "body", colorKey: this.#error === null ? "textMuted" : "danger" }));
    const list = panel.add(new ScrollList({ id: "live.list", x: INSET, y: 60, width: width - 2 * INSET, height: COLUMNS.height - 60 - INSET }));
    const first = this.#fill(list);
    this.focus(this.root.findById(focusedId) ?? first ?? back);
    this.services.requestRender();
  }

  /**
   * @param {ScrollList} list
   * @returns {OptionRow | null}
   */
  #fill(list) {
    if (this.#games.length === 0) {
      const text = this.#loading ? "Loading…" : "Nobody is playing right now.";
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * ROW.height, text, size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * ROW.height;
      return null;
    }
    const rows = this.#games.map((game, index) =>
      list.add(
        new OptionRow({
          id: `live.game.${game.gameId}`,
          x: 0,
          y: rowY(index),
          width: list.rowWidth,
          height: ROW.height,
          text: game.players.map((player) => `@${player.account}`).join(" vs "),
          subtitle: liveGameSubtitle(game),
          avatar: game.players.map((player) => player.account),
          onActivate: () => this.#watch(game.gameId),
        }),
      ),
    );
    list.contentHeight = rowsHeight(this.#games.length);
    return rows[0];
  }

  #online() {
    if (this.#app.online === undefined) {
      throw new Error("LiveGamesScene needs the online service");
    }
    return this.#app.online;
  }
}
