/**
 * The request for the active key a transfer needs (ActiveKeyPrompt,
 * docs/tcg/20-chiavi.md), shown over the screen the player pays on, above
 * its own modals (Scene.showOverlay), for as long as the request is open.
 *
 * - No key saved: the active key, and an optional PIN to save it with in
 *   this browser (left empty, the key is kept for this visit only).
 * - A key saved: its PIN, or "Use another key" (which forgets the saved one).
 *
 * The screen starts it on entry and stops it on exit; leaving the screen
 * cancels an open request (the transfer is not sent).
 */
import { ActiveKeyStatus } from "../../application/wallet/ActiveKeyPrompt.js";
import { MIN_PIN_LENGTH } from "../../application/ports/LocalKeys.contract.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { PANEL_INSET } from "../ui/Panel.js";
import { TextBlock } from "../ui/TextBlock.js";
import { TextField } from "../ui/TextField.js";

const SIZE = Object.freeze({ width: 660, height: 384 });
const INSET = PANEL_INSET;
const ROW = Object.freeze({ title: 40, message: 54, field: 50, gap: 8, button: 50 });
const KEY_MAX_LENGTH = 60;
const PIN_MAX_LENGTH = 64;

/**
 * @typedef {{
 *   services: import("./Scene.js").SceneServices,
 *   showOverlay: (modal: Modal) => void,
 *   hideOverlay: () => void,
 *   focus: (node: import("../ui/UiNode.js").UiNode | null) => void,
 * }} DialogHost the scene the dialog shows over
 */

export class ActiveKeyDialog {
  #host;
  #prompt;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** @type {TextField | null} */
  #key = null;
  /** @type {TextField | null} */
  #pin = null;
  #shown = false;

  /**
   * @param {DialogHost} host
   * @param {import("../../application/wallet/ActiveKeyPrompt.js").ActiveKeyPrompt} prompt
   */
  constructor(host, prompt) {
    this.#host = host;
    this.#prompt = prompt;
  }

  start() {
    this.#unsubscribe = this.#prompt.subscribe((state) => this.#show(state));
    this.#show(this.#prompt.state);
  }

  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#prompt.cancel();
    this.#hide();
  }

  /** The screen was laid out again: the dialog too, keeping what was typed. */
  relayout() {
    if (this.#shown) {
      this.#show(this.#prompt.state);
    }
  }

  /** @param {import("../../application/wallet/ActiveKeyPrompt.js").ActiveKeyState} state */
  #show(state) {
    if (state.status === ActiveKeyStatus.IDLE || state.account === null) {
      this.#hide();
      return;
    }
    const checking = state.status === ActiveKeyStatus.CHECKING;
    // A wrong answer clears the PIN; the key stays, to be corrected.
    const typedKey = this.#key?.value ?? "";
    const typedPin = checking ? (this.#pin?.value ?? "") : "";
    this.#host.showOverlay(state.saved ? this.#buildUnlock(state, typedPin, checking) : this.#buildKeyEntry(state, typedKey, typedPin, checking));
    this.#shown = true;
  }

  #hide() {
    if (this.#shown) {
      this.#shown = false;
      this.#key = null;
      this.#pin = null;
      this.#host.hideOverlay();
    }
  }

  /**
   * @param {import("../../application/wallet/ActiveKeyPrompt.js").ActiveKeyState} state
   * @param {string} typedKey
   * @param {string} typedPin
   * @param {boolean} checking
   */
  #buildKeyEntry(state, typedKey, typedPin, checking) {
    const { modal, panel, width, y } = this.#frame(`Sending STEEM from @${state.account} needs its active key. It is checked on the chain and stays in this browser.`);
    this.#key = panel.add(
      new TextField({ id: "activeKey.key", x: INSET, y, width, height: ROW.field, value: typedKey, placeholder: "Private active key (starts with 5)", maxLength: KEY_MAX_LENGTH, keyboard: "secret", enabled: !checking, onSubmit: () => this.#focusPin() }),
    );
    this.#pin = panel.add(
      new TextField({ id: "activeKey.pin", x: INSET, y: y + ROW.field + ROW.gap, width, height: ROW.field, value: typedPin, placeholder: `PIN to save it here (optional, ${MIN_PIN_LENGTH}+ characters)`, maxLength: PIN_MAX_LENGTH, keyboard: "secret", enabled: !checking, onSubmit: () => this.#submitKey() }),
    );
    panel.add(statusLine(state, checking, { y: y + 2 * (ROW.field + ROW.gap), width, hint: "Without a PIN the key is forgotten when you close the game." }));
    this.#addButtons(panel, checking, [
      { id: "activeKey.cancel", text: "Cancel", onActivate: () => this.#prompt.cancel() },
      { id: "activeKey.confirm", text: "Confirm", variant: "primary", onActivate: () => this.#submitKey() },
    ]);
    return modal;
  }

  /**
   * @param {import("../../application/wallet/ActiveKeyPrompt.js").ActiveKeyState} state
   * @param {string} typedPin
   * @param {boolean} checking
   */
  #buildUnlock(state, typedPin, checking) {
    this.#key = null;
    const { modal, panel, width, y } = this.#frame(`Sending STEEM from @${state.account} needs its active key. Enter the PIN that protects the one saved in this browser.`);
    this.#pin = panel.add(new TextField({ id: "activeKey.pin", x: INSET, y, width, height: ROW.field, value: typedPin, placeholder: "PIN", maxLength: PIN_MAX_LENGTH, keyboard: "secret", enabled: !checking, onSubmit: () => this.#submitPin() }));
    panel.add(statusLine(state, checking, { y: y + ROW.field + ROW.gap, width, hint: "" }));
    this.#addButtons(panel, checking, [
      { id: "activeKey.cancel", text: "Cancel", onActivate: () => this.#prompt.cancel() },
      { id: "activeKey.forget", text: "Use another key", onActivate: () => this.#prompt.forgetSaved() },
      { id: "activeKey.unlock", text: "Unlock", variant: "primary", onActivate: () => this.#submitPin() },
    ]);
    return modal;
  }

  /**
   * The modal, its title and what is asked.
   * @param {string} message
   */
  #frame(message) {
    const { viewport } = this.#host.services;
    const modal = new Modal({ id: "activeKey", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: SIZE.width, panelHeight: SIZE.height, onDismiss: () => this.#prompt.cancel() });
    const { panel } = modal;
    const width = SIZE.width - 2 * INSET;
    const top = viewport.compact ? 14 : INSET - 10;
    panel.add(new Label({ x: INSET, y: top, width, height: ROW.title, text: "Active key needed", size: "heading", weight: "bold", colorKey: "accentLight", fit: true }));
    panel.add(new TextBlock({ x: INSET, y: top + ROW.title + 4, width, height: ROW.message, text: message, size: "small", colorKey: "textMuted" }));
    return { modal, panel, width, y: top + ROW.title + ROW.message + 12 };
  }

  /**
   * Side by side along the bottom of the panel.
   * @param {import("../ui/Panel.js").Panel} panel
   * @param {boolean} checking
   * @param {{ id: string, text: string, variant?: import("../ui/Button.js").ButtonVariant, onActivate: () => void }[]} buttons
   */
  #addButtons(panel, checking, buttons) {
    const gap = 14;
    const width = (SIZE.width - 2 * INSET - gap * (buttons.length - 1)) / buttons.length;
    const y = SIZE.height - INSET - ROW.button + 10;
    buttons.forEach((button, index) => {
      // Cancel stays available while the key is checked: the transfer is not sent until the check is over.
      panel.add(new Button({ ...button, x: INSET + index * (width + gap), y, width, height: ROW.button, enabled: !checking || index === 0 }));
    });
  }

  /** Enter in the key field: on to the (optional) PIN. */
  #focusPin() {
    if (this.#key !== null && this.#key.value.length > 0 && this.#pin !== null) {
      this.#host.focus(this.#pin);
      this.#host.services.requestRender();
    }
  }

  #submitKey() {
    if (this.#key !== null && this.#key.value.trim().length > 0) {
      this.#prompt.submitKey(this.#key.value, this.#pin?.value ?? "");
    }
  }

  #submitPin() {
    if (this.#pin !== null && this.#pin.value.length > 0) {
      this.#prompt.submitPin(this.#pin.value);
    }
  }
}

/**
 * The line under the fields: checking, what was wrong, or a hint.
 * @param {import("../../application/wallet/ActiveKeyPrompt.js").ActiveKeyState} state
 * @param {boolean} checking
 * @param {{ y: number, width: number, hint: string }} place
 */
function statusLine(state, checking, { y, width, hint }) {
  let line = { text: hint, colorKey: "textMuted" };
  if (checking) {
    line = { text: "Checking the key…", colorKey: "accent" };
  } else if (state.error !== null) {
    line = { text: sentence(state.error.message), colorKey: "danger" };
  }
  return new Label({ id: "activeKey.status", x: INSET, y, width, height: 30, text: line.text, size: "small", colorKey: line.colorKey, fit: true });
}

/** @param {string} text */
function sentence(text) {
  if (text.length === 0) {
    return text;
  }
  const stop = /[.!?]$/.test(text) ? "" : ".";
  return text[0].toUpperCase() + text.slice(1) + stop;
}
