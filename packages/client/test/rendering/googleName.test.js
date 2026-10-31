/**
 * A new player back from Google chooses their name (docs/tcg/29-google.md).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { GoogleNameScene } from "../../src/rendering/scenes/GoogleNameScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();

/** @param {{ navigate?: (id: string) => void }} [overrides] */
function services(overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true, ...overrides };
}

/** @param {{ nameStatus?: (name: string) => Promise<any>, createAccount?: (name: string) => Promise<any> }} [google] */
function appWith(google = {}) {
  const checked = [];
  const created = [];
  const service = {
    take: () => null,
    nameStatus: google.nameStatus ?? (async (name) => (checked.push(name), ok({ name, available: true, reason: null }))),
    createAccount: google.createAccount ?? (async (name) => (created.push(name), ok({ id: "u1", network: "steem", account: name }))),
  };
  return { app: /** @type {any} */ ({ identity: { state: { status: "signed-out" } }, google: service }), checked, created };
}

/** @param {import("../../src/rendering/scenes/Scene.js").Scene} scene */
function texts(scene) {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
}

const typeInto = (scene, text) => {
  for (const character of text) {
    scene.onKey({ type: "keydown", key: character, repeat: false });
  }
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("GoogleNameScene", () => {
  it("checks the name once the player pauses, then creates the account and goes home", async () => {
    const navigated = [];
    const { app, checked, created } = appWith();
    const scene = new GoogleNameScene(services({ navigate: (id) => navigated.push(id) }), app);
    scene.enter({});
    typeInto(scene, "newbie");
    scene.update(100);
    assert.deepEqual(checked, [], "not while typing");
    scene.update(500);
    await settle();
    assert.deepEqual(checked, ["newbie"], "once, for the whole name");
    assert.ok(texts(scene).some((text) => text.includes("@newbie is free")));
    scene.onKey({ type: "keydown", key: "Enter", repeat: false });
    await settle();
    assert.deepEqual(created, ["newbie"]);
    assert.deepEqual(navigated, [SceneId.HOME]);
  });

  it("says why the account could not be made", async () => {
    const { app } = appWith({ nameStatus: async (name) => ok({ name, available: false, reason: "taken" }), createAccount: async () => fail("ACCOUNTS_UNAVAILABLE", "join down") });
    const scene = new GoogleNameScene(services(), app);
    scene.enter({});
    typeInto(scene, "alice");
    scene.update(500);
    await settle();
    assert.ok(texts(scene).some((text) => text.includes("@alice is taken")));
    scene.onKey({ type: "keydown", key: "Enter", repeat: false });
    await settle();
    assert.ok(texts(scene).some((text) => text.includes("New accounts cannot be created right now")));
  });

  it("goes home at once when the player is signed in already", () => {
    const navigated = [];
    const { app } = appWith();
    app.identity.state.status = "signed-in";
    new GoogleNameScene(services({ navigate: (id) => navigated.push(id) }), app).enter({});
    assert.deepEqual(navigated, [SceneId.HOME]);
  });
});
