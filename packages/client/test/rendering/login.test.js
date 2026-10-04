import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { IdentityService, IdentityStatus } from "../../src/application/identity/IdentityService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { LoginScene } from "../../src/rendering/scenes/LoginScene.js";
import { MainMenuScene } from "../../src/rendering/scenes/MainMenuScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const USER = Object.freeze({ id: "u1", network: "steem", account: "alice" });

function services(overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true, ...overrides };
}

/**
 * @param {{ currentUser?: () => Promise<any>, createSession?: () => Promise<any>, walletAvailable?: boolean, sign?: () => Promise<any> }} [options]
 */
function identity({ currentUser = async () => ok(null), createSession = async () => ok(USER), walletAvailable = true, sign = async () => ok(`20${"ab".repeat(64)}`) } = {}) {
  const deleted = [];
  const service = new IdentityService({
    api: {
      currentUser,
      createChallenge: async () => ok({ challengeId: "c1", message: "m", keyRole: "Posting", expiresAt: 1 }),
      createSession,
      deleteSession: async () => (deleted.push(true), ok(null)),
    },
    wallet: { name: "Steem Keychain", isAvailable: () => walletAvailable, signMessage: sign },
  });
  return { service, deleted };
}

function appWith(identityService) {
  return {
    content,
    deckSelection: { listDecks: () => [] },
    deckBuilding: {},
    matchSetup: {},
    createSeed: () => "9f".repeat(32),
    logger: new MemoryLogger(),
    environment: { version: "test", storage: "local" },
    identity: identityService,
  };
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

describe("LoginScene", () => {
  it("signs in with the typed account and returns to the menu", async () => {
    const navigated = [];
    const { service } = identity();
    const scene = new LoginScene(services({ navigate: (id) => navigated.push(id) }), appWith(service));
    scene.enter({});
    assert.equal(scene.focusedNode?.id, "login.account");
    typeInto(scene, "alice");
    scene.onKey({ type: "keydown", key: "Enter", repeat: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(service.state.status, IdentityStatus.SIGNED_IN);
    assert.deepEqual(navigated, [SceneId.MAIN_MENU]);
    scene.exit();
  });

  it("explains a missing extension and a refused signature", async () => {
    const missing = new LoginScene(services(), appWith(identity({ walletAvailable: false }).service));
    missing.enter({});
    assert.ok(texts(missing).some((text) => text.includes("Steem Keychain was not found")));

    const { service } = identity({ createSession: async () => fail("LOGIN_FAILED", "server text") });
    const scene = new LoginScene(services(), appWith(service));
    scene.enter({});
    typeInto(scene, "alice");
    scene.onKey({ type: "keydown", key: "Enter", repeat: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(texts(scene).some((text) => text.includes("does not match the account's posting key")));
    scene.exit();
  });

  it("goes back to the menu on Escape", () => {
    const navigated = [];
    const scene = new LoginScene(services({ navigate: (id) => navigated.push(id) }), appWith(identity().service));
    scene.enter({});
    scene.onCancel();
    assert.deepEqual(navigated, [SceneId.MAIN_MENU]);
  });
});

describe("LoginScene with a posting key", () => {
  /** An identity that can sign in with keys; `accepts` decides whether the key is good. */
  function keyIdentity({ walletAvailable = false, accepts = async () => ok(undefined) } = {}) {
    const typed = [];
    const keys = {
      account: null,
      restore: async () => null,
      usePostingKey: async (account, wif) => (typed.push({ account, wif }), accepts()),
      save: async () => ok(undefined),
      forget: () => undefined,
      signMessage: async () => ok(`20${"ab".repeat(64)}`),
    };
    const service = new IdentityService({
      api: { currentUser: async () => ok(null), createChallenge: async () => ok({ challengeId: "c1", message: "m", keyRole: "Posting", expiresAt: 1 }), createSession: async () => ok(USER), deleteSession: async () => ok(null) },
      wallet: { name: "Steem Keychain", isAvailable: () => walletAvailable, signMessage: async () => fail("X", "x") },
      keys,
    });
    return { service, typed };
  }

  it("signs in with a pasted posting key, never drawn in clear", async () => {
    const navigated = [];
    const { service, typed } = keyIdentity();
    const scene = new LoginScene(services({ navigate: (id) => navigated.push(id) }), appWith(service));
    scene.enter({});
    assert.ok(scene.root.findById("login.key"), "without Keychain, the posting key form comes first");
    typeInto(scene, "alice");
    scene.onKey({ type: "keydown", key: "Enter", repeat: false });
    assert.equal(scene.focusedNode?.id, "login.key", "Enter moves on to the key");
    scene.onPaste("  5KsecretPostingKey \n");
    assert.equal(scene.root.findById("login.key").value, "5KsecretPostingKey");
    assert.ok(!texts(scene).some((text) => text.includes("5KsecretPostingKey")), "the key is drawn as dots");
    scene.onKey({ type: "keydown", key: "Enter", repeat: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(typed, [{ account: "alice", wif: "5KsecretPostingKey" }]);
    assert.equal(service.state.status, IdentityStatus.SIGNED_IN);
    assert.deepEqual(navigated, [SceneId.MAIN_MENU]);
    scene.exit();
  });

  it("explains why a key was refused", async () => {
    const { service } = keyIdentity({ accepts: async () => fail("KEY_TOO_POWERFUL", "this key can move your funds (an active or owner key): sign in with your posting key") });
    const scene = new LoginScene(services(), appWith(service));
    scene.enter({});
    typeInto(scene, "alice");
    scene.onPaste("5Kactive");
    scene.root.findById("login.submit").activate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(texts(scene).some((text) => text.startsWith("This key can move your funds")));
    scene.exit();
  });

  it("asks for the posting key again, not Keychain, when the session closed because the key was no longer saved here", async () => {
    let remembered = { account: "alice", method: "keys" };
    const service = new IdentityService({
      api: { currentUser: async () => ok(USER), createChallenge: async () => ok({ challengeId: "c1", message: "m", keyRole: "Posting", expiresAt: 1 }), createSession: async () => ok(USER), deleteSession: async () => ok(null) },
      wallet: { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => fail("X", "x") },
      keys: { account: null, restore: async () => null, usePostingKey: async () => ok(undefined), save: async () => ok(undefined), forget: () => undefined, signMessage: async () => ok(`20${"ab".repeat(64)}`) },
      record: { read: () => remembered, write: (entry) => (remembered = entry), clear: () => (remembered = null) },
    });
    await service.restore();
    const scene = new LoginScene(services(), appWith(service));
    scene.enter({});
    assert.ok(scene.root.findById("login.key"), "the posting key form, though Keychain is installed");
    assert.ok(texts(scene).some((text) => /posting key is no longer saved in this browser/i.test(text)), "and why");
    scene.exit();
  });

  it("offers Keychain first when it is installed, and switches to the key form, keeping the account", () => {
    const scene = new LoginScene(services(), appWith(keyIdentity({ walletAvailable: true }).service));
    scene.enter({});
    assert.equal(scene.root.findById("login.key"), null);
    typeInto(scene, "alice");
    scene.root.findById("login.mode.keys").activate();
    assert.equal(scene.root.findById("login.account").value, "alice");
    assert.equal(scene.focusedNode?.id, "login.key");
    scene.root.findById("login.mode.keychain").activate();
    assert.equal(scene.root.findById("login.key"), null);
    scene.exit();
  });
});

describe("MainMenuScene account entries", () => {
  it("offers sign-in when a server is reachable and nobody is signed in", async () => {
    const { service } = identity();
    await service.restore();
    const navigated = [];
    const scene = new MainMenuScene(services({ navigate: (id) => navigated.push(id) }), appWith(service));
    scene.enter({});
    const signIn = scene.root.focusableNodes().find((node) => node.id === "signIn");
    assert.ok(texts(scene).includes("Not signed in"));
    signIn.activate();
    assert.deepEqual(navigated, [SceneId.LOGIN]);
  });

  it("shows the signed-in account and signs out", async () => {
    const { service, deleted } = identity({ currentUser: async () => ok(USER) });
    await service.restore();
    const scene = new MainMenuScene(services(), appWith(service));
    scene.enter({});
    assert.ok(texts(scene).includes("Signed in as @alice (steem)"));
    scene.root.focusableNodes().find((node) => node.id === "signOut").activate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(deleted.length, 1);
    assert.equal(service.state.status, IdentityStatus.SIGNED_OUT);
  });

  it("stays usable offline, without account entries", async () => {
    const { service } = identity({ currentUser: async () => fail("NETWORK", "down") });
    await service.restore();
    const scene = new MainMenuScene(services(), appWith(service));
    scene.enter({});
    assert.ok(texts(scene).some((text) => text.startsWith("Offline")));
    assert.equal(scene.root.focusableNodes().some((node) => node.id === "signIn" || node.id === "signOut"), false);
  });
});
