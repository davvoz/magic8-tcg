/**
 * Ports of the catalog module.
 *
 * @typedef {object} ContentRepository
 * @property {(version: { hash: string, payload: string, engineVersion: string, cards: readonly Readonly<{ id: string }>[] }) => Promise<void>} publish
 *   stores the version if new, makes it current and upserts its card definitions, atomically
 * @property {(hash: string) => Promise<string | null>} payload the exact canonical payload of a published version
 * @property {(hash: string) => Promise<string | null>} engineVersion the engine version a published version was validated with
 */

export const CONTENT_REPOSITORY_METHODS = Object.freeze(["publish", "payload", "engineVersion"]);
