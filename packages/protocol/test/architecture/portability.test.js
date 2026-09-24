/**
 * The protocol runs on the server and in the browser (anyone can verify a
 * game locally), and must be deterministic: no Node or browser APIs, no
 * clocks, no ambient randomness, and only the dependencies declared here.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";

const SRC = resolve(import.meta.dirname, "../../src");
const ALLOWED_PACKAGES = Object.freeze(["@magic8/engine/", "@noble/hashes/"]);
const FORBIDDEN = Object.freeze([
  { pattern: /\bprocess\b|\brequire\s*\(|\bBuffer\b/, reason: "Node-only API" },
  { pattern: /\bwindow\b|\bdocument\b|\blocalStorage\b|\bfetch\s*\(/, reason: "browser-only API or I/O" },
  { pattern: /\bMath\.random\b|\bcrypto\.getRandomValues\b/, reason: "randomness must be passed in" },
  { pattern: /\bDate\.now\b|\bnew\s+Date\b|\bperformance\.now\b/, reason: "time must be passed in" },
  { pattern: /\bsetTimeout\b|\bsetInterval\b/, reason: "no timers" },
  { pattern: /\bconsole\./, reason: "no logging in the protocol" },
  { pattern: /\beval\s*\(|\bnew\s+Function\b|\bimport\s*\(/, reason: "dynamic code" },
]);
const IMPORT_PATTERN = /^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm;

function listJsFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      return listJsFiles(full);
    }
    return entry.endsWith(".js") ? [full] : [];
  });
}

const modules = listJsFiles(SRC).map((path) => {
  const raw = readFileSync(path, "utf8");
  return { name: relative(SRC, path), code: raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), imports: [...raw.matchAll(IMPORT_PATTERN)].map((match) => match[1]) };
});

describe("architecture: protocol portability", () => {
  it("finds modules", () => {
    assert.ok(modules.length > 5);
  });

  it("imports only relative modules, the engine and @noble/hashes", () => {
    for (const module of modules) {
      for (const specifier of module.imports) {
        const allowed = specifier.startsWith("./") || specifier.startsWith("../") || ALLOWED_PACKAGES.some((prefix) => specifier.startsWith(prefix));
        assert.ok(allowed, `${module.name} imports "${specifier}"`);
      }
    }
  });

  it("uses no platform APIs, clocks, randomness or dynamic code", () => {
    for (const module of modules) {
      for (const { pattern, reason } of FORBIDDEN) {
        assert.ok(!pattern.test(module.code), `${module.name}: ${reason} (${pattern})`);
      }
    }
  });
});
