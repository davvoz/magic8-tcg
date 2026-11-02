/**
 * The house players' own decks (docs/tcg/25-bot.md): deck lists the server
 * lets a house account play without owning their cards, so the bots can
 * sit down with more than their free starter. The decks are files like the
 * preconstructed ones (data/decks/house/), and which account plays which is
 * data too (data/decks/house-decks.json), both validated at startup.
 *
 * @typedef {import("@magic8/engine/domain/decks/DeckList.js").DeckList} DeckList
 * @typedef {ReadonlyMap<string, readonly DeckList[]>} HouseDecks the decks of each house account
 */
import { validateDeck } from "@magic8/engine/domain/decks/DeckValidator.js";
import { validateDeckList } from "@magic8/engine/domain/decks/validateDeckList.js";
import { Issues, checkArray, checkInteger, checkObject, checkUnique } from "@magic8/engine/shared/validation.js";

const FILE_KEYS = Object.freeze(["schemaVersion", "accounts"]);
/** A STEEM account name, as far as a data file needs checking. */
const ACCOUNT_PATTERN = /^[a-z][a-z0-9.-]{2,15}$/;
const MAX_ACCOUNTS = 32;
const MAX_DECKS_PER_ACCOUNT = 5;

/**
 * @param {{ decks: unknown, accounts: unknown }} raw `decks`: the deck-list files, in file name order; `accounts`: the assignment file
 * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content
 * @returns {import("@magic8/engine/shared/Result.js").Ok<HouseDecks> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validateHouseDecks(raw, content) {
  const issues = new Issues();
  const byId = readDecks(issues, raw.decks, content);
  return issues.toResult(/** @type {HouseDecks} */ (readAccounts(issues, raw.accounts, byId)));
}

/**
 * The legal deck lists, by id.
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content
 * @returns {ReadonlyMap<string, DeckList>}
 */
function readDecks(issues, raw, content) {
  /** @type {Map<string, DeckList>} */
  const byId = new Map();
  const files = checkArray(issues, raw, "houseDecks", { maxLength: MAX_ACCOUNTS * MAX_DECKS_PER_ACCOUNT });
  for (const [index, file] of (files ?? []).entries()) {
    const list = validateDeckList(file);
    if (!list.ok) {
      issues.add(`houseDecks[${index}]`, list.error.message);
      continue;
    }
    const report = validateDeck(list.value, content.deckRules, content.catalog);
    if (!report.valid) {
      issues.add(`houseDecks[${index}] (${list.value.id})`, `breaks deck rules: ${report.problems[0].message}`);
    } else if (byId.has(list.value.id)) {
      issues.add(`houseDecks[${index}] (${list.value.id})`, "another house deck has this id");
    } else {
      byId.set(list.value.id, list.value);
    }
  }
  return byId;
}

/**
 * Each house account's decks.
 * @param {Issues} issues
 * @param {unknown} raw the assignment file
 * @param {ReadonlyMap<string, DeckList>} byId
 * @returns {Map<string, readonly DeckList[]>}
 */
function readAccounts(issues, raw, byId) {
  /** @type {Map<string, readonly DeckList[]>} */
  const assigned = new Map();
  const file = checkObject(issues, raw, "houseAccounts", FILE_KEYS);
  if (file === undefined) {
    return assigned;
  }
  checkInteger(issues, file.schemaVersion, "houseAccounts.schemaVersion", { min: 1, max: 1 });
  const accounts = Object.entries(checkObject(issues, file.accounts, "houseAccounts.accounts") ?? {});
  if (accounts.length > MAX_ACCOUNTS) {
    issues.add("houseAccounts.accounts", `at most ${MAX_ACCOUNTS} accounts`);
  }
  for (const [account, ids] of accounts.slice(0, MAX_ACCOUNTS)) {
    const path = `houseAccounts.accounts.${account}`;
    if (!ACCOUNT_PATTERN.test(account)) {
      issues.add(path, "not an account name");
    }
    const list = checkArray(issues, ids, path, { minLength: 1, maxLength: MAX_DECKS_PER_ACCOUNT });
    if (list === undefined || !checkUnique(issues, list, path, String)) {
      continue;
    }
    list.forEach((id, index) => byId.has(String(id)) || issues.add(`${path}[${index}]`, `"${String(id)}" is not a house deck`));
    assigned.set(account, Object.freeze(list.map((id) => byId.get(String(id))).filter((deck) => deck !== undefined)));
  }
  return assigned;
}
