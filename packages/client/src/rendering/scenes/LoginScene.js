/**
 * Sign-in, up to three ways:
 * - with Google (docs/tcg/29-google.md), when the server offers it: a new
 *   player gets an account whose wallet KIJAM keeps, nothing to type here;
 * - with the account's posting key (docs/tcg/20-chiavi.md), typed (or
 *   pasted) here: checked on the chain, then kept encrypted in this browser
 *   for the next visits;
 * - with a browser wallet (Steem Keychain): the wallet shows the exact
 *   message to sign and no key is typed here.
 * With a key or Keychain the game server verifies the signature against the
 * chain. Without key sign-in (tools, previews) only the wallet is offered.
 *
 * Coming back from Google with something to say (the account already has
 * keys of its own, the sign-in did not complete), the screen says it, with
 * the account's name already typed.
 */
import { GoogleReturnKind } from "../../application/identity/GoogleSignInService.js";
import { IdentityError, IdentityStatus } from "../../application/identity/IdentityService.js";
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
const Mode = Object.freeze({ GOOGLE: "google", KEYS: "keys", KEYCHAIN: "keychain" });
/** The tab of each way, in the order they are offered. */
const MODE_TABS = Object.freeze([
  Object.freeze({ mode: Mode.GOOGLE, text: "Google" }),
  Object.freeze({ mode: Mode.KEYS, text: "Posting key" }),
  Object.freeze({ mode: Mode.KEYCHAIN, text: "Keychain" }),
]);
const GOOGLE_INTRO = "Sign in with your Google account. New here? Choose a name, and KIJAM creates your Steem account and keeps its wallet for you.";

/** What coming back from Google says, by why the sign-in did not complete. */
const GOOGLE_FAILURE_TEXT = Object.freeze({
  cancelled: "The Google sign-in was cancelled.",
  expired: "The Google sign-in took too long. Try again.",
  unavailable: "Signing in with Google is not available right now. Try again shortly.",
  failed: "The Google sign-in did not work. Try again.",
});

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
  KEY_MISSING: "Your posting key is no longer saved in this browser (its site data was cleared): sign in again with it.",
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
    const back = this.#takeGoogleReturn(identity);
    this.#mode = back?.mode ?? this.#defaultMode(identity);
    this.#build(identity, { account: back?.account ?? "", key: "" }, back?.status ?? this.#initialStatus(identity));
    this.#unsubscribe = identity.subscribe((state) => this.#show(state));
  }

  /**
   * The extension when it is here (the keys never leave it); otherwise Google when the server offers it (a new
   * player, a phone), else the posting key; the posting key when the session closed because its key was no longer
   * saved here.
   * @param {import("../../application/identity/IdentityService.js").IdentityService} identity
   */
  #defaultMode(identity) {
    if (identity.keysAvailable && identity.state.error?.code === IdentityError.KEY_MISSING) {
      return Mode.KEYS;
    }
    if (identity.walletAvailable) {
      return Mode.KEYCHAIN;
    }
    if (this.#googleOffered()) {
      return Mode.GOOGLE;
    }
    return identity.keysAvailable ? Mode.KEYS : Mode.KEYCHAIN;
  }

  /**
   * What the last Google sign-in came back with: the way to sign in now, the account to type, what to say.
   * @param {import("../../application/identity/IdentityService.js").IdentityService} identity
   * @returns {{ mode: string, account: string, status: { text: string, colorKey: string } } | null}
   */
  #takeGoogleReturn(identity) {
    const back = this.#app.google?.take() ?? null;
    if (back === null || back.kind === GoogleReturnKind.NEW) {
      return null;
    }
    if (back.kind === GoogleReturnKind.ERROR) {
      return { mode: Mode.GOOGLE, account: "", status: { text: GOOGLE_FAILURE_TEXT[/** @type {keyof typeof GOOGLE_FAILURE_TEXT} */ (back.reason)] ?? GOOGLE_FAILURE_TEXT.failed, colorKey: "danger" } };
    }
    const text = back.ownKeys ? `@${back.account} now uses its own keys: sign in with them.` : `Your Google account already has @${back.account}: sign in with its posting key or Keychain.`;
    return { mode: identity.walletAvailable || !identity.keysAvailable ? Mode.KEYCHAIN : Mode.KEYS, account: back.account, status: { text, colorKey: "accent" } };
  }

  #googleOffered() {
    return this.#app.google?.offered === true;
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
    const google = this.#mode === Mode.GOOGLE;
    panel.add(new Label({ x: 0, y: layout.title, width: size.width, height: 56, text: "Sign in", size: "heading", weight: "bold", colorKey: "accentLight" }));
    const tabs = MODE_TABS.filter(({ mode }) => this.#offers(identity, mode));
    if (tabs.length > 1) {
      const width = Math.min(modes.width, (inner - (tabs.length - 1) * modes.gap) / tabs.length);
      const left = (size.width - tabs.length * width - (tabs.length - 1) * modes.gap) / 2;
      tabs.forEach(({ mode, text }, index) => {
        panel.add(new Button({ id: `login.mode.${mode}`, x: left + index * (width + modes.gap), y: modes.y, width, height: modes.height, text, variant: mode === this.#mode ? "primary" : "secondary", onActivate: () => this.#switchMode(mode) }));
      });
    } else {
      panel.add(new Label({ x: inset, y: modes.y, width: inner, height: modes.height, text: `with ${identity.walletName}: your keys never leave the extension`, size: "small", colorKey: "textMuted", fit: true }));
    }
    if (google) {
      // No field: the intro fills the rows of both.
      this.#field = null;
      panel.add(new Label({ x: inset, y: layout.field.y, width: inner, height: layout.key + layout.field.height - layout.field.y, text: GOOGLE_INTRO, colorKey: "text", fit: true }));
    } else {
      this.#field = panel.add(
        new TextField({ id: "login.account", x: inset, y: layout.field.y, width: inner, height: layout.field.height, value: typed.account, placeholder: "Steem account name", maxLength: ACCOUNT_MAX_LENGTH, keyboard: "account", onSubmit: () => this.#accountEntered() }),
      );
    }
    if (keys) {
      this.#key = panel.add(
        new TextField({ id: "login.key", x: inset, y: layout.key, width: inner, height: layout.field.height, value: typed.key, placeholder: "Private posting key (starts with 5)", maxLength: KEY_MAX_LENGTH, keyboard: "secret", onSubmit: () => this.#signIn() }),
      );
    } else {
      this.#key = null;
      if (identity.keysAvailable && !google) {
        panel.add(new Label({ x: inset, y: layout.key, width: inner, height: layout.field.height, text: `with ${identity.walletName}: your keys never leave the extension`, size: "small", colorKey: "textMuted", fit: true }));
      }
    }
    const left = (size.width - 2 * buttons.width - buttons.gap) / 2;
    this.#submit = panel.add(new Button({ id: "login.submit", x: left, y: buttons.y, width: buttons.width, height: buttons.height, text: google ? "Continue with Google" : "Sign in", variant: "primary", onActivate: () => this.#signIn() }));
    panel.add(new Button({ id: "login.back", x: left + buttons.width + buttons.gap, y: buttons.y, width: buttons.width, height: buttons.height, text: "Back", onActivate: () => this.services.navigate(SceneId.HOME) }));
    this.#status = panel.add(new Label({ x: panel.titleInset, y: layout.status.y, width: size.width - 2 * panel.titleInset, height: layout.status.height, text: status.text, size: "small", colorKey: status.colorKey, fit: true }));
    this.focus(this.#focusTarget());
    this.services.requestRender();
  }

  /** The account field, the key once the account is typed, or the button when there is nothing to type. */
  #focusTarget() {
    if (this.#field === null) {
      return this.#submit;
    }
    return this.#field.value.length > 0 && this.#key !== null ? this.#key : this.#field;
  }

  /**
   * @param {import("../../application/identity/IdentityService.js").IdentityService} identity
   * @param {string} mode
   */
  #offers(identity, mode) {
    switch (mode) {
      case Mode.GOOGLE:
        return this.#googleOffered();
      case Mode.KEYS:
        return identity.keysAvailable;
      default:
        return true;
    }
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.exit();
  }

  onCancel() {
    this.services.navigate(SceneId.HOME);
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
    if (this.#mode === Mode.GOOGLE) {
      this.#startGoogle();
      return;
    }
    const identity = this.#requireIdentity();
    const account = this.#field?.value ?? "";
    const result = this.#mode === Mode.KEYS ? await identity.signInWithKey(account, this.#key?.value ?? "") : await identity.signIn(account);
    if (result.ok) {
      this.services.navigate(SceneId.HOME);
    }
  }

  /** Off to Google: the page goes, and comes back signed in or with something to say. */
  #startGoogle() {
    this.#setStatus("Opening Google…", "accent");
    if (this.#submit !== null) {
      this.#submit.enabled = false;
    }
    this.services.requestRender();
    this.#app.google?.start();
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
    if (this.#mode === Mode.GOOGLE) {
      return { text: "No keys to keep, nothing to install.", colorKey: "textMuted" };
    }
    if (this.#mode === Mode.KEYS) {
      if (identity.state.error?.code === IdentityError.KEY_MISSING) {
        return { text: FAILURE_TEXT.KEY_MISSING, colorKey: "danger" };
      }
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
