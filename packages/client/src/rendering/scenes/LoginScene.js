/**
 * Sign-in, two ways (docs/tcg/20-chiavi.md):
 * - with the account's posting key, typed (or pasted) here: checked on the
 *   chain, then kept encrypted in this browser for the next visits;
 * - with a browser wallet (Steem Keychain): the wallet shows the exact
 *   message to sign and no key is typed here.
 * Either way the game server verifies the signature against the chain.
 * Without key sign-in (tools, previews) only the wallet is offered.
 */
import { IdentityStatus } from "../../application/identity/IdentityService.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Panel } from "../ui/Panel.js";
import { TextField } from "../ui/TextField.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

/**
 * Where everything goes in the panel, wide and on a compact screen (a phone in landscape).
 * @typedef {Readonly<{ panel: { width: number, height: number }, inset: number, title: number, modes: { y: number, width: number, height: number, gap: number }, field: { y: number, height: number }, key: number, buttons: { y: number, width: number, height: number, gap: number }, status: { y: number, height: number } }>} LoginLayout
 *   `title`, `key` (the key field's row): their tops
 */
/** @type {LoginLayout} */
const WIDE = Object.freeze({
  panel: Object.freeze({ width: 720, height: 540 }),
  inset: 60,
  title: 32,
  modes: Object.freeze({ y: 100, width: 260, height: 48, gap: 16 }),
  field: Object.freeze({ y: 164, height: 60 }),
  key: 236,
  buttons: Object.freeze({ y: 320, width: 280, height: 60, gap: 24 }),
  status: Object.freeze({ y: 400, height: 90 }),
});
/** @type {LoginLayout} */
const COMPACT = Object.freeze({
  panel: Object.freeze({ width: 640, height: 384 }),
  inset: 40,
  title: 12,
  modes: Object.freeze({ y: 62, width: 240, height: 46, gap: 16 }),
  field: Object.freeze({ y: 116, height: 50 }),
  key: 174,
  buttons: Object.freeze({ y: 234, width: 250, height: 50, gap: 20 }),
  status: Object.freeze({ y: 292, height: 72 }),
});
const ACCOUNT_MAX_LENGTH = 17;
/** A WIF is 51 characters; room for a stray space pasted around it. */
const KEY_MAX_LENGTH = 60;

/** How the player signs in on this screen. */
const Mode = Object.freeze({ KEYS: "keys", KEYCHAIN: "keychain" });

/** User-facing text for failure codes; anything else shows the message that came with it. */
const FAILURE_TEXT = Object.freeze({
  WALLET_NOT_INSTALLED: "Steem Keychain was not found. Install the extension, then reload the page.",
  WALLET_REJECTED: "The signature was cancelled in Keychain.",
  WALLET_TIMEOUT: "Keychain did not answer. Try again.",
  LOGIN_FAILED: "That signature does not match the account's posting key.",
  CHALLENGE_INVALID: "The sign-in request expired. Try again.",
  CHAIN_UNAVAILABLE: "The Steem blockchain cannot be reached right now. Try again shortly.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  NETWORK: "The game server cannot be reached.",
  UNAVAILABLE: "The game server is not available.",
  NOT_FOUND: "There is no such account on the Steem blockchain.",
});

export class LoginScene extends Scene {
  #app;
  /** @type {string} */
  #mode = Mode.KEYCHAIN;
  /** @type {TextField | null} */
  #field = null;
  /** @type {TextField | null} */
  #key = null;
  /** @type {Label | null} */
  #status = null;
  /** @type {Button | null} */
  #submit = null;
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
    const identity = this.#requireIdentity();
    // The extension when it is here (the keys never leave it), the posting key otherwise (a phone).
    this.#mode = identity.keysAvailable && !identity.walletAvailable ? Mode.KEYS : Mode.KEYCHAIN;
    this.#build(identity, { account: "", key: "" }, this.#initialStatus(identity));
    this.#unsubscribe = identity.subscribe((state) => this.#show(state));
  }

  /** The screen changed: the same form, laid out for it, keeping what was typed and the status. */
  relayout() {
    const identity = this.#requireIdentity();
    const status = this.#status === null ? this.#initialStatus(identity) : { text: this.#status.text, colorKey: this.#status.colorKey ?? "textMuted" };
    const submitEnabled = this.#submit?.enabled ?? true;
    this.#build(identity, this.#typed(), status);
    if (this.#submit !== null) {
      this.#submit.enabled = submitEnabled;
    }
  }

  /**
   * @param {import("../../application/identity/IdentityService.js").IdentityService} identity
   * @param {{ account: string, key: string }} typed what was typed so far
   * @param {{ text: string, colorKey: string }} status
   */
  #build(identity, typed, status) {
    const { viewport } = this.services;
    const layout = viewport.compact ? COMPACT : WIDE;
    const { panel: size, inset, buttons, modes } = layout;
    this.root.clear();
    const panel = this.root.add(new Panel({ x: (viewport.logicalWidth - size.width) / 2, y: (viewport.logicalHeight - size.height) / 2, width: size.width, height: size.height }));
    const inner = size.width - 2 * inset;
    const keys = this.#mode === Mode.KEYS;
    panel.add(new Label({ x: 0, y: layout.title, width: size.width, height: 56, text: "Sign in", size: "heading", weight: "bold", colorKey: "accentLight" }));
    if (identity.keysAvailable) {
      const left = (size.width - 2 * modes.width - modes.gap) / 2;
      panel.add(new Button({ id: "login.mode.keys", x: left, y: modes.y, width: modes.width, height: modes.height, text: "Posting key", variant: keys ? "primary" : "secondary", onActivate: () => this.#switchMode(Mode.KEYS) }));
      panel.add(new Button({ id: "login.mode.keychain", x: left + modes.width + modes.gap, y: modes.y, width: modes.width, height: modes.height, text: "Keychain", variant: keys ? "secondary" : "primary", onActivate: () => this.#switchMode(Mode.KEYCHAIN) }));
    } else {
      panel.add(new Label({ x: inset, y: modes.y, width: inner, height: modes.height, text: `with ${identity.walletName}: your keys never leave the extension`, size: "small", colorKey: "textMuted", fit: true }));
    }
    this.#field = panel.add(
      new TextField({ id: "login.account", x: inset, y: layout.field.y, width: inner, height: layout.field.height, value: typed.account, placeholder: "Steem account name", maxLength: ACCOUNT_MAX_LENGTH, keyboard: "account", onSubmit: () => this.#accountEntered() }),
    );
    if (keys) {
      this.#key = panel.add(
        new TextField({ id: "login.key", x: inset, y: layout.key, width: inner, height: layout.field.height, value: typed.key, placeholder: "Private posting key (starts with 5)", maxLength: KEY_MAX_LENGTH, keyboard: "secret", onSubmit: () => this.#signIn() }),
      );
    } else {
      this.#key = null;
      if (identity.keysAvailable) {
        panel.add(new Label({ x: inset, y: layout.key, width: inner, height: layout.field.height, text: `with ${identity.walletName}: your keys never leave the extension`, size: "small", colorKey: "textMuted", fit: true }));
      }
    }
    const left = (size.width - 2 * buttons.width - buttons.gap) / 2;
    this.#submit = panel.add(new Button({ id: "login.submit", x: left, y: buttons.y, width: buttons.width, height: buttons.height, text: "Sign in", variant: "primary", onActivate: () => this.#signIn() }));
    panel.add(new Button({ id: "login.back", x: left + buttons.width + buttons.gap, y: buttons.y, width: buttons.width, height: buttons.height, text: "Back", onActivate: () => this.services.navigate(SceneId.MAIN_MENU) }));
    this.#status = panel.add(new Label({ x: inset, y: layout.status.y, width: inner, height: layout.status.height, text: status.text, size: "small", colorKey: status.colorKey, fit: true }));
    this.focus(this.#field.value.length > 0 && this.#key !== null ? this.#key : this.#field);
    this.services.requestRender();
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.exit();
  }

  onCancel() {
    this.services.navigate(SceneId.MAIN_MENU);
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "login", motes: false });
    super.render(context);
  }

  /** @param {string} mode */
  #switchMode(mode) {
    if (mode === this.#mode || this.#requireIdentity().state.status === IdentityStatus.SIGNING_IN) {
      return;
    }
    this.#mode = mode;
    const identity = this.#requireIdentity();
    // The key typed so far is dropped with its field: it does not linger behind the other form.
    this.#build(identity, { account: this.#field?.value ?? "", key: "" }, this.#initialStatus(identity));
  }

  /** Enter in the account field: on to the key, or straight to Keychain. */
  #accountEntered() {
    if (this.#key !== null && this.#key.value.length === 0) {
      this.focus(this.#key);
      this.services.requestRender();
      return;
    }
    this.#signIn();
  }

  async #signIn() {
    const identity = this.#requireIdentity();
    const account = this.#field?.value ?? "";
    const result = this.#mode === Mode.KEYS ? await identity.signInWithKey(account, this.#key?.value ?? "") : await identity.signIn(account);
    if (result.ok) {
      this.services.navigate(SceneId.MAIN_MENU);
    }
  }

  /** @param {import("../../application/identity/IdentityService.js").IdentityState} state */
  #show(state) {
    if (this.#status === null || this.#submit === null) {
      return;
    }
    const signingIn = state.status === IdentityStatus.SIGNING_IN;
    this.#submit.enabled = !signingIn;
    if (signingIn) {
      this.#setStatus(this.#mode === Mode.KEYS ? "Checking your key on the Steem blockchain…" : "Waiting for Keychain… check the extension window.", "accent");
    } else if (state.error !== null) {
      this.#setStatus(FAILURE_TEXT[/** @type {keyof typeof FAILURE_TEXT} */ (state.error.code)] ?? capitalize(state.error.message), "danger");
    }
    this.services.requestRender();
  }

  /**
   * @param {string} text
   * @param {string} colorKey
   */
  #setStatus(text, colorKey) {
    if (this.#status !== null) {
      this.#status.text = text;
      this.#status.colorKey = colorKey;
    }
  }

  #typed() {
    return { account: this.#field?.value ?? "", key: this.#key?.value ?? "" };
  }

  /**
   * @param {import("../../application/identity/IdentityService.js").IdentityService} identity
   * @returns {{ text: string, colorKey: string }}
   */
  #initialStatus(identity) {
    if (this.#mode === Mode.KEYS) {
      return { text: "Your posting key is checked on the chain, then kept encrypted in this browser. It cannot move your funds.", colorKey: "textMuted" };
    }
    const text = identity.walletAvailable ? "Keychain will ask you to sign a one-time login message with your posting key." : FAILURE_TEXT.WALLET_NOT_INSTALLED;
    return { text, colorKey: "textMuted" };
  }

  #requireIdentity() {
    if (this.#app.identity === undefined) {
      throw new Error("LoginScene needs an identity service");
    }
    return this.#app.identity;
  }
}

/** @param {string} text */
function capitalize(text) {
  if (text.length === 0) {
    return text;
  }
  const stop = /[.!?]$/.test(text) ? "" : ".";
  return text[0].toUpperCase() + text.slice(1) + stop;
}
