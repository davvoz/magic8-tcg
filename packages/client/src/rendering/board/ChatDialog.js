/**
 * The chat of an online game, over the board (docs/tcg/28-chat.md): a line
 * to type and Send, quick lines sent with one tap, what was said so far,
 * and muting the others. Under the title, who reads what: the players read
 * each other (and those watching read them); those watching also read one
 * another. A line that did not go says why in that place instead.
 *
 * The board plays on underneath: the scene builds the dialog again with
 * every change, from what it keeps (the line being typed, the scroll).
 * The line to type is at the top, so a phone's keyboard never covers it.
 */
import { BattleLogNode } from "./BattleLogNode.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { PANEL_INSET, SMALL_PANEL_INSET } from "../ui/Panel.js";
import { TextField } from "../ui/TextField.js";

/** One tap, one line: what players and those watching say most. */
const PLAYER_LINES = Object.freeze(["Hello!", "Good luck!", "Nice move!", "Oops!", "Well played!", "Thanks!"]);
const SPECTATOR_LINES = Object.freeze(["Hello!", "Wow!", "Nice move!", "Close game!", "Well played!", "GG"]);

/**
 * @typedef {Readonly<{ width: number, height: number, inset: number, title: number, button: number, close: number, mute: number, send: number, note: number, gap: number }>} ChatMetrics
 */
/** @type {ChatMetrics} */
const WIDE = Object.freeze({ width: 820, height: 470, inset: PANEL_INSET, title: 44, button: 48, close: 110, mute: 110, send: 120, note: 26, gap: 10 });
/** @type {ChatMetrics} */
const COMPACT = Object.freeze({ width: 700, height: 360, inset: SMALL_PANEL_INSET, title: 34, button: 42, close: 92, mute: 92, send: 96, note: 20, gap: 8 });

/**
 * @typedef {Readonly<{ text: string, error: boolean }>} ChatNotice what the line under the title says
 * @param {{
 *   viewport: { logicalWidth: number, logicalHeight: number, compact: boolean },
 *   spectating: boolean, entries: readonly import("./eventLog.js").LogEntry[], scroll: import("./BattleLogNode.js").LogScroll,
 *   draft: string, maxLength: number, notice: ChatNotice | null, muted: boolean, sending: boolean,
 *   onDraft: (text: string) => void, onSend: (text: string) => void, onMute: () => void, onClose: () => void,
 * }} options `entries`: what was said, as log lines; `draft`: the line being typed; `notice`: why the last line did not go (null: who reads what)
 * @returns {Modal}
 */
export function buildChatDialog({ viewport, spectating, entries, scroll, draft, maxLength, notice, muted, sending, onDraft, onSend, onMute, onClose }) {
  const m = viewport.compact ? COMPACT : WIDE;
  const width = Math.min(m.width, viewport.logicalWidth - 20);
  const height = Math.min(m.height, viewport.logicalHeight - 20);
  const modal = new Modal({ id: "chat", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: onClose });
  const { panel } = modal;
  const inner = width - 2 * m.inset;
  let y = m.inset / 2;
  const buttonY = y + (m.title - m.button) / 2;
  panel.add(new Label({ x: m.inset, y, width: inner - m.close - m.mute - 2 * m.gap, height: m.title, text: spectating ? "Chat · watching" : "Chat", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
  panel.add(new Button({ id: "chat.mute", x: m.inset + inner - m.close - m.gap - m.mute, y: buttonY, width: m.mute, height: m.button, text: muted ? "Unmute" : "Mute", textSize: "small", onActivate: onMute }));
  panel.add(new Button({ id: "chat.close", x: m.inset + inner - m.close, y: buttonY, width: m.close, height: m.button, text: "Close", textSize: "small", onActivate: onClose }));
  y += m.title;
  const shown = notice ?? { text: readersOf(spectating, muted), error: false };
  panel.add(new Label({ id: "chat.notice", x: m.inset, y, width: inner, height: m.note, text: shown.text, size: "small", colorKey: shown.error ? "danger" : "textMuted", align: "left", fit: true }));
  y += m.note + m.gap / 2;

  const field = panel.add(
    new TextField({ id: "chat.input", x: m.inset, y, width: inner - m.send - m.gap, height: m.button, value: draft, placeholder: "Say something…", maxLength, characters: "chat", enabled: !sending, onChange: onDraft, onSubmit: () => onSend(field.value) }),
  );
  panel.add(new Button({ id: "chat.send", x: m.inset + inner - m.send, y, width: m.send, height: m.button, text: sending ? "Sending…" : "Send", variant: "primary", enabled: !sending, onActivate: () => onSend(field.value) }));
  y += m.button + m.gap;

  const lines = spectating ? SPECTATOR_LINES : PLAYER_LINES;
  const quickWidth = (inner - (lines.length - 1) * m.gap) / lines.length;
  lines.forEach((line, index) => {
    panel.add(new Button({ id: `chat.quick.${index}`, x: m.inset + index * (quickWidth + m.gap), y, width: quickWidth, height: m.button, text: line, textSize: "small", enabled: !sending, onActivate: () => onSend(line) }));
  });
  y += m.button + m.gap;

  const logHeight = Math.max(0, height - m.inset / 2 - y);
  if (entries.length === 0) {
    panel.add(new Label({ id: "chat.empty", x: m.inset, y, width: inner, height: Math.min(logHeight, m.title), text: "Nothing said yet.", size: "small", colorKey: "textMuted", align: "left" }));
  } else {
    panel.add(new BattleLogNode({ id: "chat.lines", x: m.inset, y, width: inner, height: logHeight, entries, view: scroll }));
  }
  return modal;
}

/**
 * Who reads what is said here.
 * @param {boolean} spectating
 * @param {boolean} muted
 */
function readersOf(spectating, muted) {
  if (muted) {
    return "Muted: you do not see what the others say.";
  }
  return spectating ? "Everyone watching reads you; the players do not." : "Your opponent and anyone watching read you.";
}
