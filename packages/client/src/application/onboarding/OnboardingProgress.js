/**
 * What a new player has done of the first-time guide that only this
 * browser can know (for the Home screen's Next step): the tutorial played to
 * its end, a first daily challenge won, a first online game finished — the
 * last two for each account signed in here — and whether the player hid the
 * guide. The rest of the guide (the starter deck, ranked play) is read from
 * the account and the ranked standing (OnboardingGuide).
 *
 * Loaded once and saved on every change. What is read back is untrusted:
 * anything that is not a boolean where one is expected counts as not done.
 */

/** The milestones kept here: the tutorial for the browser, the others for each account. */
export const Milestone = Object.freeze({
  TUTORIAL: "tutorial",
  CHALLENGE: "challenge",
  ONLINE: "online",
});

/** How many accounts' milestones are kept: the latest signed in. */
const MAX_ACCOUNTS = 8;
const ACCOUNT_PATTERN = /^[a-z0-9.-]{1,32}$/;

/**
 * @typedef {Readonly<{ challenge: boolean, online: boolean }>} AccountMilestones
 * @typedef {Readonly<{ tutorial: boolean, dismissed: boolean, accounts: Readonly<Record<string, AccountMilestones>> }>} OnboardingRecord
 */

/** @type {OnboardingRecord} */
const EMPTY = Object.freeze({ tutorial: false, dismissed: false, accounts: Object.freeze({}) });
const NO_MILESTONES = Object.freeze({ challenge: false, online: false });

export class OnboardingProgress {
  #preferences;
  /** @type {OnboardingRecord} */
  #record;
  /** @type {Set<(record: OnboardingRecord) => void>} */
  #listeners = new Set();

  /** @param {{ preferences: import("../ports/OnboardingPreferences.contract.js").OnboardingPreferences }} deps */
  constructor({ preferences }) {
    this.#preferences = preferences;
    this.#record = parseOnboarding(preferences.load());
  }

  /** @returns {OnboardingRecord} */
  get record() {
    return this.#record;
  }

  /** Whether the player hid the guide. */
  get dismissed() {
    return this.#record.dismissed;
  }

  /**
   * @param {string} milestone one of Milestone
   * @param {string | null} account whose (the tutorial is the browser's: any account, or none)
   */
  has(milestone, account) {
    if (milestone === Milestone.TUTORIAL) {
      return this.#record.tutorial;
    }
    const kept = account === null ? undefined : this.#record.accounts[account];
    return milestone === Milestone.CHALLENGE ? kept?.challenge === true : kept?.online === true;
  }

  /**
   * Notes a milestone reached; one already noted changes nothing.
   * @param {string} milestone one of Milestone
   * @param {string | null} [account] whose: required for every milestone but the tutorial
   */
  reach(milestone, account = null) {
    if (this.has(milestone, account)) {
      return;
    }
    if (milestone === Milestone.TUTORIAL) {
      this.#set({ ...this.#record, tutorial: true });
      return;
    }
    if (account === null || !ACCOUNT_PATTERN.test(account) || (milestone !== Milestone.CHALLENGE && milestone !== Milestone.ONLINE)) {
      return;
    }
    const kept = this.#record.accounts[account] ?? NO_MILESTONES;
    const others = Object.entries(this.#record.accounts).filter(([name]) => name !== account).slice(-(MAX_ACCOUNTS - 1));
    const accounts = Object.freeze(Object.fromEntries([...others, [account, Object.freeze({ ...kept, [milestone]: true })]]));
    this.#set({ ...this.#record, accounts });
  }

  /** Hides the guide for good (its steps still count). */
  dismiss() {
    if (!this.#record.dismissed) {
      this.#set({ ...this.#record, dismissed: true });
    }
  }

  /**
   * @param {(record: OnboardingRecord) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** @param {OnboardingRecord} record */
  #set(record) {
    this.#record = Object.freeze(record);
    this.#preferences.save(this.#record);
    this.#listeners.forEach((listener) => listener(this.#record));
  }
}

/**
 * @param {unknown} raw what was stored, from anywhere
 * @returns {OnboardingRecord}
 */
export function parseOnboarding(raw) {
  if (raw === null || typeof raw !== "object") {
    return EMPTY;
  }
  const { tutorial, dismissed, accounts } = /** @type {Record<string, unknown>} */ (raw);
  const kept = accounts !== null && typeof accounts === "object" ? Object.entries(accounts).filter(([name]) => ACCOUNT_PATTERN.test(name)).slice(-MAX_ACCOUNTS) : [];
  return Object.freeze({
    tutorial: tutorial === true,
    dismissed: dismissed === true,
    accounts: Object.freeze(Object.fromEntries(kept.map(([name, value]) => [name, parseMilestones(value)]))),
  });
}

/** @param {unknown} value */
function parseMilestones(value) {
  const fields = value !== null && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value) : {};
  return Object.freeze({ challenge: fields.challenge === true, online: fields.online === true });
}
