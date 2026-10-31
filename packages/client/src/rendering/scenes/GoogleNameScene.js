/**
 * A new player back from Google chooses their name (docs/tcg/29-google.md):
 * the name of the Steem account KIJAM creates for them, whose wallet it
 * keeps. Whether a name is free is asked as they type (once they pause);
 * Create account makes it, signs them in and takes them home.
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
 * @typedef {Readonly<{ panel: { width: number, height: number }, inset: number, title: number, intro: { y: number, height: number }, field: { y: number, height: number }, buttons: { y: number, width: number, height: number, gap: number }, status: { y: number, height: number } }>} NameLayout
 */
/** @type {NameLayout} */
const WIDE = Object.freeze({
  panel: Object.freeze({ width: 720, height: 500 }),
  inset: 60,
  title: 32,
  intro: Object.freeze({ y: 100, height: 72 }),
  field: Object.freeze({ y: 188, height: 60 }),
  buttons: Object.freeze({ y: 286, width: 280, height: 60, gap: 24 }),
  status: Object.freeze({ y: 366, height: 84 }),
});
/** @type {NameLayout} */
const COMPACT = Object.freeze({
  panel: Object.freeze({ width: 640, height: 384 }),
  inset: 40,
  title: 12,
  intro: Object.freeze({ y: 66, height: 56 }),
  field: Object.freeze({ y: 132, height: 50 }),
  buttons: Object.freeze({ y: 204, width: 250, height: 50, gap: 20 }),
  status: Object.freeze({ y: 270, height: 80 }),
});
const NAME_MAX_LENGTH = 16;
/** How long the player pauses typing before the name is checked. */
const CHECK_AFTER_MS = 450;
const RULES = "3 to 16 characters: lowercase letters, digits, dashes and dots. Your name is for good.";

/** What the player is told when the account could not be made, by the server's code; anything else shows its message. */
const FAILURE_TEXT = Object.freeze({
  NAME_TAKEN: "That name was just taken: choose another.",
  INVALID_ACCOUNT: "That name cannot be used: choose another.",
  INVALID_NAME: RULES,
  SIGNUP_EXPIRED: "This sign-up has expired: continue with Google again from the sign-in screen.",
  ACCOUNTS_UNAVAILABLE: "New accounts cannot be created right now. Try again in a little while.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  NETWORK: "The game server cannot be reached.",
  UNAVAILABLE: "The game server is not available.",
});

export class GoogleNameScene extends Scene {
  #app;
  /** @type {TextField | null} */
  #field = null;
  /** @type {Label | null} */
  #status = null;
  /** @type {Button | null} */
  #create = null;
  /** The name typed, waiting to be checked once the player pauses; null when there is nothing to check. */
  /** @type {string | null} */
  #toCheck = null;
  #sinceTyped = 0;
  #creating = false;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#app = app;
  }

  enter() {
    // Signed in after all (the page was reopened): nothing to choose.
    if (this.#app.identity?.state.status === IdentityStatus.SIGNED_IN) {
      this.services.navigate(SceneId.HOME);
      return;
    }
    this.#app.google?.take();
    this.#build("", { text: RULES, colorKey: "textMuted" });
  }

  relayout() {
    this.#build(this.#field?.value ?? "", { text: this.#status?.text ?? RULES, colorKey: this.#status?.colorKey ?? "textMuted" });
  }

  /**
   * @param {string} typed
   * @param {{ text: string, colorKey: string }} status
   */
  #build(typed, status) {
    const { viewport } = this.services;
    const layout = viewport.compact ? COMPACT : WIDE;
    const { panel: size, inset, buttons } = layout;
    const inner = size.width - 2 * inset;
    this.root.clear();
    const panel = this.root.add(new Panel({ x: (viewport.logicalWidth - size.width) / 2, y: (viewport.logicalHeight - size.height) / 2, width: size.width, height: size.height }));
    panel.add(new Label({ x: 0, y: layout.title, width: size.width, height: 56, text: "Choose your name", size: "heading", weight: "bold", colorKey: "accentLight" }));
    panel.add(new Label({ x: inset, y: layout.intro.y, width: inner, height: layout.intro.height, text: "It is the name of your Steem account, and how other players see you. KIJAM creates the account and keeps its wallet for you.", colorKey: "text", fit: true }));
    this.#field = panel.add(
      new TextField({ id: "googleName.name", x: inset, y: layout.field.y, width: inner, height: layout.field.height, value: typed, placeholder: "Your name", maxLength: NAME_MAX_LENGTH, keyboard: "account", onChange: (value) => this.#typed(value), onSubmit: () => this.#createAccount() }),
    );
    const left = (size.width - 2 * buttons.width - buttons.gap) / 2;
    this.#create = panel.add(new Button({ id: "googleName.create", x: left, y: buttons.y, width: buttons.width, height: buttons.height, text: "Create account", variant: "primary", enabled: !this.#creating, onActivate: () => this.#createAccount() }));
    panel.add(new Button({ id: "googleName.back", x: left + buttons.width + buttons.gap, y: buttons.y, width: buttons.width, height: buttons.height, text: "Back", enabled: !this.#creating, onActivate: () => this.services.navigate(SceneId.HOME) }));
    this.#status = panel.add(new Label({ x: panel.titleInset, y: layout.status.y, width: size.width - 2 * panel.titleInset, height: layout.status.height, text: status.text, size: "small", colorKey: status.colorKey, fit: true }));
    this.focus(this.#field);
    this.services.requestRender();
  }

  onCancel() {
    if (!this.#creating) {
      this.services.navigate(SceneId.HOME);
    }
  }

  /** @param {number} dtMs */
  update(dtMs) {
    const changed = super.update(dtMs);
    if (this.#toCheck === null) {
      return changed;
    }
    this.#sinceTyped += dtMs;
    if (this.#sinceTyped >= CHECK_AFTER_MS) {
      const name = this.#toCheck;
      this.#toCheck = null;
      void this.#check(name);
    }
    return changed;
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "login", motes: false });
    super.render(context);
  }

  /** @param {string} value */
  #typed(value) {
    this.#toCheck = value.length === 0 ? null : value;
    this.#sinceTyped = 0;
    if (value.length === 0) {
      this.#setStatus(RULES, "textMuted");
    }
  }

  /** @param {string} name */
  async #check(name) {
    const google = this.#app.google;
    if (google === undefined) {
      return;
    }
    const status = await google.nameStatus(name);
    // Answers to a name since changed say nothing about the one typed now.
    if (this.#creating || this.#field?.value !== name) {
      return;
    }
    if (!status.ok) {
      this.#setStatus(FAILURE_TEXT[/** @type {keyof typeof FAILURE_TEXT} */ (status.error.code)] ?? RULES, "danger");
      return;
    }
    const { available, reason } = status.value;
    if (available) {
      this.#setStatus(`@${status.value.name} is free.`, "success");
    } else {
      this.#setStatus(reason === "taken" ? `@${status.value.name} is taken: try another.` : RULES, "danger");
    }
  }

  async #createAccount() {
    const google = this.#app.google;
    if (google === undefined || this.#creating) {
      return;
    }
    this.#creating = true;
    this.#toCheck = null;
    this.#setEnabled(false);
    this.#setStatus("Creating your account on the Steem blockchain…", "accent");
    const created = await google.createAccount(this.#field?.value ?? "");
    this.#creating = false;
    if (created.ok) {
      this.services.navigate(SceneId.HOME);
      return;
    }
    this.#setEnabled(true);
    const { code, message, details } = created.error;
    const elsewhere = /** @type {any} */ (details)?.account;
    const text = code === "CONFLICT" && typeof elsewhere === "string" ? `Your Google account already has @${elsewhere}: sign in with its posting key or Keychain.` : (FAILURE_TEXT[/** @type {keyof typeof FAILURE_TEXT} */ (code)] ?? capitalize(message));
    this.#setStatus(text, "danger");
  }

  /** @param {boolean} enabled */
  #setEnabled(enabled) {
    if (this.#create !== null) {
      this.#create.enabled = enabled;
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
    this.services.requestRender();
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
