import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InputManager } from "../../src/input/InputManager.js";
import { KeyMap, isKey } from "../../src/input/KeyMap.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { FakeCanvas, FakeWindow, fakeEvent } from "../rendering/fakes.js";

function setup() {
  const canvas = new FakeCanvas(800, 450);
  const window = new FakeWindow();
  const viewport = new Viewport({ logicalWidth: 1600, logicalHeight: 900 });
  viewport.resize({ cssWidth: 800, cssHeight: 450 });
  const received = { pointer: [], key: [] };
  const manager = new InputManager({
    canvas,
    window,
    viewport,
    target: { onPointer: (input) => received.pointer.push(input), onKey: (input) => received.key.push(input) },
  });
  manager.attach();
  return { canvas, window, manager, received };
}

describe("InputManager", () => {
  it("normalises pointer events into logical coordinates relative to the canvas", () => {
    const { canvas, window, received } = setup();
    const downEvent = fakeEvent({ clientX: 10 + 400, clientY: 20 + 225, button: 0, pointerId: 7 });
    canvas.dispatch("pointerdown", downEvent);
    assert.deepEqual(received.pointer[0], { type: "down", x: 800, y: 450, button: 0, pointerId: 7 });
    assert.equal(downEvent.defaultPrevented, true);
    assert.deepEqual(canvas.captured, [7]);
    canvas.dispatch("pointermove", fakeEvent({ clientX: 10, clientY: 20, button: 0, pointerId: 7 }));
    window.dispatch("pointerup", fakeEvent({ clientX: 10 + 800, clientY: 20 + 450, button: 0, pointerId: 7 }));
    window.dispatch("pointercancel", fakeEvent({ clientX: 0, clientY: 0, pointerId: 7 }));
    assert.deepEqual(received.pointer.map((input) => input.type), ["down", "move", "up", "cancel"]);
    assert.deepEqual([received.pointer[1].x, received.pointer[1].y], [0, 0]);
    assert.deepEqual([received.pointer[2].x, received.pointer[2].y], [1600, 900]);
    assert.ok(Object.isFrozen(received.pointer[0]));
  });

  it("clamps wheel deltas and prevents the page from scrolling", () => {
    const { canvas, received } = setup();
    const wheel = fakeEvent({ clientX: 10, clientY: 20, deltaY: 5000 });
    canvas.dispatch("wheel", wheel);
    assert.equal(wheel.defaultPrevented, true);
    assert.deepEqual(received.pointer[0], { type: "wheel", x: 0, y: 0, deltaY: 200 });
  });

  it("forwards keys, suppressing browser defaults only for navigation keys and ignoring shortcuts", () => {
    const { window, received } = setup();
    const space = fakeEvent({ key: " ", repeat: false });
    const letter = fakeEvent({ key: "e", repeat: true });
    const reload = fakeEvent({ key: "r", ctrlKey: true });
    window.dispatch("keydown", space);
    window.dispatch("keyup", letter);
    window.dispatch("keydown", fakeEvent({ key: 5 }));
    window.dispatch("keydown", reload);
    window.dispatch("keydown", fakeEvent({ key: "q", metaKey: true }));
    window.dispatch("keydown", fakeEvent({ key: "@", altKey: true, ctrlKey: true }));
    assert.equal(reload.defaultPrevented, false, "Ctrl+R keeps working");
    assert.equal(space.defaultPrevented, true);
    assert.equal(letter.defaultPrevented, false);
    assert.deepEqual(received.key, [
      { type: "keydown", key: " ", repeat: false },
      { type: "keyup", key: "e", repeat: true },
    ]);
  });

  it("detaches every listener", () => {
    const { canvas, window, manager, received } = setup();
    manager.detach();
    canvas.dispatch("pointerdown", fakeEvent({ clientX: 0, clientY: 0, pointerId: 1 }));
    window.dispatch("keydown", fakeEvent({ key: "Enter" }));
    assert.equal(received.pointer.length, 0);
    assert.equal(received.key.length, 0);
    assert.ok([...canvas.listeners.values()].every((handlers) => handlers.length === 0));
    assert.ok([...window.listeners.values()].every((handlers) => handlers.length === 0));
  });
});

describe("KeyMap", () => {
  it("matches bindings", () => {
    assert.equal(isKey("Enter", KeyMap.CONFIRM), true);
    assert.equal(isKey("Escape", KeyMap.CONFIRM), false);
  });
});
