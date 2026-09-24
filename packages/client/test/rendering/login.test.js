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
    createSeed: () => 1,
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
