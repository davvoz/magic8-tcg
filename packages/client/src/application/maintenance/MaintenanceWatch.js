/**
 * Follows the announced maintenance: read once when the page loads (anyone,
 * signed in or not), then pushed by the server on the player's realtime
 * connection ("maintenance"). After a reconnection it reads again: pushes may
 * have gone by while the connection was down.
 */
import { parseMaintenanceNotice } from "./MaintenanceNotice.js";

/** @typedef {import("./MaintenanceNotice.js").MaintenanceNotice} MaintenanceNotice */

export class MaintenanceWatch {
  #load;
  /** @type {MaintenanceNotice | null} */
  #notice = null;
  /** @type {Set<(notice: MaintenanceNotice | null) => void>} */
  #listeners = new Set();

  /** @param {{ load: () => Promise<MaintenanceNotice | null> }} deps `load` answers null when it cannot read */
  constructor({ load }) {
    this.#load = load;
  }

  /** @returns {MaintenanceNotice | null} */
  get notice() {
    return this.#notice;
  }

  async refresh() {
    this.#set(await this.#load());
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
        void this.refresh();
      }
    });
  }

  /**
   * @param {(notice: MaintenanceNotice | null) => void} listener
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
