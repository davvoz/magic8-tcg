/**
 * Module boundaries of the modular monolith (docs/tcg/01-architettura.md §3, §5):
 * - a module imports another module only through its index.js;
 * - a module's domain layer imports nothing outside its own domain, the
 *   kernel's pure helpers and the engine/protocol packages;
 * - no console, eval or dynamic import in server code (the logger is the only sink).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";

const SRC = resolve(import.meta.dirname, "../../src");
const MODULES = join(SRC, "modules");
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

const files = listJsFiles(SRC).map((path) => {
  const raw = readFileSync(path, "utf8");
  return { path, name: relative(SRC, path).split(sep).join("/"), code: raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), imports: [...raw.matchAll(IMPORT_PATTERN)].map((match) => match[1]) };
});

/** @param {string} path absolute */
function moduleOf(path) {
  const rel = relative(MODULES, path);
  return rel.startsWith("..") ? null : rel.split(sep)[0];
}

describe("architecture: server module boundaries", () => {
  it("finds modules", () => {
    assert.ok(files.some((file) => file.name.startsWith("modules/identity/")));
  });

  it("crosses module boundaries only through index.js", () => {
    for (const file of files) {
      const own = moduleOf(file.path);
      for (const specifier of file.imports.filter((candidate) => candidate.startsWith("."))) {
        const target = resolve(dirname(file.path), specifier);
        const other = moduleOf(target);
        if (other !== null && other !== own) {
          assert.equal(relative(join(MODULES, other), target), "index.js", `${file.name} reaches into ${relative(SRC, target)}`);
        }
      }
    }
  });

  it("keeps domain layers free of infrastructure", () => {
    for (const file of files.filter((candidate) => candidate.name.includes("/domain/"))) {
      for (const specifier of file.imports) {
        const allowed = specifier.startsWith("./") || specifier.startsWith("@magic8/engine/") || specifier === "@magic8/protocol";
        assert.ok(allowed, `${file.name} imports ${specifier}`);
      }
    }
  });

  it("uses no console, eval or dynamic import", () => {
    for (const file of files) {
      assert.ok(!/\bconsole\./.test(file.code), `${file.name} uses console`);
      assert.ok(!/\beval\s*\(|\bnew\s+Function\b|\bimport\s*\(/.test(file.code), `${file.name} uses dynamic code`);
    }
  });

  it("never reads the clock or randomness directly outside the kernel and main.js", () => {
    for (const file of files.filter((candidate) => !candidate.name.startsWith("kernel/") && candidate.name !== "main.js")) {
      assert.ok(!/\bDate\.now\b|\bMath\.random\b|\brandomBytes\b|\bgetRandomValues\b/.test(file.code), `${file.name} reads the clock or randomness`);
    }
  });
});
