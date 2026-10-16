/**
 * The settings, opened from the top bar on every screen of the shell: the
 * sound (music and effects levels, muting everything), the way to the Info
 * screen (how the game works), and in small print what the game holds,
 * where custom decks are kept and which release this is — the details a
 * player rarely needs, kept out of the screens themselves.
 */
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { PANEL_INSET, SMALL_PANEL_INSET } from "../ui/Panel.js";
import { SOUND_ROWS, addSoundControls } from "../scenes/audioSettings.js";
import { aboutLines } from "./aboutLines.js";

/**
 * @typedef {Readonly<{ width: number, inset: number, title: number, gap: number, button: number, line: number, lineSize: import("../theme/Theme.js").FontSize }>} SettingsMetrics
 */
/** @type {SettingsMetrics} */
const WIDE = Object.freeze({ width: 640, inset: PANEL_INSET, title: 44, gap: 14, button: 52, line: 26, lineSize: "small" });
/** @type {SettingsMetrics} */
const COMPACT = Object.freeze({ width: 600, inset: SMALL_PANEL_INSET, title: 34, gap: 8, button: 46, line: 18, lineSize: "tiny" });
/** What a compact dialog keeps from the screen's edges. */
const COMPACT_MARGIN = 12;

/**
 * @param {{
 *   viewport: { logicalWidth: number, logicalHeight: number, compact?: boolean, designArea?: { width: number } },
 *   app: import("../../application/AppContext.js").AppContext,
 *   openInfo: (() => void) | null,
 *   onClose: () => void,
 *   requestRender: () => void,
 * }} request `openInfo`: opens the Info screen (null: there is none here)
 * @returns {{ modal: Modal, refresh: () => void }} `refresh`: shows the sound settings as they now stand (muted from elsewhere)
 */
export function buildSettingsDialog({ viewport, app, openInfo, onClose, requestRender }) {
  const compact = viewport.compact === true;
  const m = compact ? COMPACT : WIDE;
  const screenWidth = viewport.designArea?.width ?? viewport.logicalWidth;
  const width = compact ? Math.min(m.width, screenWidth - 2 * COMPACT_MARGIN) : m.width;
  const inner = width - 2 * m.inset;
  const audio = app.audio;
  const rows = compact ? SOUND_ROWS.compact : SOUND_ROWS.wide;
  const lines = aboutLines(app);
  const soundTop = m.inset + m.title + m.gap;
  const soundHeight = audio === undefined ? 0 : 2 * rows.row;
  const buttonsY = soundTop + soundHeight + m.gap;
  const linesY = buttonsY + m.button + m.gap;
  const height = linesY + lines.length * m.line + m.inset;
  const modal = new Modal({ id: "settings", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: onClose });
  const { panel } = modal;
  panel.add(new Label({ x: m.inset, y: m.inset, width: inner, height: m.title, text: "Settings", size: "heading", weight: "bold", colorKey: "accentLight", fit: true }));
  const sound = audio === undefined ? null : addSoundControls(panel, { x: m.inset, y: soundTop, width: inner, metrics: rows, audio, requestRender });
  const buttons = [
    ...(sound === null ? [] : [sound.mute]),
    new Button({ id: "settings.info", text: "Info", enabled: openInfo !== null, onActivate: () => openInfo?.() }),
    new Button({ id: "settings.close", text: "Close", variant: "primary", onActivate: onClose }),
  ];
  const buttonWidth = (inner - (buttons.length - 1) * m.gap) / buttons.length;
  buttons.forEach((button, index) => {
    Object.assign(button, { x: m.inset + index * (buttonWidth + m.gap), y: buttonsY, width: buttonWidth, height: m.button });
    panel.add(button);
  });
  lines.forEach((text, index) => {
    panel.add(new Label({ id: `settings.about.${index}`, x: m.inset, y: linesY + index * m.line, width: inner, height: m.line, text, size: m.lineSize, colorKey: index === lines.length - 1 ? "disabledText" : "textMuted", fit: true }));
  });
  return { modal, refresh: sound?.refresh ?? (() => undefined) };
}
