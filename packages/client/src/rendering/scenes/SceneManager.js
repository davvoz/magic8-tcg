/**
 * Holds scene factories by id and runs exactly one scene at a time. It is
 * the GameLoop's and InputManager's single target, and the only way scenes
 * move between each other (`navigate`). Scenes never construct one another.
 * An optional overlay (the toasts) is drawn above every scene and sees
 * pointer events first. Each scene it moves to fades in out of the
 * letterbox colour, so screens follow one another instead of cutting; the
 * new scene takes input at once, the fade is only drawn over it.
 *
 * @typedef {{ update: (dtMs: number) => boolean, render: (context: CanvasRenderingContext2D, theme: import("../theme/Theme.js").Theme) => void, onPointer: (input: { type: string, x: number, y: number }) => boolean }} SceneOverlay
 */
import { Easing } from "../animation/Tween.js";
import { withAlpha } from "../theme/color.js";

/** How long a new scene takes to fade in, as a multiple of the medium duration. */
const FADE_MEDIUM = 1.5;

export class SceneManager {
  /** @type {Map<string, (services: import("./Scene.js").SceneServices) => import("./Scene.js").Scene>} */
  #factories = new Map();
  /** @type {import("./Scene.js").Scene | null} */
  #current = null;
  /** @type {string | null} */
  #currentId = null;
  #services;
  #requestRender;
  /** @type {SceneOverlay | null} */
  #overlay = null;
  /** The fade-in of the current scene: how far through it is, and how long it lasts; null once it is over. @type {{ elapsedMs: number, durationMs: number } | null} */
  #fade = null;

  /**
   * @param {{ theme: import("../theme/Theme.js").Theme, viewport: import("../canvas/Viewport.js").Viewport, logger: import("../../application/ports/Logger.contract.js").Logger, requestRender: () => void }} deps
   */
  constructor({ theme, viewport, logger, requestRender }) {
    this.#requestRender = requestRender;
    this.#services = Object.freeze({
      theme,
      viewport,
      logger,
      requestRender,
      navigate: (sceneId, params) => this.navigate(sceneId, params),
      hasScene: (sceneId) => this.#factories.has(sceneId),
    });
  }

  /**
   * @param {string} sceneId
   * @param {(services: import("./Scene.js").SceneServices) => import("./Scene.js").Scene} factory
   */
  register(sceneId, factory) {
    if (this.#factories.has(sceneId)) {
      throw new Error(`SceneManager: scene "${sceneId}" already registered`);
    }
    this.#factories.set(sceneId, factory);
    return this;
  }

  /** @param {string} sceneId */
  has(sceneId) {
    return this.#factories.has(sceneId);
  }

  /** @param {SceneOverlay | null} overlay */
  setOverlay(overlay) {
    this.#overlay = overlay;
    this.#requestRender();
  }

  get currentId() {
    return this.#currentId;
  }

  get current() {
    return this.#current;
  }

  /**
   * @param {string} sceneId
   * @param {Readonly<Record<string, unknown>>} [params]
   */
  navigate(sceneId, params = {}) {
    const factory = this.#factories.get(sceneId);
    if (factory === undefined) {
      this.#services.logger.error("unknown scene", { sceneId });
      return false;
    }
    this.#current?.exit();
    const scene = factory(this.#services);
    this.#current = scene;
    this.#currentId = sceneId;
    scene.enter(params);
    const durationMs = this.#services.theme.animation.mediumMs * FADE_MEDIUM;
    this.#fade = durationMs > 0 ? { elapsedMs: 0, durationMs } : null;
    this.#requestRender();
    return true;
  }

  /** @param {number} dtMs */
  update(dtMs) {
    const scene = this.#current?.update(dtMs) ?? false;
    const overlay = this.#overlay?.update(dtMs) ?? false;
    return this.#advanceFade(dtMs) || scene || overlay;
  }

  /** True while the current scene is still fading in. */
  get isFading() {
    return this.#fade !== null;
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether the fade moved (its last frame included)
   */
  #advanceFade(dtMs) {
    const fade = this.#fade;
    if (fade === null) {
      return false;
    }
    fade.elapsedMs += dtMs;
    if (fade.elapsedMs >= fade.durationMs) {
      this.#fade = null;
    }
    return true;
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    this.#current?.render(context);
    this.#paintFade(context);
    this.#overlay?.render(context, this.#services.theme);
  }

  /**
   * The veil over a scene fading in: opaque as it arrives, lifting quickly then gently.
   * @param {CanvasRenderingContext2D} context
   */
  #paintFade(context) {
    const fade = this.#fade;
    if (fade === null) {
      return;
    }
    const { theme, viewport } = this.#services;
    const area = viewport.bounds;
    context.save();
    context.fillStyle = withAlpha(theme.colors.letterbox, 1 - Easing.easeOutCubic(Math.min(1, fade.elapsedMs / fade.durationMs)));
    context.fillRect(area.x, area.y, area.width, area.height);
    context.restore();
  }

  /** @param {import("../../input/InputManager.js").PointerInput | import("../../input/InputManager.js").WheelInput} input */
  onPointer(input) {
    if (this.#overlay?.onPointer(/** @type {{ type: string, x: number, y: number }} */ (input))) {
      return;
    }
    this.#current?.onPointer(input);
  }

  /** The canvas changed size: the current scene re-fits to `viewport.bounds`. */
  resize() {
    this.#current?.onResize();
  }

  /** @param {import("../../input/InputManager.js").KeyInput} input */
  onKey(input) {
    this.#current?.onKey(input);
  }
}
