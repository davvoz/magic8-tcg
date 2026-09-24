import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deepFreeze } from "../../src/shared/deepFreeze.js";
import { fail, isOk, ok } from "../../src/shared/Result.js";
import {
  Issues,
  checkArrayOf,
  checkEnum,
  checkInteger,
  checkObject,
  checkString,
  checkUnique,
  isPlainObject,
  isSafeKey,
} from "../../src/shared/validation.js";

describe("Result", () => {
  it("creates frozen ok and fail values", () => {
    const success = ok(42);
    const failure = fail("CODE", "message", { detail: 1 });
    assert.equal(success.value, 42);
    assert.equal(isOk(success), true);
    assert.equal(isOk(failure), false);
    assert.equal(failure.error.code, "CODE");
    assert.ok(Object.isFrozen(success));
    assert.ok(Object.isFrozen(failure.error));
  });

  it("treats non-results as not ok", () => {
    assert.equal(isOk(null), false);
    assert.equal(isOk({ ok: "true" }), false);
  });
});

describe("isPlainObject / isSafeKey", () => {
  it("accepts literals and JSON output, rejects arrays, class instances and null", () => {
    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject(JSON.parse('{"a":1}')), true);
    assert.equal(isPlainObject(Object.create(null)), true);
    assert.equal(isPlainObject([]), false);
    assert.equal(isPlainObject(null), false);
    assert.equal(isPlainObject(new Date(0)), false);
    assert.equal(isPlainObject("x"), false);
  });

  it("rejects prototype-polluting keys", () => {
    assert.equal(isSafeKey("__proto__"), false);
    assert.equal(isSafeKey("constructor"), false);
    assert.equal(isSafeKey("prototype"), false);
    assert.equal(isSafeKey("name"), true);
    assert.equal(isSafeKey(1), false);
  });
});

describe("checks", () => {
  it("checkObject rejects forbidden keys coming from JSON.parse", () => {
    const issues = new Issues();
    const polluted = JSON.parse('{"__proto__": {"admin": true}, "a": 1}');
    assert.equal(checkObject(issues, polluted, "root"), undefined);
    assert.match(issues.list()[0], /forbidden key/);
  });

  it("checkObject reports unknown fields but still returns the object", () => {
    const issues = new Issues();
    const value = checkObject(issues, { a: 1, extra: 2 }, "root", ["a"]);
    assert.deepEqual(value, { a: 1, extra: 2 });
    assert.deepEqual(issues.list(), ["root.extra: unknown field"]);
  });

  it("checkString enforces length and pattern", () => {
    const issues = new Issues();
    assert.equal(checkString(issues, "abc", "p", { maxLength: 2 }), undefined);
    assert.equal(checkString(issues, "ABC", "p", { pattern: /^[a-z]+$/ }), undefined);
    assert.equal(checkString(issues, 5, "p"), undefined);
    assert.equal(checkString(issues, "ok", "p", { minLength: 1, maxLength: 2 }), "ok");
    assert.equal(issues.count, 3);
  });

  it("checkInteger rejects floats, NaN, strings and out-of-range values", () => {
    const issues = new Issues();
    assert.equal(checkInteger(issues, 1.5, "p"), undefined);
    assert.equal(checkInteger(issues, Number.NaN, "p"), undefined);
    assert.equal(checkInteger(issues, "3", "p"), undefined);
    assert.equal(checkInteger(issues, 11, "p", { min: 0, max: 10 }), undefined);
    assert.equal(checkInteger(issues, 10, "p", { min: 0, max: 10 }), 10);
    assert.equal(issues.count, 4);
  });

  it("checkEnum does not coerce", () => {
    const issues = new Issues();
    assert.equal(checkEnum(issues, 1, "p", ["1"]), undefined);
    assert.equal(checkEnum(issues, "b", "p", ["a", "b"]), "b");
  });

  it("checkArrayOf validates items with indexed paths", () => {
    const issues = new Issues();
    const result = checkArrayOf(issues, [1, "x", 3], "list", {
      maxLength: 5,
      item: (item, path) => checkInteger(issues, item, path),
    });
    assert.equal(result, undefined);
    assert.deepEqual(issues.list(), ["list[1]: expected an integer"]);
  });

  it("checkUnique reports duplicates by key", () => {
    const issues = new Issues();
    const unique = checkUnique(issues, [{ id: "a" }, { id: "b" }, { id: "a" }], "items", (x) => x.id);
    assert.equal(unique, false);
    assert.deepEqual(issues.list(), ['items[2]: duplicate "a"']);
  });

  it("Issues.toResult returns ok when empty and a VALIDATION failure otherwise", () => {
    const empty = new Issues();
    assert.equal(isOk(empty.toResult("v")), true);
    const filled = new Issues();
    filled.add("a", "bad");
    const result = filled.toResult("v");
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "VALIDATION");
    assert.deepEqual(result.error.details.problems, ["a: bad"]);
  });
});

describe("deepFreeze", () => {
  it("freezes nested objects and arrays", () => {
    const value = deepFreeze({ a: { b: [1, { c: 2 }] } });
    assert.ok(Object.isFrozen(value.a));
    assert.ok(Object.isFrozen(value.a.b));
    assert.ok(Object.isFrozen(value.a.b[1]));
  });

  it("tolerates cycles", () => {
    const value = { self: null };
    value.self = value;
    assert.doesNotThrow(() => deepFreeze(value));
    assert.ok(Object.isFrozen(value));
  });

  it("rejects structures deeper than the limit", () => {
    let nested = {};
    const root = nested;
    for (let depth = 0; depth < 80; depth += 1) {
      nested.child = {};
      nested = nested.child;
    }
    assert.throws(() => deepFreeze(root), RangeError);
  });
});
