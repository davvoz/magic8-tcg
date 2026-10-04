/**
 * The device's own keyboard for the text fields drawn on the canvas. A phone
 * shows its keyboard only for an HTML input the player tapped, so while the
 * game is played by touch every text field on screen gets a real <input>
 * laid exactly over it (style in index.html, class "field-input"): the tap
 * lands on the input itself, and the browser focuses it and opens the
 * keyboard on its own.
 *
 * Inputs are matched to fields by id, not by object: a screen that lays
 * itself out again — the keyboard opening resizes the window of an installed
 * app — builds new fields, and the same input, still focused, carries on
 * over the new one. Every change goes straight to the field, which keeps
 * only what it accepts; Enter submits the field and moves on to the field
 * the scene focuses next, or closes the keyboard.
 *
 * @typedef {Readonly<{ field: import("../ui/TextField.js").TextField, x: number, y: number, width: number, height: number, scale: number }>} FieldPlacement
 *   where the field is on the page, in CSS pixels, and the canvas's scale (logical → CSS)
 */

/** How each kind of field asks for its keyboard. */
const KEYBOARDS = Object.freeze({
  text: Object.freeze({ inputMode: "text", autocapitalize: "sentences", autocorrect: "on" }),
  account: Object.freeze({ inputMode: "text", autocapitalize: "none", autocorrect: "off" }),
  decimal: Object.freeze({ inputMode: "decimal", autocapitalize: "none", autocorrect: "off" }),
  secret: Object.freeze({ inputMode: "text", autocapitalize: "none", autocorrect: "off" }),
});

/** The canvas field's own look, in logical units (TextField), scaled with the canvas. */
const FIELD = Object.freeze({ fontSize: 20, padding: 14, radius: 10 });

export class FieldInputs {
  #page;
  #hooks;
  /** @type {Map<string, { input: HTMLInputElement, field: import("../ui/TextField.js").TextField }>} */
  #inputs = new Map();

  /**
   * @param {Document} page
   * @param {{ onChange: () => void, onFocus: (field: import("../ui/TextField.js").TextField) => void, focusedField: () => import("../ui/TextField.js").TextField | null }} hooks
   *   `onChange`: a field's value changed (the canvas redraws); `onFocus`: the player is typing into a field;
   *   `focusedField`: the field the scene focuses now (where Enter moves on to)
   */
  constructor(page, hooks) {
    this.#page = page;
    this.#hooks = hooks;
  }

  /**
   * Lays an input over each field given and removes those of fields no longer there.
   * @param {readonly FieldPlacement[]} placements
   */
  sync(placements) {
    const kept = new Set();
    for (const placement of placements) {
      const { field } = placement;
      if (field.id.length === 0) {
        continue;
      }
      kept.add(field.id);
      const entry = this.#inputs.get(field.id) ?? this.#create(field);
      entry.field = field;
      this.#configure(entry.input, field);
      this.#place(entry.input, placement);
      if (!this.#focused(entry.input)) {
        entry.input.value = field.value;
      } else if (entry.input.value !== field.value) {
        // A field rebuilt under the keyboard takes what is typed so far.
        this.#typed(entry);
      }
    }
    for (const [id, entry] of this.#inputs) {
      if (!kept.has(id)) {
        // Taking a focused input away closes the keyboard; what was typed (a key, maybe) goes with it.
        entry.input.remove();
        this.#inputs.delete(id);
      }
    }
  }

  /** Closes the keyboard, if an input has it. */
  blur() {
    for (const { input } of this.#inputs.values()) {
      if (this.#focused(input)) {
        input.blur();
      }
    }
  }

  /** @param {import("../ui/TextField.js").TextField} field */
  #create(field) {
    const input = this.#page.createElement("input");
    input.className = "field-input";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    const entry = { input, field };
    this.#inputs.set(field.id, entry);
    input.addEventListener("input", () => this.#typed(entry));
    input.addEventListener("focus", () => this.#hooks.onFocus(entry.field));
    input.addEventListener("keydown", (event) => {
      if (/** @type {KeyboardEvent} */ (event).key === "Enter") {
        event.preventDefault();
        this.#submit(entry);
      }
    });
    this.#page.body.append(input);
    return entry;
  }

  /**
   * @param {HTMLInputElement} input
   * @param {import("../ui/TextField.js").TextField} field
   */
  #configure(input, field) {
    const keyboard = KEYBOARDS[field.keyboard] ?? KEYBOARDS.text;
    const type = field.secret ? "password" : "text";
    if (input.type !== type) {
      input.type = type;
    }
    input.inputMode = keyboard.inputMode;
    input.placeholder = field.placeholder;
    input.maxLength = field.maxLength;
    input.setAttribute("autocapitalize", keyboard.autocapitalize);
    input.setAttribute("autocorrect", keyboard.autocorrect);
    input.setAttribute("enterkeyhint", "done");
    input.setAttribute("aria-label", field.placeholder);
  }

  /**
   * @param {HTMLInputElement} input
   * @param {FieldPlacement} placement
   */
  #place(input, { x, y, width, height, scale }) {
    const style = input.style;
    style.left = `${x}px`;
    style.top = `${y}px`;
    style.width = `${width}px`;
    style.height = `${height}px`;
    style.fontSize = `${FIELD.fontSize * scale}px`;
    style.padding = `0 ${FIELD.padding * scale}px`;
    style.borderRadius = `${FIELD.radius * scale}px`;
  }

  /** @param {{ input: HTMLInputElement, field: import("../ui/TextField.js").TextField }} entry */
  #typed({ input, field }) {
    const kept = field.enter(input.value);
    if (kept !== input.value) {
      input.value = kept;
    }
    this.#hooks.onChange();
  }

  /**
   * Enter: the field submits; the keyboard moves on to the field the scene
   * focuses then (the key after the account name), or closes.
   * @param {{ input: HTMLInputElement, field: import("../ui/TextField.js").TextField }} entry
   */
  #submit(entry) {
    entry.field.onSubmit();
    const next = this.#hooks.focusedField();
    const nextInput = next === null || next.id === entry.field.id ? undefined : this.#inputs.get(next.id)?.input;
    if (nextInput === undefined) {
      entry.input.blur();
    } else {
      nextInput.focus();
    }
    this.#hooks.onChange();
  }

  /** @param {HTMLInputElement} input */
  #focused(input) {
    return this.#page.activeElement === input;
  }
}
