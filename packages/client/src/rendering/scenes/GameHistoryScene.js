/**
 * The games a player has played, newest first: who they faced, how it went,
 * the mode, how long it lasted and when. The signed-in player's own by
 * default; a leaderboard line opens that player's. Older games load a page
 * at a time from the last line.
 */
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { OptionRow } from "../ui/OptionRow.js";
import { Panel } from "../ui/Panel.js";
import { ScrollList } from "../ui/ScrollList.js";
import { TextBlock } from "../ui/TextBlock.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { timeAgo } from "./NotificationsScene.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const RESULT_TEXT = Object.freeze({ win: "Won", loss: "Lost", draw: "Draw" });
const END_TEXT = Object.freeze({ life_depleted: "life depleted", concede: "conceded", draw: "draw" });

/**
 * "Won vs @bob".
 * @param {import("../../application/ports/GameHistoryApi.contract.js").PlayedGame} game
 */
export function playedGameTitle(game) {
  return `${RESULT_TEXT[game.result]} vs @${game.opponent}`;
}

/**
 * "ranked · 7 turns · conceded · 2 h ago".
 * @param {import("../../application/ports/GameHistoryApi.contract.js").PlayedGame} game
 * @param {number} now
 */
export function playedGameSubtitle(game, now) {
  const turns = game.turn === 1 ? "1 turn" : `${game.turn} turns`;
  const end = game.endReason === null || game.result === "draw" ? [] : [END_TEXT[/** @type {keyof typeof END_TEXT} */ (game.endReason)] ?? game.endReason];
  return [game.mode, turns, ...end, timeAgo(game.finishedAt, now)].join(" · ");
}

/**
 * "12 games · 7–4–1", over the games loaded so far ("12+ games" while older ones remain).
 * @param {readonly import("../../application/ports/GameHistoryApi.contract.js").PlayedGame[]} games
 * @param {boolean} more
 */
export function historySummary(games, more) {
  const count = (result) => games.filter((game) => game.result === result).length;
  const draws = count("draw") > 0 ? `–${count("draw")}` : "";
  const noun = games.length === 1 && !more ? "game" : "games";
  return `${games.length}${more ? "+" : ""} ${noun} · ${count("win")}–${count("loss")}${draws}`;
}

export class GameHistoryScene extends Scene {
  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return screenLayout(this.services.viewport);
  }

  #app;
  #now;
  /** Whose games: an account, or null when nobody is signed in and none was asked for. @type {string | null} */
  #account = null;
  /** Where Back leads, and with what. @type {{ scene: string, params?: object }} */
  #back = { scene: SceneId.ONLINE };
  /** @type {readonly import("../../application/ports/GameHistoryApi.contract.js").PlayedGame[]} */
  #games = [];
  /** @type {string | null} */
  #next = null;
  #loading = false;
  /** @type {string | null} */
  #error = null;
  /** Bumped on every fresh load: an answer to an older request is dropped. */
  #generation = 0;

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

  /** @param {{ account?: string, back?: string, backParams?: object }} [params] `backParams` what the screen Back leads to is opened with */
  enter(params) {
    this.#account = params?.account ?? this.#app.identity?.state.user?.account ?? null;
    this.#back = { scene: params?.back ?? SceneId.ONLINE, params: params?.backParams };
    this.#games = [];
    this.#next = null;
    this.#error = null;
    this.#load(null);
  }

  onCancel() {
    this.services.navigate(this.#back.scene, this.#back.params);
  }

  relayout() {
    this.#rebuild();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "history" });
    super.render(context);
  }

  /** @param {string | null} before null for the newest games, else the page after them */
  async #load(before) {
    if (this.#account === null) {
      this.#rebuild();
      return;
    }
    if (before === null) {
      this.#generation += 1;
    }
    const generation = this.#generation;
    this.#loading = true;
    this.#rebuild();
    const result = await this.#api().played(this.#account, before);
    if (generation !== this.#generation) {
      return;
    }
    this.#loading = false;
    if (result.ok) {
      this.#games = before === null ? result.value.games : [...this.#games, ...result.value.games];
      this.#next = result.value.next;
      this.#error = null;
    } else {
      this.#error = result.error.message;
    }
    this.#rebuild();
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.root.clear();
    const { viewport } = this.services;
    const header = this.#screen.header;
    const titleWidth = Math.min(900, viewport.logicalWidth - 2 * header.sideMargin - header.backWidth - 16);
    const title = this.#account === null ? "Games" : `Games — @${this.#account}`;
    this.root.add(new Label({ x: header.sideMargin, y: header.y, width: titleWidth, height: header.height, text: title, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true, fit: true }));
    const back = this.root.add(new Button({ id: "history.back", x: viewport.logicalWidth - header.sideMargin - header.backWidth, y: header.y + 4, width: header.backWidth, height: header.height - 8, text: "Back", onActivate: () => this.onCancel() }));
    const width = viewport.logicalWidth - 2 * this.#screen.columns.left.x;
    const panel = this.root.add(new Panel({ ...this.#screen.panel, x: this.#screen.columns.left.x, y: this.#screen.columns.top, width, height: this.#screen.columns.height }));
    const compact = this.#screen.compact;
    const listTop = compact ? 46 : 60;
    panel.add(new TextBlock({ id: "history.status", x: this.#screen.inset, y: compact ? 10 : 16, width: width - 2 * this.#screen.inset, height: 30, text: this.#status(), size: compact ? "small" : "body", colorKey: this.#error === null ? "text" : "danger" }));
    const list = panel.add(new ScrollList({ id: "history.list", x: this.#screen.inset, y: listTop, width: width - 2 * this.#screen.inset, height: this.#screen.columns.height - listTop - this.#screen.inset }));
    this.#fill(list);
    this.focus(this.root.findById(focusedId) ?? back);
    this.services.requestRender();
  }

  #status() {
    if (this.#error !== null) {
      return this.#error;
    }
    if (this.#account === null) {
      return "Sign in to see your games.";
    }
    return this.#games.length === 0 ? "" : historySummary(this.#games, this.#next !== null);
  }

  /** @param {ScrollList} list */
  #fill(list) {
    const row = this.#screen.row.height;
    if (this.#games.length === 0) {
      const text = this.#loading ? "Loading…" : "No games played yet.";
      list.add(new TextBlock({ x: 0, y: 0, width: list.rowWidth, height: 2 * row, text: this.#account === null ? "" : text, size: "small", colorKey: "textMuted" }));
      list.contentHeight = 2 * row;
      return;
    }
    const now = this.#now();
    this.#games.forEach((game, index) => {
      list.add(
        new OptionRow({
          id: `history.game.${game.gameId}`,
          x: 0,
          y: this.#screen.rowY(index),
          width: list.rowWidth,
          height: row,
          text: playedGameTitle(game),
          subtitle: playedGameSubtitle(game, now),
          avatar: game.opponent,
          onActivate: () => undefined,
        }),
      );
    });
    const rows = this.#games.length + (this.#next === null ? 0 : 1);
    if (this.#next !== null) {
      const next = this.#next;
      list.add(new Button({ id: "history.more", x: 0, y: this.#screen.rowY(this.#games.length), width: list.rowWidth, height: row, text: this.#loading ? "Loading…" : "Show older games", variant: "secondary", enabled: !this.#loading, onActivate: () => this.#load(next) }));
    }
    list.contentHeight = this.#screen.rowsHeight(rows);
  }

  #api() {
    if (this.#app.gameHistory === undefined) {
      throw new Error("GameHistoryScene needs the game history api");
    }
    return this.#app.gameHistory;
  }
}
