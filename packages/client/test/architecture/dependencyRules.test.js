/**
 * Architecture tests: enforce the layer dependency direction and the
 * "no browser, no nondeterminism" rules for the domain, by scanning import
 * statements and source text of every module under src/. The rules engine
 * lives in the @magic8/engine package; its `domain/` and `shared/` modules
 * are imported by bare specifier and count as those layers here.
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

const ENGINE_PREFIX = "@magic8/engine/";
const ENGINE_LAYERS = Object.freeze(["domain", "shared"]);
/** Workspace packages only infrastructure adapters may use (protocol formats, STEEM signatures). */
const ADAPTER_PACKAGES = Object.freeze(["@magic8/protocol", "@magic8/steem"]);

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

/** @param {string} path */
function fileName(path) {
  const normalised = path.replaceAll("\\", "/");
  return normalised.slice(normalised.lastIndexOf("/") + 1);
}

/**
 * @param {string} fromPath importing module
 * @param {string} specifier
 * @returns {{ layer: string, label: string }}
 */
function targetOf(fromPath, specifier) {
  if (specifier.startsWith(ENGINE_PREFIX)) {
    return { layer: specifier.slice(ENGINE_PREFIX.length).split("/")[0], label: specifier };
  }
  const target = resolve(dirname(fromPath), specifier);
  return { layer: layerOf(target), label: relative(SRC, target) };
}

const modules = listJsFiles(SRC).map((path) => {
  const raw = readFileSync(path, "utf8");
  return { path, layer: layerOf(path), code: stripComments(raw), imports: importSpecifiers(raw) };
});

describe("architecture: module dependencies", () => {
  it("finds source modules", () => {
    assert.ok(modules.length > 0, "no modules under src/");
  });

  it("uses only relative imports or the engine package, and the protocol and STEEM packages only in adapters", () => {
    for (const module of modules) {
      for (const specifier of module.imports) {
        const relativeImport = specifier.startsWith("./") || specifier.startsWith("../");
        const engineImport = specifier.startsWith(ENGINE_PREFIX) && ENGINE_LAYERS.includes(specifier.slice(ENGINE_PREFIX.length).split("/")[0]);
        const adapterImport = module.layer === "infrastructure" && ADAPTER_PACKAGES.includes(specifier);
        assert.ok(relativeImport || engineImport || adapterImport, `${relative(SRC, module.path)} imports "${specifier}"`);
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
        const target = targetOf(module.path, specifier);
        const permitted = target.layer === module.layer || allowed.includes(target.layer);
        assert.ok(
          permitted,
          `${relative(SRC, module.path)} (${module.layer}) must not import ${target.label} (${target.layer})`,
        );
      }
    }
  });

  it("lets presentation layers import only frozen enums and command factories from the domain", () => {
    for (const module of modules.filter((m) => m.layer === "input" || m.layer === "rendering")) {
      for (const specifier of module.imports) {
        const target = targetOf(module.path, specifier);
        if (target.layer !== "domain") {
          continue;
        }
        assert.ok(
          DOMAIN_MODULES_VISIBLE_TO_PRESENTATION.includes(fileName(target.label)),
          `${relative(SRC, module.path)} imports domain internals ${target.label}`,
        );
      }
    }
  });
});

describe("architecture: forbidden constructs", () => {
  it("keeps browser APIs, clocks, timers and Math.random out of the application layer", () => {
    for (const module of modules.filter((m) => m.layer === "application")) {
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
