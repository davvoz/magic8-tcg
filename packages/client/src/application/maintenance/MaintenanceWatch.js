/**
 * Follows what the server says about itself, for the banner over the game:
 * - the announced maintenance: read when the page loads (anyone, signed in or
 *   not), then pushed on the player's realtime connection ("maintenance"),
 *   and read again after a reconnection (pushes may have gone by meanwhile)
 *   and on every poll;
 * - the version it serves: the first one read is the one this page runs; a
 *   different one later means a deploy went live and the page is out of date;
 * - whether the realtime connection is lost (a deploy, a network drop).
 */

import { parseMaintenanceNotice } from "./MaintenanceNotice.js";

/** @typedef {import("./MaintenanceNotice.js").MaintenanceNotice} MaintenanceNotice */
/** @typedef {Readonly<{ notice: MaintenanceNotice | null, build: string | null }>} ServerStatus */

export class MaintenanceWatch {
  #load;
  #now;
  /** @type {MaintenanceNotice | null} */
  #notice = null;
  /** The version this page runs: the first one the server named. @type {string | null} */
  #pageBuild = null;
  #updateAvailable = false;
  /** When the realtime connection was lost; null while it is up (or was never opened). @type {number | null} */
  #disconnectedSince = null;
  /** @type {Set<(notice: MaintenanceNotice | null) => void>} */
  #listeners = new Set();

  /**
   * @param {{ load: () => Promise<ServerStatus | null>, now: () => number }} deps `load` answers null when it cannot read; `now` in epoch milliseconds
   */
  constructor({ load, now }) {
    this.#load = load;
    this.#now = now;
  }

  /** @returns {MaintenanceNotice | null} */
  get notice() {
    return this.#notice;
  }

  /** A newer version than the one this page runs is live: reloading picks it up. */
  get updateAvailable() {
    return this.#updateAvailable;
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
    if (status.build !== null) {
      this.#pageBuild ??= status.build;
      this.#updateAvailable ||= status.build !== this.#pageBuild;
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
