/**
 * Base of the screens inside the navigation shell (rendering/shell): every
 * screen but the match, the replay, sign-in and the error. The shell — the
 * top bar with the screen's title (or its section's tabs) and Back — is
 * the scene's chrome; the scene lays itself
 * out in the content area left to it, which its `services.viewport` (a
 * ContentViewport) describes as if it were the whole screen.
 *
 * The scene names itself (its SceneId: the section it belongs to follows,
 * shell/navigation.js) and its title, which it may change (`setHeading`),
 * and may put buttons of its own in the bar (`setBarActions`).
 * Back follows the one rule of navigation.js: on entering, the scene hands
 * over what it was opened with (`routeBack`); `goBack` follows it (Escape,
 * the bar's Back), and `backHere` is what a screen opened from this one is
 * told so that its Back comes back here.
 */
import { ContentViewport } from "../shell/ContentViewport.js";
import { backTarget, namedBack, returnTo, sectionOf } from "../shell/navigation.js";
import { Shell } from "../shell/Shell.js";
import { Scene } from "./Scene.js";

export class SectionScene extends Scene {
  /** The screen's SceneId. */
  sceneId;
  #shell;
  #app;
  /** Where Back leads, or null for no Back. @type {import("../shell/navigation.js").BackTarget | null} */
  #back = null;
  /** Where the opener said Back leads (null: it did not say). @type {import("../shell/navigation.js").BackTarget | null} */
  #named = null;

  /**
   * @param {import("./Scene.js").SceneServices} services the whole screen's
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {{ scene: string, title: string }} heading `scene`: the screen's SceneId
   */
  constructor(services, app, { scene, title }) {
    const screen = /** @type {import("../canvas/Viewport.js").Viewport} the whole screen's, as the scene manager hands it */ (services.viewport);
    super(Object.freeze({ ...services, viewport: new ContentViewport(screen) }));
    this.sceneId = scene;
    this.#app = app;
    this.#shell = new Shell({ host: this, app, scene, section: sectionOf(scene)?.id ?? null, heading: Object.freeze({ title, back: null }) });
    this.chrome = this.#shell.node;
  }

  /**
   * Names the screen in the bar and says what its Back does (null: no Back); what is not given is kept.
   * @param {Partial<import("../shell/TopBar.js").Heading>} heading
   */
  setHeading(heading) {
    this.#shell.setHeading(heading);
  }

  /**
   * Puts the screen's own buttons in the bar, left of the player's things (none: `[]`).
   * @param {readonly import("../shell/Shell.js").BarAction[]} actions
   */
  setBarActions(actions) {
    this.#shell.setActions(actions);
  }

  /**
   * Sets where Back leads, by the rule, for what the screen was opened with (`back`, `backParams`). Called on entering.
   * @param {Readonly<Record<string, unknown>>} [params]
   */
  routeBack(params = {}) {
    const context = { hasScene: this.services.hasScene, app: this.#app };
    this.#named = namedBack(this.sceneId, params, this.services.hasScene);
    this.#back = backTarget(this.sceneId, params, context);
    this.setHeading({ back: this.#back === null ? null : () => this.goBack() });
  }

  /** Where Back leads, or null when the screen has no Back. */
  get backTarget() {
    return this.#back;
  }

  /**
   * Goes where Back leads. A screen that must do something on its way out first (leave a queue) does it here.
   * @returns {boolean} whether there was somewhere to go
   */
  goBack() {
    if (this.#back === null) {
      return false;
    }
    this.services.navigate(this.#back.scene, this.#back.params);
    return true;
  }

  /** Escape: closes the dialog on show, else goes Back. Scenes may extend it. */
  onCancel() {
    if (this.modal !== null) {
      super.onCancel();
      return;
    }
    this.goBack();
  }

  /**
   * What a screen opened from here is told so that its Back comes back here, opened again with `params`.
   * @param {Readonly<Record<string, unknown>>} [params]
   */
  backHere(params = {}) {
    return returnTo(this.sceneId, params, this.#named);
  }

  /**
   * Opens a section's screen (Home lists them): a locked one says why instead.
   * @param {string} sectionId one of SectionId
   */
  openSection(sectionId) {
    this.#shell.openSection(sectionId);
  }

  /** The bar's Back button, when the screen has one: where the focus goes when nothing else asks for it. */
  get backButton() {
    return this.#shell.backButton;
  }

  /**
   * Moves the shell's light (the logo's) on with the scene's own.
   * @param {number} dtMs
   */
  update(dtMs) {
    const base = super.update(dtMs);
    return this.#shell.update(dtMs) || base;
  }

  exit() {
    this.#shell.detach();
    super.exit();
  }

  onResize() {
    this.#shell.relayout();
    super.onResize();
  }
}
