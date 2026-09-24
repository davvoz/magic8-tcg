/**
 * Minimal stand-ins for browser objects so the rendering and input layers
 * can be exercised under node --test.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateTheme } from "../../src/rendering/theme/Theme.js";

/** Stand-in for CanvasGradient: remembers its stops, is accepted as a fillStyle. */
export class FakeGradient {
  /** @type {[number, string][]} */
  stops = [];

  addColorStop(offset, color) {
    this.stops.push([offset, color]);
  }
}

/** Style properties saved and restored by save()/restore(), like the real context. */
const STATE_PROPERTIES = Object.freeze(["fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "font", "textAlign", "textBaseline", "globalAlpha", "shadowColor", "shadowBlur"]);

/** Records every drawing call; measureText returns 8px per character; save/restore keep a real state stack. */
export class FakeContext2D {
  /** @type {{ method: string, args: unknown[] }[]} */
  calls = [];
  /** @type {Record<string, unknown>[]} */
  #stack = [];
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  font = "";
  textAlign = "start";
  textBaseline = "alphabetic";
  globalAlpha = 1;
  shadowColor = "rgba(0, 0, 0, 0)";
  shadowBlur = 0;

  #record(method, args) {
    this.calls.push({ method, args });
  }

  setTransform(...args) {
    this.#record("setTransform", args);
  }

  fillRect(...args) {
    this.#record("fillRect", args);
  }

  fillText(...args) {
    this.#record("fillText", args);
  }

  strokeText(...args) {
    this.#record("strokeText", args);
  }

  rect(...args) {
    this.#record("rect", args);
  }

  arc(...args) {
    this.#record("arc", args);
  }

  ellipse(...args) {
    this.#record("ellipse", args);
  }

  quadraticCurveTo(...args) {
    this.#record("quadraticCurveTo", args);
  }

  bezierCurveTo(...args) {
    this.#record("bezierCurveTo", args);
  }

  rotate(...args) {
    this.#record("rotate", args);
  }

  setLineDash(...args) {
    this.#record("setLineDash", args);
  }

  createLinearGradient(...args) {
    this.#record("createLinearGradient", args);
    return new FakeGradient();
  }

  createRadialGradient(...args) {
    this.#record("createRadialGradient", args);
    return new FakeGradient();
  }

  beginPath() {
    this.#record("beginPath", []);
  }

  moveTo(...args) {
    this.#record("moveTo", args);
  }

  lineTo(...args) {
    this.#record("lineTo", args);
  }

  arcTo(...args) {
    this.#record("arcTo", args);
  }

  closePath() {
    this.#record("closePath", []);
  }

  fill() {
    this.#record("fill", []);
  }

  stroke() {
    this.#record("stroke", []);
  }

  save() {
    this.#record("save", []);
    this.#stack.push(Object.fromEntries(STATE_PROPERTIES.map((property) => [property, this[property]])));
  }

  restore() {
    this.#record("restore", []);
    const saved = this.#stack.pop();
    if (saved !== undefined) {
      Object.assign(this, saved);
    }
  }

  clip() {
    this.#record("clip", []);
  }

  translate(...args) {
    this.#record("translate", args);
  }

  scale(...args) {
    this.#record("scale", args);
  }

  measureText(text) {
    return { width: text.length * 8 };
  }

  /** Texts drawn so far, in order. */
  get texts() {
    return this.calls.filter((call) => call.method === "fillText").map((call) => call.args[0]);
  }
}

/** A canvas element with a fixed CSS size and listener bookkeeping. */
export class FakeCanvas {
  clientWidth;
  clientHeight;
  width = 0;
  height = 0;
  /** @type {Map<string, Function[]>} */
  listeners = new Map();
  context = new FakeContext2D();
  captured = [];

  constructor(clientWidth = 1600, clientHeight = 900) {
    this.clientWidth = clientWidth;
    this.clientHeight = clientHeight;
  }

  getContext(kind) {
    return kind === "2d" ? this.context : null;
  }

  getBoundingClientRect() {
    return { left: 10, top: 20, width: this.clientWidth, height: this.clientHeight };
  }

  addEventListener(type, handler) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== handler));
  }

  setPointerCapture(pointerId) {
    this.captured.push(pointerId);
  }

  dispatch(type, event) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

export class FakeWindow {
  devicePixelRatio;
  /** @type {Map<string, Function[]>} */
  listeners = new Map();

  constructor(devicePixelRatio = 1) {
    this.devicePixelRatio = devicePixelRatio;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== handler));
  }

  dispatch(type, event) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

/** Manual frame scheduler. */
export class FakeFrames {
  #queue = [];
  #next = 1;
  time = 0;

  requestFrame = (callback) => {
    const handle = this.#next;
    this.#next += 1;
    this.#queue.push({ handle, callback });
    return handle;
  };

  cancelFrame = (handle) => {
    this.#queue = this.#queue.filter((entry) => entry.handle !== handle);
  };

  now = () => this.time;

  /** Advances time and runs one frame. */
  tick(deltaMs = 16) {
    this.time += deltaMs;
    const pending = this.#queue;
    this.#queue = [];
    for (const entry of pending) {
      entry.callback(this.time);
    }
  }

  get pending() {
    return this.#queue.length;
  }
}

/** Synthetic DOM event with preventDefault tracking. */
export function fakeEvent(fields) {
  return { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields };
}

export const themeRaw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../data/ui/theme.json"), "utf8"));

export function loadTheme() {
  const result = validateTheme(themeRaw);
  if (!result.ok) {
    throw new Error(JSON.stringify(result));
  }
  return result.value;
}
