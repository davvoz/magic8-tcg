/**
 * Sign-in with a browser wallet (Steem Keychain). The user types their
 * account name; the wallet shows the exact message to sign; the game server
 * verifies the signature against the chain. No password or key is typed here.
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
 * @typedef {Readonly<{ panel: { width: number, height: number }, inset: number, title: number, subtitle: number, field: { y: number, height: number }, buttons: { y: number, width: number, height: number, gap: number }, status: number }>} LoginLayout
 *   `title`, `subtitle`, `status`: their tops
 */
/** @type {LoginLayout} */
const WIDE = Object.freeze({
  panel: Object.freeze({ width: 720, height: 460 }),
  inset: 60,
  title: 40,
  subtitle: 104,
  field: Object.freeze({ y: 160, height: 64 }),
  buttons: Object.freeze({ y: 260, width: 280, height: 60, gap: 24 }),
  status: 350,
});
/** @type {LoginLayout} */
const COMPACT = Object.freeze({
  panel: Object.freeze({ width: 640, height: 372 }),
  inset: 40,
  title: 22,
  subtitle: 74,
  field: Object.freeze({ y: 112, height: 56 }),
  buttons: Object.freeze({ y: 190, width: 250, height: 52, gap: 20 }),
  status: 262,
});
const ACCOUNT_MAX_LENGTH = 17;

/** User-facing text for failure codes; anything else shows the server's message. */
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
});

export class LoginScene extends Scene {
  #app;
  /** @type {TextField | null} */
  #field = null;
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
    this.#build(identity, "", { text: this.#initialStatus(identity), colorKey: "textMuted" });
    this.#unsubscribe = identity.subscribe((state) => this.#show(state));
  }

  /** The screen changed: the same form, laid out for it, keeping what was typed and the status. */
  relayout() {
    const identity = this.#requireIdentity();
    const status = this.#status === null ? { text: this.#initialStatus(identity), colorKey: "textMuted" } : { text: this.#status.text, colorKey: this.#status.colorKey ?? "textMuted" };
    const submitEnabled = this.#submit?.enabled ?? true;
    this.#build(identity, this.#field?.value ?? "", status);
    if (this.#submit !== null) {
      this.#submit.enabled = submitEnabled;
    }
  }

  /**
   * @param {import("../../application/identity/IdentityService.js").IdentityService} identity
   * @param {string} typed the account name typed so far
   * @param {{ text: string, colorKey: string }} status
   */
  #build(identity, typed, status) {
    const { viewport } = this.services;
    const layout = viewport.compact ? COMPACT : WIDE;
    const { panel: size, inset, buttons } = layout;
    this.root.clear();
    const panel = this.root.add(new Panel({ x: (viewport.logicalWidth - size.width) / 2, y: (viewport.logicalHeight - size.height) / 2, width: size.width, height: size.height }));
    const inner = size.width - 2 * inset;
    panel.add(new Label({ x: 0, y: layout.title, width: size.width, height: 56, text: "Sign in", size: "heading", weight: "bold", colorKey: "accentLight" }));
    panel.add(new Label({ x: inset, y: layout.subtitle, width: inner, height: 30, text: `with ${identity.walletName}: your keys never leave the extension`, size: "small", colorKey: "textMuted", fit: true }));
    this.#field = panel.add(
      new TextField({ id: "login.account", x: inset, y: layout.field.y, width: inner, height: layout.field.height, value: typed, placeholder: "Steem account name", maxLength: ACCOUNT_MAX_LENGTH, keyboard: "account", onSubmit: () => this.#signIn() }),
    );
    const left = (size.width - 2 * buttons.width - buttons.gap) / 2;
    this.#submit = panel.add(new Button({ id: "login.submit", x: left, y: buttons.y, width: buttons.width, height: buttons.height, text: "Sign in", variant: "primary", onActivate: () => this.#signIn() }));
    panel.add(new Button({ id: "login.back", x: left + buttons.width + buttons.gap, y: buttons.y, width: buttons.width, height: buttons.height, text: "Back", onActivate: () => this.services.navigate(SceneId.MAIN_MENU) }));
    this.#status = panel.add(new Label({ x: inset, y: layout.status, width: inner, height: 60, text: status.text, size: "small", colorKey: status.colorKey, fit: true }));
    this.focus(this.#field);
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

  async #signIn() {
    const identity = this.#requireIdentity();
    const result = await identity.signIn(this.#field?.value ?? "");
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
      this.#setStatus("Waiting for Keychain… check the extension window.", "accent");
    } else if (state.error !== null) {
      this.#setStatus(FAILURE_TEXT[/** @type {keyof typeof FAILURE_TEXT} */ (state.error.code)] ?? state.error.message, "danger");
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

  /** @param {import("../../application/identity/IdentityService.js").IdentityService} identity */
  #initialStatus(identity) {
    return identity.walletAvailable ? "Keychain will ask you to sign a one-time login message with your posting key." : FAILURE_TEXT.WALLET_NOT_INSTALLED;
  }

  #requireIdentity() {
    if (this.#app.identity === undefined) {
      throw new Error("LoginScene needs an identity service");
    }
    return this.#app.identity;
  }
}
