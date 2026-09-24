/**
 * Port for reading raw (unvalidated) content. Infrastructure decides where
 * it comes from (fetch, bundled objects, files); ContentService validates.
 *
 * @typedef {object} ContentSource
 * @property {(resource: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<unknown> | import("@magic8/engine/shared/Result.js").Fail>} load One of ContentResource.
 */
import { ContentResource } from "@magic8/engine/domain/content/GameContent.js";

export { ContentResource };

export const CONTENT_RESOURCES = Object.freeze(Object.values(ContentResource));
