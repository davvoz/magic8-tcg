/**
 * The real inputs laid over the canvas's text fields when the game is played
 * by touch (page/FieldInputs.js), against a page as far as they touch it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FieldInputs } from "../../src/rendering/page/FieldInputs.js";
import { TextField } from "../../src/rendering/ui/TextField.js";

function fakePage() {
  const page = {
    /** @type {object | null} */
    activeElement: null,
    /** @type {object[]} */
    inputs: [],
    body: {
      append(input) {
        page.inputs.push(input);
      },
    },
    createElement() {
      const listeners = new Map();
      const input = {
        type: "text",
        value: "",
        placeholder: "",
        maxLength: -1,
        inputMode: "",
        className: "",
        style: {},
        attributes: new Map(),
        setAttribute(name, value) {
          this.attributes.set(name, value);
        },
        addEventListener(type, handler) {
          listeners.set(type, handler);
        },
        focus() {
          page.activeElement = input;
          listeners.get("focus")?.();
        },
        blur() {
          if (page.activeElement === input) {
            page.activeElement = null;
          }
        },
        remove() {
          input.blur();
          page.inputs = page.inputs.filter((other) => other !== input);
        },
        /** The player types: the input's whole new value. */
        typeIn(text) {
          input.value = text;
          listeners.get("input")?.();
        },
        press(key) {
          const event = { key, prevented: false, preventDefault: () => (event.prevented = true) };
          listeners.get("keydown")?.(event);
          return event;
        },
      };
      return input;
    },
  };
  return page;
}

const at = (field, x = 10, y = 20) => Object.freeze({ field, x, y, width: 300, height: 50, scale: 0.5 });

function setUp() {
  const page = fakePage();
  const state = { changes: 0, focusedField: /** @type {TextField | null} */ (null), focusedFromInput: /** @type {TextField[]} */ ([]) };
  const inputs = new FieldInputs(/** @type {Document} */ (/** @type {unknown} */ (page)), {
    onChange: () => (state.changes += 1),
    onFocus: (field) => state.focusedFromInput.push(field),
    focusedField: () => state.focusedField,
  });
  return { page, inputs, state };
}

describe("FieldInputs", () => {
  it("lays an input over each field, shaped and asking for the field's keyboard, and removes those of fields gone", () => {
    const { page, inputs } = setUp();
    const account = new TextField({ id: "account", value: "alice", placeholder: "Account", maxLength: 17, keyboard: "account" });
    const key = new TextField({ id: "key", placeholder: "Key", maxLength: 60, keyboard: "secret" });
    inputs.sync([at(account), at(key, 10, 80)]);
    assert.equal(page.inputs.length, 2);
    const [first, second] = page.inputs;
    assert.equal(first.value, "alice");
    assert.equal(first.type, "text");
    assert.equal(first.attributes.get("autocapitalize"), "none");
    assert.equal(first.maxLength, 17);
    assert.deepEqual([first.style.left, first.style.top, first.style.width, first.style.height, first.style.fontSize], ["10px", "20px", "300px", "50px", "10px"]);
    assert.equal(second.type, "password", "a key is typed hidden");
    assert.equal(second.style.top, "80px");
    inputs.sync([at(account)]);
    assert.deepEqual(page.inputs, [first], "the key's field went, and its input with it");
  });

  it("hands what is typed to the field, filtered, and keeps typing into the field rebuilt under the keyboard", () => {
    const { page, inputs, state } = setUp();
    const field = new TextField({ id: "account", maxLength: 17, keyboard: "account" });
    inputs.sync([at(field)]);
    const [input] = page.inputs;
    input.focus();
    assert.deepEqual(state.focusedFromInput, [field], "the scene hears which field is typed into");
    input.typeIn("al<i>ce");
    assert.equal(field.value, "alice");
    assert.equal(input.value, "alice", "the input keeps only what the field accepts");
    assert.ok(state.changes > 0, "the canvas redraws");
    // The keyboard resized the window; the scene laid itself out again, with a new field of the same id.
    const rebuilt = new TextField({ id: "account", value: field.value, maxLength: 17, keyboard: "account" });
    inputs.sync([at(rebuilt, 40, 10)]);
    assert.deepEqual(page.inputs, [input], "the same input, still focused: the keyboard stays open");
    assert.equal(page.activeElement, input);
    assert.equal(input.style.left, "40px");
    input.typeIn("alice2");
    assert.equal(rebuilt.value, "alice2", "what is typed lands in the field on screen");
    assert.equal(field.value, "alice", "not in the one no longer shown");
  });

  it("gives a field rebuilt under the keyboard what was typed, and leaves a field alone while not typed into", () => {
    const { page, inputs } = setUp();
    const field = new TextField({ id: "price", maxLength: 10, keyboard: "decimal" });
    inputs.sync([at(field)]);
    const [input] = page.inputs;
    input.focus();
    input.value = "1.5";
    const rebuilt = new TextField({ id: "price", maxLength: 10, keyboard: "decimal" });
    inputs.sync([at(rebuilt)]);
    assert.equal(rebuilt.value, "1.5");
    input.blur();
    rebuilt.value = "";
    inputs.sync([at(rebuilt)]);
    assert.equal(input.value, "", "the scene's value shows when the player is not typing");
  });

  it("submits on Enter, moving on to the field the scene focuses next, or putting the keyboard away", () => {
    const { page, inputs, state } = setUp();
    const submitted = [];
    const key = new TextField({ id: "key", keyboard: "secret", onSubmit: () => submitted.push("key") });
    const account = new TextField({ id: "account", keyboard: "account", onSubmit: () => {
      submitted.push("account");
      state.focusedField = key;
    } });
    inputs.sync([at(account), at(key)]);
    const [accountInput, keyInput] = page.inputs;
    accountInput.focus();
    assert.equal(accountInput.press("Enter").prevented, true);
    assert.equal(page.activeElement, keyInput, "on to the key");
    keyInput.press("Enter");
    assert.deepEqual(submitted, ["account", "key"]);
    assert.equal(page.activeElement, null, "nothing after it: the keyboard goes");
  });

  it("closes the keyboard on demand, and with its field", () => {
    const { page, inputs } = setUp();
    const field = new TextField({ id: "account" });
    inputs.sync([at(field)]);
    const [input] = page.inputs;
    input.focus();
    inputs.blur();
    assert.equal(page.activeElement, null);
    input.focus();
    inputs.sync([]);
    assert.equal(page.activeElement, null);
    assert.equal(page.inputs.length, 0);
  });
});
