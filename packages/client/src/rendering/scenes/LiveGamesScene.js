/**
 * Games being played now, the most watched first: pick one to watch it
 * (docs/tcg/10-spettatori.md). The list is a snapshot; "Refresh" (in the
 * toolbar) asks again.
 */
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { SceneId } from "./sceneIds.js";
import { SectionScene } from "./SectionScene.js";

/**
 * @param {import("../../application/ports/LiveGamesApi.contract.js").LiveGame} game
 */
export function liveGameSubtitle(game) {
  const watching = game.spectators === 1 ? "1 watching" : `${game.spectators} watching`;
  return `${game.mode} · turn ${game.turn} · ${watching}`;
}

export class LiveGamesScene extends SectionScene {
  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return screenLayout(this.services.viewport);
  }

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
    super(services, app, { scene: SceneId.LIVE_GAMES, title: "Watch a game" });
    this.#app = app;
  }

  /** @param {{ back?: string }} [params] `back`: where Back leads (Play by default) */
  enter(params = {}) {
    this.routeBack(params);
    this.#error = null;
    this.#load();
  }

  relayout() {
    this.#rebuild();
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
    this.root.add(new Button({ id: "live.refresh", x: viewport.logicalWidth - this.#screen.header.sideMargin - this.#screen.header.backWidth, y: this.#screen.header.y + 4, width: this.#screen.header.backWidth, height: this.#screen.header.height - 8, text: "Refresh", enabled: !this.#loading, onActivate: () => this.#load() }));
    const width = viewport.logicalWidth - 2 * this.#screen.columns.left.x;
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.left.x, y: this.#screen.columns.top, width, height: this.#screen.columns.height }));
    const status = this.#error === null ? "Spectators see the board, never a hand." : this.#error;
    const compact = this.#screen.compact;
    const listTop = compact ? 46 : 60;
    panel.add(new TextBlock({ id: "live.status", x: this.#screen.inset, y: compact ? 10 : 16, width: width - 2 * this.#screen.inset, height: 30, text: status, size: compact ? "small" : "body", colorKey: this.#error === null ? "textMuted" : "danger" }));
    const list = panel.add(new ScrollList({ id: "live.list", x: this.#screen.inset, y: listTop, width: width - 2 * this.#screen.inset, height: this.#screen.columns.height - listTop - this.#screen.inset }));
    const first = this.#fill(list);
    this.focus(this.findNode(focusedId) ?? first ?? this.backButton);
    this.services.requestRender();
  }

  /**
   * @param {ScrollList} list
   * @returns {OptionRow | null}
   */
  #fill(list) {
    if (this.#games.length === 0) {
      const text = this.#loading ? "Loading…" : "Nobody is playing right now.";
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * this.#screen.row.height, text, size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * this.#screen.row.height;
      return null;
    }
    const rows = this.#games.map((game, index) =>
      list.add(
        new OptionRow({
          id: `live.game.${game.gameId}`,
          x: 0,
          y: this.#screen.rowY(index),
          width: list.rowWidth,
          height: this.#screen.row.height,
          text: game.players.map((player) => `@${player.account}`).join(" vs "),
          subtitle: liveGameSubtitle(game),
          avatar: game.players.map((player) => player.account),
          onActivate: () => this.#watch(game.gameId),
        }),
      ),
    );
    list.contentHeight = this.#screen.rowsHeight(this.#games.length);
    return rows[0];
  }

  #online() {
    if (this.#app.online === undefined) {
      throw new Error("LiveGamesScene needs the online service");
    }
    return this.#app.online;
  }
}
