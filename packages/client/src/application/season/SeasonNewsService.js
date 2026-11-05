/**
 * Whether the season's news (SeasonNews) is still to be shown to a player:
 * once per season for each account signed in from this browser, the latest
 * few remembered. Without news (the file missing or malformed) nothing is
 * ever due.
 */

/** How many accounts' last season seen are kept: the latest signed in. */
const MAX_ACCOUNTS = 8;
const ACCOUNT_PATTERN = /^[a-z0-9.-]{1,32}$/;
const SEASON_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** @typedef {Readonly<{ accounts: Readonly<Record<string, string>> }>} SeenRecord the season id each account last saw the news of */

/** @type {SeenRecord} */
const EMPTY = Object.freeze({ accounts: Object.freeze({}) });

export class SeasonNewsService {
  #news;
  #preferences;
  /** @type {SeenRecord} */
  #record;

  /**
   * @param {{ news: import("./SeasonNews.js").SeasonNews | null, preferences: import("../ports/SeasonNewsPreferences.contract.js").SeasonNewsPreferences }} deps
   */
  constructor({ news, preferences }) {
    this.#news = news;
    this.#preferences = preferences;
    this.#record = parseSeen(preferences.load());
  }

  /** The season's news, or null when there is none to tell. */
  get news() {
    return this.#news;
  }

  /**
   * Whether the account has yet to see this season's news.
   * @param {string | null} account
   */
  isDue(account) {
    return this.#news !== null && account !== null && ACCOUNT_PATTERN.test(account) && this.#record.accounts[account] !== this.#news.id;
  }

  /**
   * Notes that the account has seen this season's news (however far through it they went).
   * @param {string | null} account
   */
  markSeen(account) {
    if (!this.isDue(account) || this.#news === null || account === null) {
      return;
    }
    const others = Object.entries(this.#record.accounts).filter(([name]) => name !== account).slice(-(MAX_ACCOUNTS - 1));
    this.#record = Object.freeze({ accounts: Object.freeze(Object.fromEntries([...others, [account, this.#news.id]])) });
    this.#preferences.save(this.#record);
  }
}

/**
 * @param {unknown} raw what was stored, from anywhere
 * @returns {SeenRecord}
 */
export function parseSeen(raw) {
  const accounts = /** @type {any} */ (raw)?.accounts;
  if (accounts === null || typeof accounts !== "object" || Array.isArray(accounts)) {
    return EMPTY;
  }
  const kept = Object.entries(accounts).filter(([account, season]) => ACCOUNT_PATTERN.test(account) && typeof season === "string" && SEASON_PATTERN.test(season));
  return Object.freeze({ accounts: Object.freeze(Object.fromEntries(kept.slice(-MAX_ACCOUNTS))) });
}
