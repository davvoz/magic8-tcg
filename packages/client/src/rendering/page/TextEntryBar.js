/**
 * The device's own keyboard for a text field drawn on the canvas. A phone
 * shows its keyboard only for a focused HTML input, so a field tapped with a
 * finger is edited here: an HTML strip pinned to the top of the screen (the
 * keyboard covers the bottom half of a phone in landscape), holding a native
 * input with the field's value, placeholder and length, and a Done button
 * (style in index.html, class "text-entry"). Every change goes straight to
 * the field, which keeps only what it accepts; Enter submits the field.
 * Leaving the input — Done, a tap on the game, the keyboard dismissed —
 * closes the strip. The keyboard opening may resize the window (an installed
 * app) and the screen rebuild its fields: the scene then `retarget`s the strip
 * to the new field.
 *
 * `open` must run inside the tap's own event handler: browsers only show the
 * keyboard for a focus a user gesture asked for.
 */

/** How each kind of field asks for its keyboard. */
const KEYBOARDS = Object.freeze({
  text: Object.freeze({ inputMode: "text", autocapitalize: "sentences", autocorrect: "on" }),
  account: Object.freeze({ inputMode: "text", autocapitalize: "none", autocorrect: "off" }),
  decimal: Object.freeze({ inputMode: "decimal", autocapitalize: "none", autocorrect: "off" }),
  secret: Object.freeze({ inputMode: "text", autocapitalize: "none", autocorrect: "off" }),
});

export class TextEntryBar {
  #element;
  #input;
  /** @type {import("../ui/TextField.js").TextField | null} */
  #field = null;
  #onChange;

  /**
   * @param {Document} page
   * @param {{ onChange: () => void }} hooks `onChange`: the field's value changed or the strip closed (the canvas redraws)
   */
  constructor(page, { onChange }) {
    this.#onChange = onChange;
    this.#element = page.createElement("form");
    this.#element.className = "text-entry";
    this.#element.hidden = true;
    this.#element.setAttribute("autocomplete", "off");
    this.#input = page.createElement("input");
    this.#input.type = "text";
    this.#input.setAttribute("spellcheck", "false");
    this.#input.setAttribute("enterkeyhint", "done");
    const done = page.createElement("button");
    done.type = "submit";
    done.textContent = "Done";
    this.#element.append(this.#input, done);
    page.body.append(this.#element);
    this.#input.addEventListener("input", () => this.#typed());
    this.#element.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#submit();
    });
    // Done is pressed with a pointer: keep the input focused until the submit has run.
    done.addEventListener("pointerdown", (event) => event.preventDefault());
    this.#input.addEventListener("blur", () => this.close());
  }

  /** The field being edited, if any. */
  get field() {
    return this.#field;
  }

  /** @param {import("../ui/TextField.js").TextField} field */
  open(field) {
    this.#field = field;
    const keyboard = KEYBOARDS[field.keyboard] ?? KEYBOARDS.text;
    this.#input.value = field.value;
    this.#input.placeholder = field.placeholder;
    this.#input.maxLength = field.maxLength;
    // A key or a PIN is typed hidden (the form already keeps the browser's form memory off).
    this.#input.type = field.keyboard === "secret" ? "password" : "text";
    this.#input.inputMode = keyboard.inputMode;
    this.#input.setAttribute("autocapitalize", keyboard.autocapitalize);
    this.#input.setAttribute("autocorrect", keyboard.autocorrect);
    this.#element.hidden = false;
    this.#input.focus();
    this.#onChange();
  }

  /**
   * The field being edited was rebuilt (the screen laid out again under the
   * keyboard): the open input carries on into its replacement, with what was
   * typed so far, without closing the keyboard.
   * @param {import("../ui/TextField.js").TextField} field
   */
  retarget(field) {
    if (this.#field === null || this.#field === field) {
      return;
    }
    this.#field = field;
    this.#typed();
  }

  close() {
    if (this.#field === null) {
      return;
    }
    this.#field = null;
    this.#element.hidden = true;
    // What was typed (a key, maybe) does not stay in the page.
    this.#input.value = "";
    this.#input.blur();
    this.#onChange();
  }

  #typed() {
    const field = this.#field;
    if (field === null) {
      return;
    }
    const kept = field.enter(this.#input.value);
    if (kept !== this.#input.value) {
      this.#input.value = kept;
    }
    this.#onChange();
  }

  #submit() {
    const field = this.#field;
    this.close();
    field?.onSubmit();
  }
}
