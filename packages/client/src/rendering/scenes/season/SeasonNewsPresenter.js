/**
 * The season's news (SeasonNewsDialog) as a screen shows it: opened on a
 * page, kept open across the screen's rebuilds (a screen that clears its
 * tree opens it again with `restore`, the same show where it was, or a new
 * one on the same page when the design area changed), its show ticked, and
 * marked seen by the signed-in account once closed, however it was.
 * Home opens it when due, and again from its season card's What's new.
 */
import { buildSeasonNewsDialog } from "./SeasonNewsDialog.js";

/**
 * @typedef {{
 *   services: import("../Scene.js").SceneServices,
 *   openModal: (modal: import("../../ui/Modal.js").Modal) => void,
 *   closeModal: () => void,
 * }} NewsHost the screen it opens over
 */

export class SeasonNewsPresenter {
  #host;
  #app;
  /** @type {import("./SeasonNewsDialog.js").SeasonNewsDialog | null} */
  #dialog = null;

  /**
   * @param {NewsHost} host
   * @param {import("../../../application/AppContext.js").AppContext} app
   */
  constructor(host, app) {
    this.#host = host;
    this.#app = app;
  }

  /** The season's news, or null when there is none to tell. */
  get news() {
    return this.#app.seasonNews?.news ?? null;
  }

  get isOpen() {
    return this.#dialog !== null;
  }

  /** Whether the signed-in account has yet to see this season's news. */
  get isDue() {
    return this.#app.seasonNews?.isDue(this.#account()) === true;
  }

  /**
   * @param {{ page?: number, settled?: boolean }} [at] `settled`: every page at its end, silent (previews)
   */
  open({ page = 0, settled = false } = {}) {
    const news = this.news;
    if (news === null) {
      return;
    }
    this.#dialog = this.#build(news, page, settled);
    this.#host.openModal(this.#dialog.modal);
  }

  /** Opens it again after the screen cleared its tree, if it was open. */
  restore() {
    const news = this.news;
    if (this.#dialog === null || news === null) {
      return;
    }
    const { viewport } = this.#host.services;
    if (this.#dialog.builtFor.width !== viewport.logicalWidth || this.#dialog.builtFor.height !== viewport.logicalHeight) {
      this.#dialog = this.#build(news, this.#dialog.show.page, true);
    }
    this.#host.openModal(this.#dialog.modal);
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether to draw again
   */
  tick(dtMs) {
    return this.#dialog?.show.tick(dtMs) ?? false;
  }

  /** Forgets it without closing (the screen is leaving). */
  drop() {
    this.#dialog = null;
  }

  #close() {
    this.#app.seasonNews?.markSeen(this.#account());
    this.#dialog = null;
    this.#host.closeModal();
  }

  /**
   * @param {import("../../../application/season/SeasonNews.js").SeasonNews} news
   * @param {number} page
   * @param {boolean} settled
   */
  #build(news, page, settled) {
    const { catalog } = this.#app.content;
    const { services } = this.#host;
    return buildSeasonNewsDialog({
      viewport: services.viewport,
      news,
      cardOf: (cardId) => catalog.get(cardId) ?? null,
      rarityOf: (cardId) => this.#app.rarities?.of(cardId) ?? null,
      play: (cue, options) => services.sound?.play(cue, options),
      onClose: () => this.#close(),
      startPage: page,
      settled,
    });
  }

  /** The account signed in, by name. */
  #account() {
    return this.#app.account?.state.account ?? null;
  }
}
