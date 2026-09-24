/**
 * STEEM account name rules (protocol `is_valid_account_name`):
 * 3–16 characters; dot-separated labels, each at least 3 characters, starting
 * with a letter, ending with a letter or digit, containing only lowercase
 * letters, digits and dashes.
 */

const MIN_LENGTH = 3;
const MAX_LENGTH = 16;
const LABEL_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/**
 * @param {unknown} name
 * @returns {name is string}
 */
export function isValidAccountName(name) {
  if (typeof name !== "string" || name.length < MIN_LENGTH || name.length > MAX_LENGTH) {
    return false;
  }
  return name.split(".").every((label) => label.length >= MIN_LENGTH && LABEL_PATTERN.test(label));
}
