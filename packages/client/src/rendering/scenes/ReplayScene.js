/**
 * Opens the replay of a played auto game (docs/tcg/23-automatica.md): reads
 * it from the server, checks it plays to its recorded end with this game's
 * cards, then hands it to the match board: from the player's seat when it
 * is their game, as they see a game they play; as a spectator sees it
 * otherwise. While it loads, and when it cannot be replayed, this screen
 * says so; Back returns where the player came from.
 */
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Panel } from "../ui/Panel.js";
import { TextBlock } from "../ui/TextBlock.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const PANEL = Object.freeze({ width: 760, height: 280, button: 56 });

export class ReplayScene extends Scene {
  #app;
  /** Where Back (and the board's own Back) lead. @type {string} */
  #from = SceneId.MAIN_MENU;
  /** @type {string | null} */
  #error = null;
  /** Bumped on every entry: a replay that arrives after the player left is dropped. */
  #generation = 0;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#app = app;
  }

  /** @param {Readonly<Record<string, unknown>>} params `{ gameId: string, from?: string }` */
  enter(params) {
    this.#from = typeof params.from === "string" && this.services.hasScene(params.from) ? params.from : SceneId.MAIN_MENU;
    this.#error = null;
    this.#generation += 1;
    this.#rebuild();
    void this.#load(String(params.gameId ?? ""), this.#generation);
  }

  exit() {
    this.#generation += 1;
    super.exit();
  }

  onCancel() {
    this.services.navigate(this.#from);
  }

  relayout() {
    this.#rebuild();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "replay" });
    super.render(context);
  }

  /**
   * @param {string} gameId
   * @param {number} generation
   */
  async #load(gameId, generation) {
    const replays = this.#app.autoReplays;
    const viewer = this.#app.identity?.state.user?.account ?? null;
    const opened = replays === undefined ? null : await replays.open(gameId, { viewer });
    if (generation !== this.#generation) {
      if (opened?.ok) {
        opened.value.session.stop();
      }
      return;
    }
    if (opened === null || !opened.ok) {
      this.#error = opened === null ? "Replays are not available here." : replayErrorText(opened.error);
      this.#rebuild();
      return;
    }
    this.services.navigate(SceneId.MATCH, { session: opened.value.session, againScene: this.#from });
  }

  #rebuild() {
    this.root.clear();
    const { viewport } = this.services;
    const width = Math.min(PANEL.width, viewport.logicalWidth - 32);
    const panel = this.root.add(new Panel({ x: (viewport.logicalWidth - width) / 2, y: (viewport.logicalHeight - PANEL.height) / 2, width, height: PANEL.height, strokeKey: this.#error === null ? undefined : "danger" }));
    const inner = width - 48;
    panel.add(new Label({ x: 24, y: 24, width: inner, height: 44, text: "Auto game replay", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const text = this.#error ?? "Loading the game: the AI plays both decks again, move by move, exactly as it played them…";
    panel.add(new TextBlock({ id: "replay.status", x: 24, y: 82, width: inner, height: 3 * 28, text, size: "body", colorKey: this.#error === null ? "text" : "danger" }));
    const back = panel.add(new Button({ id: "replay.back", x: 24, y: PANEL.height - 24 - PANEL.button, width: inner, height: PANEL.button, text: "Back", variant: "secondary", onActivate: () => this.onCancel() }));
    this.focus(back);
    this.services.requestRender();
  }
}

/**
 * What the player reads when a replay cannot be shown.
 * @param {{ code: string, message: string }} error
 */
export function replayErrorText(error) {
  if (error.code === "NOT_FOUND") {
    return "This game cannot be found.";
  }
  if (error.code === "UNREPLAYABLE" || error.code === "MALFORMED") {
    return `This game cannot be replayed: ${error.message}.`;
  }
  return `The game could not be loaded: ${error.message}. Try again in a moment.`;
}
