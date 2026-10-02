/**
 * Writes packages/client/src/release.js: the release the browser client runs,
 * so an open tab can tell when the server has moved on to another one (the
 * banner then offers to update).
 *   version: the root package.json's (semver, the product's version);
 *   build:   M8_BUILD, the commit deploy/deploy.sh builds the image from;
 *            unset in development (null: the page never asks to update).
 * Run by the Dockerfile with the image's M8_BUILD, and by `npm version` (the
 * "version" script) so the committed file follows the version.
 * Usage: [M8_BUILD=<commit>] node tools/stamp-release.js
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
export const RELEASE_FILE = new URL("packages/client/src/release.js", ROOT);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const BUILD_PATTERN = /^[0-9A-Za-z._-]{1,64}$/;

/**
 * @param {{ version: string, build: string | null }} release
 * @returns {string} the source of release.js
 */
export function releaseModule({ version, build }) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`package.json version "${version}" is not semver (1.2.3 or 1.2.3-beta.1)`);
  }
  if (build !== null && !BUILD_PATTERN.test(build)) {
    throw new Error("M8_BUILD: letters, digits, '.', '_' or '-', at most 64");
  }
  return [
    "/**",
    " * The release this page runs, written by tools/stamp-release.js (do not edit):",
    " * the version from the root package.json, the build (the deployed commit) when",
    " * the Docker image is built; null in development.",
    " */",
    `export const RELEASE = Object.freeze({ version: ${JSON.stringify(version)}, build: ${JSON.stringify(build)} });`,
    "",
  ].join("\n");
}

/** @returns {string} the root package.json's version */
export function productVersion() {
  return JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")).version;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const build = process.env.M8_BUILD || null;
  const source = releaseModule({ version: productVersion(), build });
  writeFileSync(RELEASE_FILE, source);
  const suffix = build === null ? "" : `+${build}`;
  console.log(`stamped release ${productVersion()}${suffix}`);
}
