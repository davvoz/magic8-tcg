/**
 * The active key a payment needs, asked for over the screen the player pays
 * on (docs/tcg/20-chiavi.md): the prompt between the wallet and the screen,
 * the wallet switch, and the dialog in its overlay above the scene's own
 * tree and modals.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { IdentityStatus, SignInMethod } from "../../src/application/identity/IdentityService.js";
import { ActiveKeyPrompt, ActiveKeyStatus } from "../../src/application/wallet/ActiveKeyPrompt.js";
import { WalletSwitch } from "../../src/application/wallet/WalletSwitch.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { ActiveKeyDialog } from "../../src/rendering/scenes/ActiveKeyDialog.js";
import { Scene } from "../../src/rendering/scenes/Scene.js";
import { Button } from "../../src/rendering/ui/Button.js";
import { buildConfirmModal } from "../../src/rendering/ui/ConfirmModal.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function services() {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true };
}

/** A screen that rebuilds itself whenever it likes, as the shop does. */
class PayingScene extends Scene {
  rebuild() {
    this.root.clear();
    this.focus(this.root.add(new Button({ id: "pay", x: 10, y: 10, width: 200, height: 60, text: "Pay", onActivate: () => undefined })));
  }
}

/**
 * A control of the dialog in the scene's overlay.
 * @param {Scene} scene
 * @param {string} id
 * @returns {any}
 */
function control(scene, id) {
  return scene.overlay === null ? null : scene.overlay.findById(id);
}

describe("ActiveKeyPrompt", () => {
  it("asks, hears one answer, and goes back to idle once the asker closes it", async () => {
    const prompt = new ActiveKeyPrompt();
    const states = [];
    prompt.subscribe((state) => states.push(state.status));
    const answer = prompt.ask({ account: "alice", saved: false });
    assert.deepEqual(prompt.state, { status: ActiveKeyStatus.ASKING, account: "alice", saved: false, error: null });
    prompt.submitKey(" 5Kactive ", "");
    assert.deepEqual(await answer, { kind: "key", wif: "5Kactive", pin: null });
    assert.equal(prompt.state.status, ActiveKeyStatus.CHECKING);
    prompt.submitPin("ignored: nobody is asking");
    prompt.close();
    assert.deepEqual(states, [ActiveKeyStatus.ASKING, ActiveKeyStatus.CHECKING, ActiveKeyStatus.IDLE]);
  });

  it("cancels: the asker hears null; a new request cancels an open one", async () => {
    const prompt = new ActiveKeyPrompt();
    const first = prompt.ask({ account: "alice", saved: true });
    const second = prompt.ask({ account: "alice", saved: true, error: { code: "KEY_WRONG_PIN", message: "wrong PIN" } });
    assert.equal(await first, null);
    assert.equal(prompt.state.error?.code, "KEY_WRONG_PIN");
    prompt.cancel();
    assert.equal(await second, null);
    assert.equal(prompt.state.status, ActiveKeyStatus.IDLE);
  });
});

describe("WalletSwitch", () => {
  it("signs with whichever wallet the player signed in with", async () => {
    const identity = { state: { status: IdentityStatus.SIGNED_IN, user: null, method: SignInMethod.KEYCHAIN, error: null } };
    const named = (name) => ({ name, isAvailable: () => true, signMessage: async () => ok(name), requestTransfer: async () => ok(name) });
    const wallet = new WalletSwitch({ identity, keychain: named("Steem Keychain"), keys: named("your keys") });
    assert.equal((await wallet.requestTransfer({ from: "a", to: "b", amount: "1.000", asset: "STEEM", memo: "" })).value, "Steem Keychain");
    identity.state = { ...identity.state, method: SignInMethod.KEYS };
    assert.equal(wallet.usesKeys, true);
    assert.equal(wallet.name, "your keys");
    assert.equal((await wallet.signMessage({ account: "a", message: "m", keyRole: "Posting" })).value, "your keys");
  });

  it("never pays with the other wallet: a Keychain player whose Keychain is missing is told so, not asked for a key", async () => {
    const identity = { state: { status: IdentityStatus.SIGNED_IN, user: null, method: SignInMethod.KEYCHAIN, error: null } };
    const asked = [];
    const keys = { name: "your keys", isAvailable: () => false, signMessage: async () => ok("keys"), requestTransfer: async () => (asked.push("keys"), ok("paid with the active key")) };
    const keychain = { name: "Steem Keychain", isAvailable: () => false, signMessage: async () => ok("keychain"), requestTransfer: async () => fail("WALLET_NOT_INSTALLED", "Steem Keychain was not found in this browser") };
    const wallet = new WalletSwitch({ identity, keychain, keys });
    assert.equal((await wallet.requestTransfer({ from: "a", to: "b", amount: "1.000", asset: "STEEM", memo: "" })).error.code, "WALLET_NOT_INSTALLED");
    assert.deepEqual(asked, []);
  });
});

describe("ActiveKeyDialog", () => {
  it("shows over the scene and its modal, survives the scene rebuilding, and answers with the key and PIN typed", async () => {
    const prompt = new ActiveKeyPrompt();
    const scene = new PayingScene(services());
    scene.rebuild();
    scene.openModal(buildConfirmModal({ viewport: scene.services.viewport, title: "Your cart", message: "", confirmText: "Pay", onConfirm: () => undefined, onCancel: () => scene.closeModal() }));
    const dialog = new ActiveKeyDialog(scene, prompt);
    dialog.start();
    const answer = prompt.ask({ account: "alice", saved: false });
    assert.equal(scene.focusedNode?.id, "activeKey.key", "above the scene's own modal");
    assert.equal(scene.modal?.id, "confirm");
    scene.rebuild();
    assert.ok(scene.overlay !== null, "the scene's rebuild does not reach it");
    assert.equal(scene.focusedNode?.id, "activeKey.key", "nor take the focus away from it");
    scene.onPaste("5KactiveKey");
    scene.onKey({ type: "keydown", key: "Enter", repeat: false });
    assert.equal(scene.focusedNode?.id, "activeKey.pin");
    for (const key of "123456") {
      scene.onKey({ type: "keydown", key, repeat: false });
    }
    const context = new FakeContext2D();
    scene.render(context);
    assert.ok(context.texts.includes("Active key needed"));
    assert.ok(!context.texts.some((text) => text.includes("5KactiveKey") || text.includes("123456")), "neither the key nor the PIN is drawn");
    control(scene, "activeKey.confirm").activate();
    assert.deepEqual(await answer, { kind: "key", wif: "5KactiveKey", pin: "123456" });
    assert.equal(control(scene, "activeKey.confirm").enabled, false, "nothing to press while the key is checked");

    void prompt.ask({ account: "alice", saved: false, error: { code: "KEY_NOT_AUTHORIZED", message: "this is your posting key: sending STEEM needs the active key" } });
    scene.render((context.texts.length = 0, context));
    assert.ok(context.texts.includes("This is your posting key: sending STEEM needs the active key."));
    assert.equal(control(scene, "activeKey.key").value, "5KactiveKey", "the key stays to be corrected");
    assert.equal(control(scene, "activeKey.pin").value, "", "the PIN does not");
    prompt.close();
    assert.equal(scene.overlay, null);
    dialog.stop();
  });

  it("unlocks a saved key with its PIN, or forgets it; Escape and leaving the screen cancel", async () => {
    const prompt = new ActiveKeyPrompt();
    const scene = new PayingScene(services());
    scene.rebuild();
    const dialog = new ActiveKeyDialog(scene, prompt);
    dialog.start();
    const unlocking = prompt.ask({ account: "alice", saved: true });
    assert.equal(control(scene, "activeKey.key"), null);
    for (const key of "secret") {
      scene.onKey({ type: "keydown", key, repeat: false });
    }
    scene.onKey({ type: "keydown", key: "Enter", repeat: false });
    assert.deepEqual(await unlocking, { kind: "pin", pin: "secret" });

    const forgetting = prompt.ask({ account: "alice", saved: true });
    control(scene, "activeKey.forget").activate();
    assert.deepEqual(await forgetting, { kind: "forget" });

    const escaped = prompt.ask({ account: "alice", saved: false });
    scene.onKey({ type: "keydown", key: "Escape", repeat: false });
    assert.equal(await escaped, null);
    assert.equal(scene.overlay, null);
    assert.equal(scene.focusedNode?.id, "pay", "the focus goes back to the screen");

    const left = prompt.ask({ account: "alice", saved: false });
    dialog.stop();
    assert.equal(await left, null);
    await settle();
  });
});
