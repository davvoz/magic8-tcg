/**
 * Base of the screens inside the navigation shell (rendering/shell): every
 * screen but the match, the replay, sign-in and the error. The shell — the
 * rail of sections and the top bar with the screen's title and Back — is
 * the scene's chrome; the scene lays itself out in the content area left
 * to it, which its `services.viewport` (a ContentViewport) describes as if
 * it were the whole screen. The scene names its section (lit on the rail),
 * its title and what Back does; it may change the last two at any time
 * (`setHeading`).
 */
import { ContentViewport } from "../shell/ContentViewport.js";
import { Shell } from "../shell/Shell.js";
import { Scene } from "./Scene.js";

export class SectionScene extends Scene {
  #shell;

  /**
   * @param {import("./Scene.js").SceneServices} services the whole screen's
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {{ section: string | null, title: string, back?: (() => void) | null }} heading `section`: a SectionId (null for none);
   *   `back`: what the bar's Back does (null or absent: no Back)
   */
  constructor(services, app, { section, title, back = null }) {
    const screen = /** @type {import("../canvas/Viewport.js").Viewport} the whole screen's, as the scene manager hands it */ (services.viewport);
    super(Object.freeze({ ...services, viewport: new ContentViewport(screen) }));
    this.#shell = new Shell({ host: this, app, section, heading: Object.freeze({ title, back }) });
    this.chrome = this.#shell.node;
  }

  /**
   * Names the screen in the bar and says what its Back does (null: no Back); what is not given is kept.
   * @param {Partial<import("../shell/TopBar.js").Heading>} heading
   */
  setHeading(heading) {
    this.#shell.setHeading(heading);
  }

  /** The bar's Back button, when the screen has one: where the focus goes when nothing else asks for it. */
  get backButton() {
    return this.#shell.backButton;
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
