/**
 * Base of the small retained-mode widget tree used by menus and the deck
 * builder. Nodes have a position relative to their parent, children drawn
 * in order (last on top), and optional interactivity/focus. This is not a
 * layout engine: scenes position nodes explicitly.
 */
import { containsPoint, rect } from "@magic8/engine/shared/geometry.js";

/** Structural guard against runaway trees. */
const MAX_CHILDREN = 512;

export class UiNode {
  /** @type {string} */
  id;
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  visible = true;
  enabled = true;
  /** Whether pointer events are delivered to this node. */
  interactive = false;
  /** Whether keyboard focus can land here. */
  focusable = false;
  /** A text field: it keeps focus when tapped with a finger, and the tap opens the device's keyboard for it. */
  editsText = false;
  /** The sound activating it makes (a SoundCue), or null for none: the scene plays it on a click, a tap or Enter. @type {string | null} */
  activationCue = null;
  /** Purely decorative overlays set this so pointer queries look through them. */
  passthrough = false;
  /** Pointer queries reach its children wherever they are, not only inside its own rect (a scene's root, whose children may sit in the margin around the design area). */
  unbounded = false;
  focused = false;
  hovered = false;
  pressed = false;
  /** @type {UiNode | null} */
  parent = null;
  /** @type {UiNode[]} */
  #children = [];

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, enabled?: boolean, visible?: boolean }} [options]
   */
  constructor(options = {}) {
    this.id = options.id ?? "";
    this.x = options.x ?? 0;
    this.y = options.y ?? 0;
    this.width = options.width ?? 0;
    this.height = options.height ?? 0;
    this.enabled = options.enabled ?? true;
    this.visible = options.visible ?? true;
  }

  /** @returns {readonly UiNode[]} */
  get children() {
    return this.#children;
  }

  /**
   * @template {UiNode} T
   * @param {T} child
   * @returns {T}
   */
  add(child) {
    if (this.#children.length >= MAX_CHILDREN) {
      throw new RangeError("UiNode: too many children");
    }
    child.parent = this;
    this.#children.push(child);
    return child;
  }

  /** @param {UiNode} child */
  remove(child) {
    const index = this.#children.indexOf(child);
    if (index !== -1) {
      this.#children.splice(index, 1);
      child.parent = null;
    }
  }

  clear() {
    for (const child of this.#children) {
      child.parent = null;
    }
    this.#children = [];
  }

  /** Absolute bounds in logical coordinates. */
  get bounds() {
    let offsetX = this.x;
    let offsetY = this.y;
    for (let ancestor = this.parent; ancestor !== null; ancestor = ancestor.parent) {
      offsetX += ancestor.x;
      offsetY += ancestor.y;
    }
    return rect(offsetX, offsetY, this.width, this.height);
  }

  get isEffectivelyVisible() {
    for (let node = /** @type {UiNode | null} */ (this); node !== null; node = node.parent) {
      if (!node.visible) {
        return false;
      }
    }
    return true;
  }

  get isEffectivelyEnabled() {
    for (let node = /** @type {UiNode | null} */ (this); node !== null; node = node.parent) {
      if (!node.enabled) {
        return false;
      }
    }
    return true;
  }

  /**
   * Deepest, topmost interactive node under the point, or null.
   * @param {import("@magic8/engine/shared/geometry.js").Point} point
   * @returns {UiNode | null}
   */
  hitTest(point) {
    if (!this.isEffectivelyVisible || this.passthrough || !this.#reaches(point) || !this.isEffectivelyEnabled) {
      return null;
    }
    for (let index = this.#children.length - 1; index >= 0; index -= 1) {
      const hit = this.#children[index].hitTest(point);
      if (hit !== null) {
        return hit;
      }
    }
    return this.interactive && this.enabled ? this : null;
  }

  /**
   * Deepest visible node containing the point, interactive or not (used to
   * find scroll containers under the pointer).
   * @param {import("@magic8/engine/shared/geometry.js").Point} point
   * @returns {UiNode | null}
   */
  nodeAt(point) {
    if (!this.visible || this.passthrough || !this.#reaches(point)) {
      return null;
    }
    for (let index = this.#children.length - 1; index >= 0; index -= 1) {
      const hit = this.#children[index].nodeAt(point);
      if (hit !== null) {
        return hit;
      }
    }
    return this;
  }

  /** @param {import("@magic8/engine/shared/geometry.js").Point} point */
  #reaches(point) {
    return this.unbounded || containsPoint(this.bounds, point);
  }

  /**
   * First node in the subtree with the given id (ids are chosen by scenes).
   * @param {string} id
   * @returns {UiNode | null}
   */
  findById(id) {
    if (id.length === 0) {
      return null;
    }
    if (this.id === id) {
      return this;
    }
    for (const child of this.#children) {
      const found = child.findById(id);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  /** Depth-first list of nodes that can take keyboard focus right now. */
  focusableNodes() {
    /** @type {UiNode[]} */
    const nodes = [];
    this.#collectFocusable(nodes);
    return nodes;
  }

  /** @param {UiNode[]} into */
  #collectFocusable(into) {
    if (!this.isEffectivelyVisible || !this.isEffectivelyEnabled) {
      return;
    }
    if (this.focusable && this.enabled) {
      into.push(this);
    }
    for (const child of this.#children) {
      child.#collectFocusable(into);
    }
  }

  /**
   * Draws this node then its children. Subclasses override `paint`.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  draw(context, theme) {
    if (!this.visible) {
      return;
    }
    this.paint(context, theme);
    for (const child of this.#children) {
      child.draw(context, theme);
    }
  }

  /**
   * @param {CanvasRenderingContext2D} _context
   * @param {import("../theme/Theme.js").Theme} _theme
   */
  paint(_context, _theme) {
    // Containers draw nothing by default.
  }

  /** Called when a press that started on this node is released on it. */
  activate() {
    // Non-interactive nodes ignore activation.
  }

  /**
   * Gives the focused node first refusal on a key. Returns true when the key
   * was consumed (text entry); false lets the scene handle navigation.
   * @param {import("../../input/InputManager.js").KeyInput} _input
   */
  handleKey(_input) {
    return false;
  }

  /**
   * Text pasted while this node has the focus. Returns true when taken (text entry).
   * @param {string} _text
   */
  paste(_text) {
    return false;
  }

  /**
   * Asks this node to bring a descendant into view; scroll containers
   * override it. Called on every ancestor of a newly focused node.
   * @param {UiNode} _node
   */
  revealDescendant(_node) {
    // Plain containers have nothing to scroll.
  }
}
