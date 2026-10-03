/**
 * The sound settings, as a modal any scene can open: the music and the
 * effects each turned down and up a step at a time, muting everything, and
 * closing. Each change is heard at once — the music follows, and a tick is
 * played at the effects' new level — and saved by the audio service.
 */
import { SoundCue } from "../../application/audio/SoundCue.js";
import { AudioChannel } from "../../application/audio/AudioSettings.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { PANEL_INSET } from "../ui/Panel.js";

const WIDE = Object.freeze({ width: 600, height: 340, title: 44, row: 56, rowTop: 84, step: 64, value: 96, button: 52, gap: 14 });
const COMPACT = Object.freeze({ width: 520, height: 300, title: 38, row: 50, rowTop: 66, step: 56, value: 84, button: 46, gap: 10 });
const ROWS = Object.freeze([
  { channel: AudioChannel.MUSIC, label: "Music" },
  { channel: AudioChannel.EFFECTS, label: "Effects" },
]);

/**
 * @typedef {{
 *   settings: import("../../application/audio/AudioSettings.js").AudioSettings,
 *   step: (channel: string, direction: number) => void,
 *   toggleMute: () => void,
 *   play: (cue: string) => unknown,
 * }} AudioControls the AudioService, as the modal uses it
 */

/**
 * @param {{ viewport: { logicalWidth: number, logicalHeight: number, compact?: boolean }, audio: AudioControls, onClose: () => void, requestRender: () => void }} request
 * @returns {Modal}
 */
export function buildAudioSettingsModal({ viewport, audio, onClose, requestRender }) {
  const size = viewport.compact ? COMPACT : WIDE;
  const modal = new Modal({ id: "audio", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: size.width, panelHeight: size.height, onDismiss: onClose });
  const { panel } = modal;
  const width = size.width - 2 * PANEL_INSET;
  panel.add(new Label({ x: PANEL_INSET, y: PANEL_INSET, width, height: size.title, text: "Sound", size: "heading", weight: "bold", colorKey: "accentLight", fit: true }));
  const buttonWidth = (width - size.gap) / 2;
  const buttonsY = size.height - PANEL_INSET - size.button;
  /** @type {Map<string, Label>} */
  const values = new Map();
  const mute = new Button({ id: "audio.mute", x: PANEL_INSET, y: buttonsY, width: buttonWidth, height: size.button, text: "", onActivate: () => {
    audio.toggleMute();
    refresh();
  } });
  /** The levels and the mute button's label, as the settings now stand. */
  const refresh = () => {
    const { settings } = audio;
    for (const [channel, label] of values) {
      label.text = settings.muted ? "Muted" : percent(levelOf(settings, channel));
    }
    mute.text = settings.muted ? "Unmute" : "Mute all";
    requestRender();
  };
  ROWS.forEach(({ channel, label }, index) => {
    const y = size.rowTop + index * size.row;
    const height = size.row - 8;
    const controlsX = PANEL_INSET + width - (2 * size.step + size.value);
    // The effects' own buttons are silent: the tick after the change is heard at the new level instead.
    const cue = channel === AudioChannel.EFFECTS ? null : SoundCue.UI_CLICK;
    const change = (/** @type {number} */ direction) => {
      audio.step(channel, direction);
      refresh();
      if (channel === AudioChannel.EFFECTS) {
        audio.play(SoundCue.UI_SELECT);
      }
    };
    panel.add(new Label({ x: PANEL_INSET, y, width: controlsX - PANEL_INSET, height, text: label, size: "body", align: "left", fit: true }));
    panel.add(new Button({ id: `audio.${channel}.down`, x: controlsX, y, width: size.step, height, text: "−", textSize: "small", cue, onActivate: () => change(-1) }));
    values.set(channel, panel.add(new Label({ id: `audio.${channel}.value`, x: controlsX + size.step, y, width: size.value, height, text: "", size: "body", weight: "bold", colorKey: "accent" })));
    panel.add(new Button({ id: `audio.${channel}.up`, x: controlsX + size.step + size.value, y, width: size.step, height, text: "+", textSize: "small", cue, onActivate: () => change(1) }));
  });
  panel.add(mute);
  panel.add(new Button({ id: "audio.close", x: PANEL_INSET + buttonWidth + size.gap, y: buttonsY, width: buttonWidth, height: size.button, text: "Close", variant: "primary", onActivate: onClose }));
  refresh();
  return modal;
}

/**
 * @param {import("../../application/audio/AudioSettings.js").AudioSettings} settings
 * @param {string} channel an AudioChannel
 */
function levelOf(settings, channel) {
  return channel === AudioChannel.MUSIC ? settings.music : settings.effects;
}

/** @param {number} level 0–1 */
function percent(level) {
  return `${Math.round(level * 100)}%`;
}
