/**
 * Entry screen: a fan of cards under a glowing title, the navigation
 * buttons and a content summary. Buttons whose destination scene is not
 * registered are disabled rather than pretending to work.
 */
import { AccountStatus } from "../../application/account/AccountService.js";
import { IdentityStatus } from "../../application/identity/IdentityService.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Ornament } from "../ui/Ornament.js";
import { deckStorageText } from "./deckStorage.js";
import { HeroNode } from "./mainMenu/HeroNode.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const BUTTON_WIDTH = 360;
const BUTTON_HEIGHT = 52;
const BUTTON_GAP = 12;
const HERO = Object.freeze({ y: 20, height: 280 });
const TITLE = Object.freeze({ y: 150, height: 110 });
const SUBTITLE_Y = 268;
const ORNAMENT_Y = 314;
const BUTTONS_Y = 360;
const SUMMARY = Object.freeze({ y: 690, lineHeight: 28, width: 900 });

export class MainMenuScene extends Scene {
  #app;
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
    // The account loads after sign-in; redraw when it does (and when it fails).
    this.#unsubscribe = this.#app.account?.subscribe(() => this.#rebuild()) ?? null;
    this.#rebuild();
    this.services.logger.info("main menu ready", { theme: this.services.theme.layout });
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.exit();
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.root.clear();
    const { viewport, hasScene, navigate } = this.services;
    const width = viewport.logicalWidth;
    const centerX = width / 2;
    this.root.add(new HeroNode({ x: centerX - 400, y: HERO.y, width: 800, height: HERO.height }));
    this.root.add(new Label({ x: 0, y: TITLE.y, width, height: TITLE.height, text: "MAGIC8", size: "title", weight: "bold", colorKey: "accentLight", glow: true }));
    this.root.add(new Label({ x: 0, y: SUBTITLE_Y, width, height: 36, text: "A canvas card game engine", size: "body", colorKey: "textMuted" }));
    this.root.add(new Ornament({ x: centerX - 220, y: ORNAMENT_Y, width: 440, height: 16 }));

    const entries = [
      { id: "play", text: "Play", scene: SceneId.DECK_SELECTION, variant: "primary" },
      { id: "deckBuilder", text: "Deck Builder", scene: SceneId.DECK_BUILDER, variant: "secondary" },
      ...this.#collectionEntries(),
      ...(this.#app.shop === undefined ? [] : [{ id: "shop", text: "Shop", scene: SceneId.SHOP, variant: "secondary" }]),
      ...this.#accountEntries(),
    ];
    /** @type {Button | null} */
    let first = null;
    entries.forEach((entry, index) => {
      const button = this.root.add(
        new Button({
          id: entry.id,
          x: centerX - BUTTON_WIDTH / 2,
          y: BUTTONS_Y + index * (BUTTON_HEIGHT + BUTTON_GAP),
          width: BUTTON_WIDTH,
          height: BUTTON_HEIGHT,
          text: entry.text,
          variant: /** @type {import("../ui/Button.js").ButtonVariant} */ (entry.variant),
          onActivate: entry.onActivate ?? (() => navigate(entry.scene)),
        }),
      );
      button.enabled = entry.scene === null || hasScene(entry.scene);
      first ??= button;
    });

    const draft = this.#draftSummary();
    const lines = [
      { text: this.#accountSummary(), colorKey: "accentLight" },
      { text: this.#contentSummary(), colorKey: "textMuted" },
      { text: this.#storageSummary(), colorKey: "textMuted" },
      ...(draft === null ? [] : [{ text: draft, colorKey: "accent" }]),
      { text: `engine ${this.#app.environment.version}`, colorKey: "disabledText" },
    ];
    lines.forEach((line, index) => {
      this.root.add(new Label({ x: centerX - SUMMARY.width / 2, y: SUMMARY.y + index * SUMMARY.lineHeight, width: SUMMARY.width, height: SUMMARY.lineHeight, text: line.text, size: "small", colorKey: line.colorKey, fit: true }));
    });
    this.focus(this.root.findById(focusedId) ?? first);
    this.services.requestRender();
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    const { theme, viewport } = this.services;
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "menu" });
    super.render(context);
  }

  /** The free starter deck until it is taken, the collection afterwards. */
  #collectionEntries() {
    const account = this.#app.account;
    if (account === undefined || account.state.status === AccountStatus.SIGNED_OUT) {
      return [];
    }
    if (account.needsStarter) {
      return [{ id: "starter", text: "Free starter deck", scene: SceneId.STARTER, variant: "primary" }];
    }
    return [{ id: "collection", text: "Collection", scene: SceneId.COLLECTION, variant: "secondary" }];
  }

  /** Sign in / sign out, when a game server is reachable. */
  #accountEntries() {
    const identity = this.#app.identity;
    if (identity === undefined) {
      return [];
    }
    const { status, user } = identity.state;
    if (status === IdentityStatus.SIGNED_IN && user !== null) {
      const signOut = () => identity.signOut().then(() => this.services.navigate(SceneId.MAIN_MENU));
      return [{ id: "signOut", text: `Sign out @${user.account}`, scene: null, variant: "secondary", onActivate: signOut }];
    }
    if (status === IdentityStatus.SIGNED_OUT) {
      return [{ id: "signIn", text: "Sign in with Keychain", scene: SceneId.LOGIN, variant: "secondary" }];
    }
    return [];
  }

  #accountSummary() {
    const state = this.#app.identity?.state;
    if (state === undefined || state.status === IdentityStatus.OFFLINE) {
      return "Offline: practice against the AI (no game server)";
    }
    if (state.status === IdentityStatus.SIGNED_IN && state.user !== null) {
      return `Signed in as @${state.user.account} (${state.user.network})${this.#collectionSummary()}`;
    }
    return state.status === IdentityStatus.UNKNOWN ? "Connecting to the game server…" : "Not signed in";
  }

  #collectionSummary() {
    const account = this.#app.account;
    if (account === undefined) {
      return "";
    }
    const { status, error } = account.state;
    if (status === AccountStatus.LOADING) {
      return " · loading your collection…";
    }
    if (status === AccountStatus.FAILED) {
      return ` · collection unavailable: ${error?.message ?? "unknown error"}`;
    }
    const owned = account.collection.state.cards.reduce((total, entry) => total + entry.copies.length, 0);
    return ` · ${owned} card${owned === 1 ? "" : "s"} owned`;
  }

  #contentSummary() {
    const { content } = this.#app;
    const factions = content.deckRules.factions.join(" · ");
    return `${content.catalog.size} cards · ${content.preconDecks.length} preconstructed decks · factions: ${factions}`;
  }

  /** A deck left open in the builder survives navigation; say so. */
  #draftSummary() {
    const draft = this.#app.deckBuilding.draft;
    if (draft === null || draft === undefined) {
      return null;
    }
    const state = this.#app.deckBuilding.hasUnsavedChanges ? "unsaved changes" : "saved";
    return `Deck builder: editing "${draft.name}" (${state})`;
  }

  #storageSummary() {
    const saved = this.#app.deckSelection.listDecks().filter((option) => option.source === "custom").length;
    return `${saved} custom deck${saved === 1 ? "" : "s"} ${deckStorageText(this.#app)}`;
  }
}
