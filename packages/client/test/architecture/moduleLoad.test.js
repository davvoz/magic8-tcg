/**
 * Every module under src/ (except the browser entrypoint) must import
 * cleanly in Node: no top-level access to browser globals, no broken import
 * paths. Catches mistakes in files that only the browser would otherwise load.
 */
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

const SRC = resolve("src");

function listJsFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listJsFiles(full));
    } else if (entry.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

describe("architecture: module loading", () => {
  const modules = listJsFiles(SRC).filter((path) => relative(SRC, path) !== "main.js");
  for (const path of modules) {
    it(`imports ${relative(SRC, path).replaceAll("\\", "/")}`, async () => {
      await assert.doesNotReject(() => import(pathToFileURL(path).href));
    });
  }
});
