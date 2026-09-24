/**
 * Widget kit added in Increment 7: ScrollList, TextField, Modal, and the
 * Scene behaviours that drive them (wheel, drag, key routing, modal focus).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { CardDetail } from "../../src/rendering/cards/CardDetail.js";
import { typeLineFor } from "../../src/rendering/cards/CardFace.js";
import { Scene } from "../../src/rendering/scenes/Scene.js";
import { Button } from "../../src/rendering/ui/Button.js";
import { Label } from "../../src/rendering/ui/Label.js";
import { Modal } from "../../src/rendering/ui/Modal.js";
import { ScrollList } from "../../src/rendering/ui/ScrollList.js";
import { TextField } from "../../src/rendering/ui/TextField.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();

function services() {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true };
}

const pointer = (type, x, y) => ({ type, x, y, button: 0, pointerId: 1 });
const key = (name) => ({ type: "keydown", key: name, repeat: false });

/** A list of `count` 40px rows in a 200px viewport at (100, 100). */
function listWithRows(scene, count) {
  const list = scene.root.add(new ScrollList({ id: "list", x: 100, y: 100, width: 300, height: 200 }));
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    rows.push(list.add(new Button({ id: `row${index}`, x: 0, y: index * 40, width: 300, height: 36, text: `row ${index}`, onActivate: () => rows[index].activated = (rows[index].activated ?? 0) + 1 })));
  }
  list.contentHeight = count * 40;
  return { list, rows };
}

describe("ScrollList", () => {
  it("clamps scrolling, moves row bounds, and hides rows outside the viewport from hit-testing", () => {
    const scene = new Scene(services());
    const { list, rows } = listWithRows(scene, 20);
    assert.equal(list.maxScrollY, 600);
    assert.equal(scene.root.hitTest({ x: 150, y: 110 }), rows[0]);
    assert.equal(scene.root.hitTest({ x: 150, y: 310 }), null, "below the viewport");
    assert.equal(list.scrollBy(-50), false, "already at the top");
    assert.equal(list.scrollBy(100), true);
    assert.equal(list.scrollY, 100);
    assert.deepEqual(rows[0].bounds, { x: 100, y: 0, width: 300, height: 36 });
    assert.equal(scene.root.hitTest({ x: 150, y: 110 }), rows[2], "row 2 now at the top");
    assert.equal(scene.root.hitTest({ x: 150, y: 50 }), null, "row 0 scrolled out is not hit even though its bounds contain the point");
    list.scrollTo(10000);
    assert.equal(list.scrollY, 600);
    list.clearRows();
    assert.equal(list.contentHeight, 0);
    assert.equal(list.scrollY, 0);
    assert.equal(list.children.length, 1, "only the content container remains");
  });

  it("scrolls with the wheel over it and with a drag, which cancels the press", () => {
    const scene = new Scene(services());
    const { list, rows } = listWithRows(scene, 20);
    scene.onPointer({ type: "wheel", x: 150, y: 150, deltaY: 80 });
    assert.equal(list.scrollY, 80);
    scene.onPointer({ type: "wheel", x: 10, y: 10, deltaY: 80 });
    assert.equal(list.scrollY, 80, "wheel outside is ignored");

    scene.onPointer(pointer("down", 150, 190));
    const pressedRow = scene.root.hitTest({ x: 150, y: 190 });
    assert.equal(pressedRow.pressed, true);
    scene.onPointer(pointer("move", 150, 186));
    assert.equal(pressedRow.pressed, true, "below the drag threshold");
    scene.onPointer(pointer("move", 150, 150));
    assert.equal(pressedRow.pressed, false, "drag cancels the press");
    assert.equal(list.scrollY, 120, "content follows the finger");
    scene.onPointer(pointer("up", 150, 150));
    assert.ok(rows.every((row) => row.activated === undefined), "a drag never activates");

    scene.onPointer(pointer("down", 150, 150));
    scene.onPointer(pointer("up", 150, 150));
    assert.equal(rows.filter((row) => row.activated === 1).length, 1, "a plain tap still activates");
  });

  it("reveals rows that receive keyboard focus", () => {
    const scene = new Scene(services());
    const { list, rows } = listWithRows(scene, 20);
    scene.focus(rows[10]);
    assert.equal(list.scrollY, 10 * 40 + 36 - 200, "scrolled just enough to show row 10");
    scene.focus(rows[0]);
    assert.equal(list.scrollY, 0);
    scene.onKey(key("ArrowUp"));
    assert.equal(scene.focusedNode, rows[19], "wraps to the last row");
    assert.equal(list.scrollY, 19 * 40 + 36 - 200, "row 19 fully visible");
  });

  it("clips its content when drawing and paints a scrollbar only when needed", () => {
    const scene = new Scene(services());
    const { list } = listWithRows(scene, 3);
    const short = new FakeContext2D();
    scene.render(short);
    assert.ok(short.calls.filter((call) => call.method === "clip").length >= 1, "content clipped");
    assert.equal(short.calls.filter((call) => call.method === "save").length, short.calls.filter((call) => call.method === "restore").length);
    const fillsBefore = short.calls.filter((call) => call.method === "fill").length;
    list.contentHeight = 4000;
    const long = new FakeContext2D();
    scene.render(long);
    assert.equal(long.calls.filter((call) => call.method === "fill").length, fillsBefore + 2, "scrollbar track and thumb");
  });
});

describe("Scene secondary actions", () => {
  class Inspecting extends Scene {
    inspected = [];

    onSecondary(node) {
      this.inspected.push(node.id);
    }
  }

  it("fires on right-click, on a long press that does not move, and on the inspect key", () => {
    const scene = new Inspecting(services());
    let activated = 0;
    scene.root.add(new Button({ id: "b", x: 0, y: 0, width: 100, height: 40, text: "B", onActivate: () => (activated += 1) }));
    const disabled = scene.root.add(new Button({ id: "d", x: 0, y: 100, width: 100, height: 40, text: "D", enabled: false, onActivate: () => undefined }));
    scene.onPointer({ type: "down", x: 10, y: 10, button: 2, pointerId: 1 });
    scene.onPointer({ type: "up", x: 10, y: 10, button: 2, pointerId: 1 });
    assert.deepEqual(scene.inspected, ["b"]);
    assert.equal(activated, 0, "a right-click never activates");

    scene.onPointer({ type: "down", x: 10, y: 110, button: 0, pointerId: 1 });
    assert.equal(scene.update(200), false);
    assert.equal(scene.update(300), true, "long press fired");
    assert.deepEqual(scene.inspected, ["b", "d"], "disabled nodes can still be inspected");
    scene.onPointer({ type: "up", x: 10, y: 110, button: 0, pointerId: 1 });
    assert.equal(disabled.pressed, false);

    scene.onPointer(pointer("down", 10, 10));
    scene.onPointer(pointer("move", 10, 40));
    assert.equal(scene.update(1000), false, "moving cancels the long press");
    scene.onPointer(pointer("up", 10, 40));
    assert.equal(activated, 0, "released elsewhere");

    scene.onPointer(pointer("down", 10, 10));
    scene.onPointer(pointer("up", 10, 10));
    assert.equal(activated, 1, "a quick tap still activates");
    assert.equal(scene.update(1000), false, "nothing pending after the release");

    scene.onKey(key("i"));
    assert.deepEqual(scene.inspected, ["b", "d", "b"], "I inspects the focused node");
  });
});

describe("TextField", () => {
  it("accepts allowed characters up to maxLength, handles backspace and Enter, and consumes Space", () => {
    const scene = new Scene(services());
    const changes = [];
    let submits = 0;
    const field = scene.root.add(new TextField({ id: "name", x: 0, y: 0, width: 300, height: 40, maxLength: 5, onChange: (value) => changes.push(value), onSubmit: () => (submits += 1) }));
    const button = scene.root.add(new Button({ x: 0, y: 100, width: 100, height: 40, text: "B", onActivate: () => assert.fail("Space must not activate while typing") }));
    scene.onPointer(pointer("down", 10, 10));
    scene.onPointer(pointer("up", 10, 10));
    assert.equal(scene.focusedNode, field, "click focuses the field");
    for (const character of ["A", "b", " ", "<", "1", "é", "9", "x"]) {
      scene.onKey(key(character));
    }
    assert.equal(field.value, "Ab 1é", "'<' rejected, length capped at 5");
    scene.onKey(key("Backspace"));
    assert.equal(field.value, "Ab 1");
    assert.deepEqual(changes, ["A", "Ab", "Ab ", "Ab 1", "Ab 1é", "Ab 1"]);
    scene.onKey(key("Enter"));
    assert.equal(submits, 1);
    scene.onKey(key("Tab"));
    assert.equal(scene.focusedNode, button, "Tab still moves focus");
    scene.onKey(key("Backspace"));
    assert.equal(field.value, "Ab 1", "unfocused field ignores keys");
  });

  it("draws the placeholder when empty and unfocused, the value plus caret when focused", () => {
    const scene = new Scene(services());
    const field = scene.root.add(new TextField({ x: 0, y: 0, width: 300, height: 40, placeholder: "Deck name" }));
    const empty = new FakeContext2D();
    scene.render(empty);
    assert.ok(empty.texts.includes("Deck name"));
    scene.focus(field);
    scene.onKey(key("Z"));
    const typed = new FakeContext2D();
    scene.render(typed);
    assert.ok(typed.texts.includes("Z|"));
    const disabled = new TextField({ x: 0, y: 0, width: 10, height: 10, enabled: false });
    assert.equal(disabled.handleKey(key("a")), false);
  });
});

describe("Modal", () => {
  it("confines focus and pointer input, closes on Escape or backdrop click, and restores focus", () => {
    const scene = new Scene(services());
    let underneath = 0;
    const below = scene.root.add(new Button({ id: "below", x: 10, y: 10, width: 100, height: 40, text: "below", onActivate: () => (underneath += 1) }));
    scene.focus(below);
    let dismissed = 0;
    const modal = new Modal({ id: "m", width: 1600, height: 900, panelWidth: 400, panelHeight: 200, onDismiss: () => { dismissed += 1; scene.closeModal(); } });
    const inside = modal.panel.add(new Button({ id: "inside", x: 10, y: 10, width: 100, height: 40, text: "inside", onActivate: () => undefined }));
    scene.openModal(modal);
    assert.equal(scene.modal, modal);
    assert.equal(scene.focusedNode, inside, "first focusable inside the modal");
    scene.onKey(key("Tab"));
    assert.equal(scene.focusedNode, inside, "focus never leaves the modal");
    scene.onPointer(pointer("down", 20, 20));
    scene.onPointer(pointer("up", 20, 20));
    assert.equal(underneath, 0, "click on the backdrop does not reach the button underneath");
    assert.equal(dismissed, 1, "…it dismisses instead");
    assert.equal(scene.modal, null);
    assert.equal(scene.focusedNode, below, "focus restored");

    scene.openModal(modal);
    scene.onKey(key("Escape"));
    assert.equal(dismissed, 2);
    assert.equal(scene.modal, null);
    scene.onKey(key("Escape"));
    assert.equal(dismissed, 2, "no modal: Escape is a no-op");

    const context = new FakeContext2D();
    scene.openModal(modal);
    scene.render(context);
    assert.equal(context.globalAlpha, 1, "alpha restored after the backdrop");
    assert.ok(context.texts.includes("inside"));
  });
});

describe("Label fit and CardDetail", () => {
  it("ellipsizes labels that do not fit their width", () => {
    const context = new FakeContext2D();
    new Label({ width: 100, height: 20, text: "a".repeat(40), fit: true }).draw(context, theme);
    new Label({ width: 100, height: 20, text: "a".repeat(40) }).draw(context, theme);
    const [fitted, raw] = context.texts;
    assert.ok(fitted.endsWith("…") && fitted.length < 14, fitted);
    assert.equal(raw, "a".repeat(40));
  });

  it("renders name, cost, type line, keywords, wrapped text and stats for a creature; no stats for a spell", () => {
    const creature = content.catalog.all().find((card) => card.isCreature && card.keywords.length > 0);
    const spell = content.catalog.all().find((card) => card.isSpell);
    const context = new FakeContext2D();
    new CardDetail({ width: 380, height: 560, card: creature }).draw(context, theme);
    assert.ok(context.texts.includes(creature.name));
    assert.ok(context.texts.includes(String(creature.cost)));
    assert.ok(context.texts.includes(typeLineFor(creature)));
    assert.ok(context.texts.includes(creature.keywords.join(" · ")));
    const statTexts = context.texts.slice(context.texts.indexOf(typeLineFor(creature)) + 1);
    assert.ok(statTexts.includes(String(creature.attack)) && statTexts.includes(String(creature.health)), "attack and health gems");
    const spellContext = new FakeContext2D();
    new CardDetail({ width: 380, height: 560, card: spell }).draw(spellContext, theme);
    const spellTexts = spellContext.texts.slice(spellContext.texts.indexOf(typeLineFor(spell)) + 1);
    assert.ok(!spellTexts.includes(String(spell.attack)) && !spellTexts.includes(String(spell.health)), "spells have no stat gems");
    assert.ok(spellContext.texts.some((text) => spell.text.startsWith(text.split(" ")[0])), "rules text is drawn");
  });
});
