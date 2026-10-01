/**
 * The maintenance banner: an HTML strip over the top of the canvas (style in
 * index.html, class "maintenance-banner"). It lets clicks through to the
 * game, except on its button when it has one (e.g. "Reload").
 */
export class MaintenanceBanner {
  #element;
  #text;
  #button;
  /** @type {(() => void) | null} */
  #onActivate = null;

  /** @param {Document} page */
  constructor(page) {
    this.#element = page.createElement("div");
    this.#element.className = "maintenance-banner";
    this.#element.setAttribute("role", "status");
    this.#element.hidden = true;
    this.#text = page.createElement("span");
    this.#button = page.createElement("button");
    this.#button.type = "button";
    this.#button.hidden = true;
    this.#button.addEventListener("click", () => this.#onActivate?.());
    this.#element.append(this.#text, this.#button);
    page.body.append(this.#element);
  }

  /**
   * @param {string | null} text null hides the banner
   * @param {Readonly<{ label: string, onActivate: () => void }> | null} [action] a button after the text
   */
  show(text, action = null) {
    if (text === null) {
      this.#element.hidden = true;
      return;
    }
    if (this.#text.textContent !== text) {
      this.#text.textContent = text;
    }
    this.#onActivate = action?.onActivate ?? null;
    if (action !== null && this.#button.textContent !== action.label) {
      this.#button.textContent = action.label;
    }
    this.#button.hidden = action === null;
    this.#element.hidden = false;
  }
}
