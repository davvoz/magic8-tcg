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

const PANEL = Object.freeze({ width: 720, height: 460 });
const INSET = 60;
const FIELD_HEIGHT = 64;
const BUTTON = Object.freeze({ width: 280, height: 60, gap: 24 });
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
    const { viewport } = this.services;
    const panel = this.root.add(new Panel({ x: (viewport.logicalWidth - PANEL.width) / 2, y: (viewport.logicalHeight - PANEL.height) / 2, width: PANEL.width, height: PANEL.height }));
    const inner = PANEL.width - 2 * INSET;
    panel.add(new Label({ x: 0, y: 40, width: PANEL.width, height: 56, text: "Sign in", size: "heading", weight: "bold", colorKey: "accentLight" }));
    panel.add(new Label({ x: INSET, y: 104, width: inner, height: 30, text: `with ${identity.walletName}: your keys never leave the extension`, size: "small", colorKey: "textMuted", fit: true }));
    this.#field = panel.add(
      new TextField({ id: "login.account", x: INSET, y: 160, width: inner, height: FIELD_HEIGHT, placeholder: "Steem account name", maxLength: ACCOUNT_MAX_LENGTH, onSubmit: () => this.#signIn() }),
    );
    const buttonsY = 260;
    const left = (PANEL.width - 2 * BUTTON.width - BUTTON.gap) / 2;
    this.#submit = panel.add(new Button({ id: "login.submit", x: left, y: buttonsY, width: BUTTON.width, height: BUTTON.height, text: "Sign in", variant: "primary", onActivate: () => this.#signIn() }));
    panel.add(new Button({ id: "login.back", x: left + BUTTON.width + BUTTON.gap, y: buttonsY, width: BUTTON.width, height: BUTTON.height, text: "Back", onActivate: () => this.services.navigate(SceneId.MAIN_MENU) }));
    this.#status = panel.add(new Label({ x: INSET, y: 350, width: inner, height: 60, text: this.#initialStatus(identity), size: "small", colorKey: "textMuted", fit: true }));
    this.#unsubscribe = identity.subscribe((state) => this.#show(state));
    this.focus(this.#field);
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
