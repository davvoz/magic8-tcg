/**
 * Base class for screens. Provides a widget root, pointer dispatch
 * (hover, press/release → activate, wheel and drag scrolling), keyboard
 * focus traversal with text-entry routing, and one modal layer, so most
 * scenes only build their tree and react to activations.
 *
 * Scenes own presentation state only. They read snapshots and read-models
 * and submit commands through application services; they never touch
 * domain entities.
 */
import { KeyMap, isKey } from "../../input/KeyMap.js";
import { ScrollList } from "../ui/ScrollList.js";
import { UiNode } from "../ui/UiNode.js";

/**
 * @typedef {object} SceneServices
 * @property {import("../theme/Theme.js").Theme} theme
 * @property {import("../canvas/Viewport.js").Viewport} viewport
 * @property {(sceneId: string, params?: Readonly<Record<string, unknown>>) => void} navigate
 * @property {(sceneId: string) => boolean} hasScene
 * @property {() => void} requestRender
 * @property {import("../../application/ports/Logger.contract.js").Logger} logger
 */

/** Pointer travel (logical px) after which a press inside a ScrollList becomes a drag. */
const DRAG_THRESHOLD = 8;
/** Holding a press this long (without moving) is a secondary action, like a right-click. */
const LONG_PRESS_MS = 450;
const SECONDARY_BUTTON = 2;

export class Scene {
  /** @type {SceneServices} */
  services;
  /** @type {UiNode} */
  root;
  /** @type {UiNode | null} */
  #pressed = null;
  /** @type {UiNode | null} */
  #hovered = null;
  /** @type {UiNode | null} */
  #focused = null;
  /** @type {import("../ui/Modal.js").Modal | null} */
  #modal = null;
  /** @type {UiNode | null} focus to restore when the modal closes */
  #focusBeforeModal = null;
  /** @type {{ list: ScrollList, startY: number, lastY: number, active: boolean } | null} */
  #drag = null;
  /** Press being timed for a long-press. @type {{ node: UiNode, x: number, y: number, elapsedMs: number } | null} */
  #longPress = null;

  /** @param {SceneServices} services */
  constructor(services) {
    this.services = services;
    this.root = new UiNode({ id: "root", width: services.viewport.logicalWidth, height: services.viewport.logicalHeight });
  }

  /** @param {Readonly<Record<string, unknown>>} _params */
  enter(_params) {
    // Scenes build their widget tree here.
  }

  exit() {
    // Scenes release resources here.
  }

  /**
   * Advances time-based input (long-press). Subclasses that animate call
   * `super.update(dtMs)` and OR the results.
   * @param {number} dtMs
   * @returns {boolean} whether a render is needed
   */
  update(dtMs) {
    const press = this.#longPress;
    if (press === null) {
      return false;
    }
    press.elapsedMs += dtMs;
    if (press.elapsedMs < LONG_PRESS_MS) {
      return false;
    }
    this.#longPress = null;
    this.#setPressed(null);
    this.onSecondary(press.node);
    return true;
  }

  /**
   * Right-click, long-press or the inspect key on `node` (any visible node
   * under the pointer, enabled or not). Scenes override it; the default does nothing.
   * @param {UiNode} _node
   */
  onSecondary(_node) {
    // Nothing to inspect by default.
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    this.root.draw(context, this.services.theme);
  }

  /** @param {import("../../input/InputManager.js").PointerInput | import("../../input/InputManager.js").WheelInput} input */
  onPointer(input) {
    if (input.type === "wheel") {
      this.#onWheel(input);
      return;
    }
    const hit = this.root.hitTest(input);
    this.#setHovered(hit);
    if (input.type === "down") {
      this.#onDown(hit, input);
    } else if (input.type === "move") {
      this.#onMove(input);
    } else if (input.type === "up") {
      this.#onUp(hit);
    } else {
      this.#setPressed(null);
      this.#drag = null;
      this.#longPress = null;
    }
  }

  /** @param {import("../../input/InputManager.js").KeyInput} input */
  onKey(input) {
    if (input.type !== "keydown") {
      return;
    }
    if (this.#focused?.handleKey(input)) {
      this.services.requestRender();
    } else if (isKey(input.key, KeyMap.NEXT)) {
      this.#moveFocus(1);
    } else if (isKey(input.key, KeyMap.PREVIOUS)) {
      this.#moveFocus(-1);
    } else if (isKey(input.key, KeyMap.CONFIRM) && this.#focused !== null) {
      this.#focused.activate();
      this.services.requestRender();
    } else if (isKey(input.key, KeyMap.CANCEL)) {
      this.onCancel();
    } else if (isKey(input.key, KeyMap.INSPECT) && this.#focused !== null) {
      this.onSecondary(this.#focused);
    }
  }

  /** Escape: closes the modal if one is open. Scenes may extend it. */
  onCancel() {
    if (this.#modal !== null) {
      this.#modal.onDismiss();
    }
  }

  get focusedNode() {
    return this.#focused;
  }

  get modal() {
    return this.#modal;
  }

  /** @param {UiNode | null} node */
  focus(node) {
    this.#setFocused(node);
  }

  /**
   * Shows a modal above everything else; keyboard focus is confined to it
   * until `closeModal`. Only one modal at a time.
   * @param {import("../ui/Modal.js").Modal} modal
   */
  openModal(modal) {
    if (this.#modal !== null) {
      this.closeModal();
    }
    this.#focusBeforeModal = this.#focused;
    this.#modal = this.root.add(modal);
    this.#setFocused(modal.focusableNodes()[0] ?? null);
    this.services.requestRender();
  }

  closeModal() {
    if (this.#modal === null) {
      return;
    }
    this.root.remove(this.#modal);
    this.#modal = null;
    this.#setHovered(null);
    this.#setPressed(null);
    this.#setFocused(this.#focusBeforeModal);
    this.#focusBeforeModal = null;
    this.services.requestRender();
  }

  /** @param {import("../../input/InputManager.js").WheelInput} input */
  #onWheel(input) {
    const list = this.#scrollListAt(input);
    if (list !== null && list.scrollBy(input.deltaY)) {
      this.services.requestRender();
    }
  }

  /**
   * @param {UiNode | null} hit
   * @param {import("../../input/InputManager.js").PointerInput} input
   */
  #onDown(hit, input) {
    const under = this.root.nodeAt(input);
    if (input.button === SECONDARY_BUTTON) {
      if (under !== null) {
        this.onSecondary(under);
      }
      return;
    }
    this.#setPressed(hit);
    this.#setFocused(hit?.focusable ? hit : this.#focused);
    const list = this.#scrollListAt(input);
    this.#drag = list === null ? null : { list, startY: input.y, lastY: input.y, active: false };
    this.#longPress = under === null ? null : { node: under, x: input.x, y: input.y, elapsedMs: 0 };
  }

  /** @param {import("../../input/InputManager.js").PointerInput} input */
  #onMove(input) {
    const press = this.#longPress;
    if (press !== null && Math.hypot(input.x - press.x, input.y - press.y) > DRAG_THRESHOLD) {
      this.#longPress = null;
    }
    const drag = this.#drag;
    if (drag === null) {
      return;
    }
    if (!drag.active && Math.abs(input.y - drag.startY) > DRAG_THRESHOLD) {
      drag.active = true;
      this.#setPressed(null);
    }
    if (drag.active) {
      drag.list.scrollBy(drag.lastY - input.y);
      drag.lastY = input.y;
      this.services.requestRender();
    }
  }

  /** @param {UiNode | null} hit */
  #onUp(hit) {
    const pressed = this.#pressed;
    const dragged = this.#drag?.active === true;
    this.#setPressed(null);
    this.#drag = null;
    this.#longPress = null;
    if (!dragged && pressed !== null && pressed === hit) {
      pressed.activate();
      this.services.requestRender();
    }
  }

  /**
   * Nearest ScrollList enclosing the point, if any.
   * @param {import("@magic8/engine/shared/geometry.js").Point} point
   */
  #scrollListAt(point) {
    for (let node = this.root.nodeAt(point); node !== null; node = node.parent) {
      if (node instanceof ScrollList) {
        return node;
      }
    }
    return null;
  }

  /** @param {number} direction */
  #moveFocus(direction) {
    const nodes = (this.#modal ?? this.root).focusableNodes();
    if (nodes.length === 0) {
      return;
    }
    const current = this.#focused === null ? -1 : nodes.indexOf(this.#focused);
    if (current === -1) {
      this.#setFocused(direction > 0 ? nodes[0] : nodes[nodes.length - 1]);
      return;
    }
    this.#setFocused(nodes[(current + direction + nodes.length) % nodes.length]);
  }

  /** @param {UiNode | null} node */
  #setHovered(node) {
    if (this.#hovered === node) {
      return;
    }
    if (this.#hovered !== null) {
      this.#hovered.hovered = false;
    }
    this.#hovered = node;
    if (node !== null) {
      node.hovered = true;
    }
    this.services.requestRender();
  }

  /** @param {UiNode | null} node */
  #setPressed(node) {
    if (this.#pressed !== null) {
      this.#pressed.pressed = false;
    }
    this.#pressed = node;
    if (node !== null) {
      node.pressed = true;
    }
    this.services.requestRender();
  }

  /** @param {UiNode | null} node */
  #setFocused(node) {
    if (this.#focused === node) {
      return;
    }
    if (this.#focused !== null) {
      this.#focused.focused = false;
    }
    this.#focused = node;
    if (node !== null) {
      node.focused = true;
      for (let ancestor = node.parent; ancestor !== null; ancestor = ancestor.parent) {
        ancestor.revealDescendant(node);
      }
    }
    this.services.requestRender();
  }
}
