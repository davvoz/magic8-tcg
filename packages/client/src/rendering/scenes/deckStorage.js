/**
 * Where the player's own decks are kept, in words: the account while
 * signed in, this browser otherwise (or memory, when storage is blocked).
 * Shared by the screens that mention it so they never disagree.
 */

/**
 * @param {import("../../application/AppContext.js").AppContext} app
 * @returns {string} e.g. "saved to @alice's account"
 */
export function deckStorageText(app) {
  const account = app.account?.state.account ?? null;
  if (account !== null) {
    return `saved to @${account}'s account`;
  }
  return app.environment.storage === "local" ? "saved in this browser" : "kept in memory only (storage unavailable)";
}
