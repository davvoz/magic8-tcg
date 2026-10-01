/**
 * The maintenance banner: an HTML strip over the top of the canvas (style in
 * index.html, class "maintenance-banner"). It lets clicks through to the game.
 */
export class MaintenanceBanner {
  #element;

  /** @param {Document} page */
  constructor(page) {
    this.#element = page.createElement("div");
    this.#element.className = "maintenance-banner";
    this.#element.setAttribute("role", "status");
    this.#element.hidden = true;
    page.body.append(this.#element);
  }

  /** @param {string | null} text null hides the banner */
  show(text) {
    if (text === null) {
      this.#element.hidden = true;
      return;
    }
    if (this.#element.textContent !== text) {
      this.#element.textContent = text;
    }
    this.#element.hidden = false;
  }
}
