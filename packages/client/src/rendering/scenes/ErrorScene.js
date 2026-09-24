/**
 * Shown when the game cannot continue (content failed to load, storage
 * unusable in a way that blocks play). Renders the message; nothing else.
 */
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Label } from "../ui/Label.js";
import { Panel } from "../ui/Panel.js";
import { Scene } from "./Scene.js";

export class ErrorScene extends Scene {
  /** @param {Readonly<Record<string, unknown>>} params `{ title?: string, message?: string }` */
  enter(params) {
    const { viewport } = this.services;
    const width = 900;
    const height = 260;
    const panel = this.root.add(new Panel({ x: (viewport.logicalWidth - width) / 2, y: (viewport.logicalHeight - height) / 2, width, height, strokeKey: "danger" }));
    panel.add(new Label({ x: 0, y: 40, width, height: 60, text: String(params.title ?? "Something went wrong"), size: "heading", weight: "bold", colorKey: "danger" }));
    panel.add(new Label({ x: 0, y: 130, width, height: 40, text: String(params.message ?? ""), size: "body", colorKey: "textMuted" }));
    panel.add(new Label({ x: 0, y: 190, width, height: 30, text: "Reload the page to try again.", size: "small", colorKey: "textMuted" }));
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "error", motes: false });
    super.render(context);
  }
}
