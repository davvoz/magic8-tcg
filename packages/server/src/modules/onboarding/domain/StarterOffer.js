/**
 * The free starter offer (docs/tcg/06-roadmap.md, decision 3): a new player
 * picks one of a few balanced preconstructed decks and receives its cards,
 * once. The offer is data (data/economy/starter-offer.json), validated
 * against the current content at startup.
 *
 * @typedef {Readonly<{ edition: string, finish: string, choices: readonly import("@magic8/engine/domain/decks/DeckList.js").DeckList[] }>} StarterOffer
 */
import { Issues, checkArray, checkInteger, checkObject, checkString, checkUnique } from "@magic8/engine/shared/validation.js";

const OFFER_KEYS = Object.freeze(["schemaVersion", "edition", "finish", "choices"]);
const PRINTING_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_CHOICES = 5;

/**
 * @param {unknown} raw
 * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content
 * @returns {import("@magic8/engine/shared/Result.js").Ok<StarterOffer> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validateStarterOffer(raw, content) {
  const issues = new Issues();
  const object = checkObject(issues, raw, "starterOffer", OFFER_KEYS);
  if (object === undefined) {
    return issues.toResult(undefined);
  }
  checkInteger(issues, object.schemaVersion, "starterOffer.schemaVersion", { min: 1, max: 1 });
  const edition = checkString(issues, object.edition, "starterOffer.edition", { pattern: PRINTING_PATTERN });
  const finish = checkString(issues, object.finish, "starterOffer.finish", { pattern: PRINTING_PATTERN });
  const ids = checkArray(issues, object.choices, "starterOffer.choices", { minLength: 1, maxLength: MAX_CHOICES });
  /** @type {import("@magic8/engine/domain/decks/DeckList.js").DeckList[]} */
  const choices = [];
  if (ids !== undefined && checkUnique(issues, ids, "starterOffer.choices", String)) {
    ids.forEach((id, index) => {
      const deck = content.preconDecks.find((candidate) => candidate.id === id);
      if (deck === undefined) {
        issues.add(`starterOffer.choices[${index}]`, `"${String(id)}" is not a preconstructed deck`);
      } else {
        choices.push(deck);
      }
    });
  }
  return issues.toResult(Object.freeze({ edition: /** @type {string} */ (edition), finish: /** @type {string} */ (finish), choices: Object.freeze(choices) }));
}
