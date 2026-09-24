/**
 * Architecture tests: enforce the layer dependency direction and the
 * "no browser, no nondeterminism" rules for the domain, by scanning import
 * statements and source text of every module under src/.
 *
 * See docs/ARCHITECTURE.md §2.1.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";

const SRC = resolve("src");

/** Which layers each layer may import from. `main.js` at the root may import anything. */
const ALLOWED_IMPORTS = Object.freeze({
  shared: [],
  domain: ["shared"],
  application: ["domain", "shared"],
  infrastructure: ["domain", "application", "shared"],
  input: ["application", "domain", "shared"],
  rendering: ["input", "application", "domain", "shared"],
});

/** The only domain modules the presentation layers (input, rendering) may import: frozen enums and command factories. */
const DOMAIN_MODULES_VISIBLE_TO_PRESENTATION = Object.freeze([
  "CardType.js",
  "GamePhase.js",
  "ZoneType.js",
  "GameEventType.js",
  "TriggerType.js",
  "CommandType.js",
  "Keyword.js",
  "TargetSpec.js",
  "commandFactories.js",
]);

/** Patterns forbidden in domain and application code (browser APIs, nondeterminism, diagnostics). */
const FORBIDDEN_IN_DOMAIN = Object.freeze([
  { pattern: /\bwindow\b/, reason: "browser global" },
  { pattern: /\bdocument\b/, reason: "browser global" },
  { pattern: /\bfetch\s*\(/, reason: "I/O belongs to infrastructure" },
  { pattern: /\blocalStorage\b/, reason: "I/O belongs to infrastructure" },
  { pattern: /\bMath\.random\b/, reason: "use the injected RandomSource" },
  { pattern: /\bDate\.now\b|\bnew\s+Date\b/, reason: "no clock in the domain" },
  { pattern: /\bperformance\.now\b/, reason: "no clock in the domain" },
  { pattern: /\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/, reason: "no timers in the domain" },
  { pattern: /\bconsole\./, reason: "use the Logger port" },
]);

/** Patterns forbidden everywhere in src/. */
const FORBIDDEN_EVERYWHERE = Object.freeze([
  { pattern: /\beval\s*\(/, reason: "dynamic code execution" },
  { pattern: /\bnew\s+Function\b/, reason: "dynamic code execution" },
  { pattern: /\bimport\s*\(/, reason: "dynamic import of data-driven paths" },
  { pattern: /\binnerHTML\b|\bouterHTML\b|\bdocument\.write\b/, reason: "unsafe DOM insertion" },
  { pattern: /\bwith\s*\(/, reason: "with statement" },
]);

const IMPORT_PATTERN = /^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT_PATTERN = /^\s*import\s*['"]([^'"]+)['"]/gm;

/**
 * @param {string} directory
 * @returns {string[]} absolute paths of .js files
 */
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

/** @param {string} source */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** @param {string} source */
function importSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT_PATTERN)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/**
 * @param {string} absolutePath
 * @returns {string} "main" for src/main.js, otherwise the first directory under src/
 */
function layerOf(absolutePath) {
  const rel = relative(SRC, absolutePath).split(sep);
  return rel.length === 1 ? "main" : rel[0];
}

/** @param {string} absolutePath */
function fileName(absolutePath) {
  return absolutePath.slice(absolutePath.lastIndexOf(sep) + 1);
}

const modules = listJsFiles(SRC).map((path) => {
  const raw = readFileSync(path, "utf8");
  return { path, layer: layerOf(path), code: stripComments(raw), imports: importSpecifiers(raw) };
});

describe("architecture: module dependencies", () => {
  it("finds source modules", () => {
    assert.ok(modules.length > 0, "no modules under src/");
  });

  it("uses only relative imports (no runtime dependencies, no bare specifiers)", () => {
    for (const module of modules) {
      for (const specifier of module.imports) {
        assert.ok(
          specifier.startsWith("./") || specifier.startsWith("../"),
          `${relative(SRC, module.path)} imports non-relative "${specifier}"`,
        );
      }
    }
  });

  it("respects the layer dependency direction", () => {
    for (const module of modules) {
      if (module.layer === "main") {
        continue;
      }
      const allowed = ALLOWED_IMPORTS[module.layer];
      assert.ok(allowed, `unknown layer "${module.layer}" for ${relative(SRC, module.path)}`);
      for (const specifier of module.imports) {
        const target = resolve(dirname(module.path), specifier);
        const targetLayer = layerOf(target);
        const permitted = targetLayer === module.layer || allowed.includes(targetLayer);
        assert.ok(
          permitted,
          `${relative(SRC, module.path)} (${module.layer}) must not import ${relative(SRC, target)} (${targetLayer})`,
        );
      }
    }
  });

  it("lets presentation layers import only frozen enums and command factories from the domain", () => {
    for (const module of modules.filter((m) => m.layer === "input" || m.layer === "rendering")) {
      for (const specifier of module.imports) {
        const target = resolve(dirname(module.path), specifier);
        if (layerOf(target) !== "domain") {
          continue;
        }
        assert.ok(
          DOMAIN_MODULES_VISIBLE_TO_PRESENTATION.includes(fileName(target)),
          `${relative(SRC, module.path)} imports domain internals ${relative(SRC, target)}`,
        );
      }
    }
  });
});

describe("architecture: forbidden constructs", () => {
  it("keeps browser APIs, clocks, timers and Math.random out of domain and application", () => {
    for (const module of modules.filter((m) => m.layer === "domain" || m.layer === "application")) {
      for (const { pattern, reason } of FORBIDDEN_IN_DOMAIN) {
        assert.ok(
          !pattern.test(module.code),
          `${relative(SRC, module.path)} matches ${pattern} (${reason})`,
        );
      }
    }
  });

  it("never uses dynamic code execution or unsafe DOM insertion anywhere", () => {
    for (const module of modules) {
      for (const { pattern, reason } of FORBIDDEN_EVERYWHERE) {
        assert.ok(
          !pattern.test(module.code),
          `${relative(SRC, module.path)} matches ${pattern} (${reason})`,
        );
      }
    }
  });
});
