/**
 * Follows what the server says about itself, for the banner over the game:
 * - the announced maintenance: read when the page loads (anyone, signed in or
 *   not), then pushed on the player's realtime connection ("maintenance"),
 *   and read again after a reconnection (pushes may have gone by meanwhile)
 *   and on every poll;
 * - the version it serves: a build other than the one this page runs
 *   (src/release.js, stamped when the image is built) means a deploy went
 *   live and the page is out of date;
 * - whether the realtime connection is lost (a deploy, a network drop).
 */

import { parseMaintenanceNotice } from "./MaintenanceNotice.js";

/** @typedef {import("./MaintenanceNotice.js").MaintenanceNotice} MaintenanceNotice */
/** @typedef {Readonly<{ notice: MaintenanceNotice | null, version: string | null, build: string | null }>} ServerStatus */

export class MaintenanceWatch {
  #load;
  #now;
  /** @type {MaintenanceNotice | null} */
  #notice = null;
  /** The release this page runs; build null in development (never out of date). @type {Readonly<{ version: string, build: string | null }>} */
  #page;
  /** The server's version while it serves another build than the page's, if it is another version too; else null. @type {string | null} */
  #newVersion = null;
  #updateAvailable = false;
  /** When the realtime connection was lost; null while it is up (or was never opened). @type {number | null} */
  #disconnectedSince = null;
  /** @type {Set<(notice: MaintenanceNotice | null) => void>} */
  #listeners = new Set();

  /**
   * @param {{ load: () => Promise<ServerStatus | null>, now: () => number, page: Readonly<{ version: string, build: string | null }> }} deps
   *   `load` answers null when it cannot read; `now` in epoch milliseconds; `page` the release this page runs (src/release.js)
   */
  constructor({ load, now, page }) {
    this.#load = load;
    this.#now = now;
    this.#page = page;
  }

  /** @returns {MaintenanceNotice | null} */
  get notice() {
    return this.#notice;
  }

  /** A newer version than the one this page runs is live: reloading picks it up. */
  get updateAvailable() {
    return this.#updateAvailable;
  }

  /** @returns {string | null} the version the server now serves (e.g. "0.3.0") while the page is out of date, if not the page's own */
  get newVersion() {
    return this.#newVersion;
  }

  /** @returns {number | null} epoch milliseconds the realtime connection went down, null while it is up */
  get disconnectedSince() {
    return this.#disconnectedSince;
  }

  /** Reads again. A failed read (server down, mid-deploy) changes nothing: what was known still holds. */
  async refresh() {
    const status = await this.#load();
    if (status === null) {
      return;
    }
    if (this.#page.build !== null && status.build !== null) {
      // Back on the page's build (a rollback), the page is up to date again.
      this.#updateAvailable = status.build !== this.#page.build;
      // A deploy without a new version number is still an update, just not one to name.
      this.#newVersion = this.#updateAvailable && status.version !== this.#page.version ? status.version : null;
    }
    this.#set(status.notice);
  }

  /** @param {import("../ports/Realtime.contract.js").RealtimeConnection} connection */
  follow(connection) {
    connection.subscribe((message) => {
      if (message.t === "maintenance") {
        this.#set(parseMaintenanceNotice(message.d?.maintenance ?? null));
      }
    });
    connection.onStatus((status) => {
      if (status === "open") {
        this.#disconnectedSince = null;
        this.#set(this.#notice);
        void this.refresh();
      } else if (status === "closed" && this.#disconnectedSince === null) {
        this.#disconnectedSince = this.#now();
        this.#set(this.#notice);
      }
    });
  }

  /**
   * @param {(notice: MaintenanceNotice | null) => void} listener called on every change
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** @param {MaintenanceNotice | null} notice */
  #set(notice) {
    this.#notice = notice;
    for (const listener of this.#listeners) {
      listener(notice);
    }
  }
}
