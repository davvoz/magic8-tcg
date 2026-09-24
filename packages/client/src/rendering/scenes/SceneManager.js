/**
 * Holds scene factories by id and runs exactly one scene at a time. It is
 * the GameLoop's and InputManager's single target, and the only way scenes
 * move between each other (`navigate`). Scenes never construct one another.
 */
export class SceneManager {
  /** @type {Map<string, (services: import("./Scene.js").SceneServices) => import("./Scene.js").Scene>} */
  #factories = new Map();
  /** @type {import("./Scene.js").Scene | null} */
  #current = null;
  #currentId = null;
  #services;
  #requestRender;

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
    this.#requestRender();
    return true;
  }

  /** @param {number} dtMs */
  update(dtMs) {
    return this.#current?.update(dtMs) ?? false;
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    this.#current?.render(context);
  }

  /** @param {import("../../input/InputManager.js").PointerInput | import("../../input/InputManager.js").WheelInput} input */
  onPointer(input) {
    this.#current?.onPointer(input);
  }

  /** @param {import("../../input/InputManager.js").KeyInput} input */
  onKey(input) {
    this.#current?.onKey(input);
  }
}
