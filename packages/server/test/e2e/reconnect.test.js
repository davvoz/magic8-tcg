/**
 * A page closed by mistake mid-game and opened again, end to end: two real
 * clients in a game on a real server; the player's new page goes from the
 * main menu straight back into the game, before its clock runs out.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { returnToGame } from "../../../client/src/rendering/scenes/returnToGame.js";
import { SceneId } from "../../../client/src/rendering/scenes/sceneIds.js";
import { onlineWorld, until } from "./onlineHarness.js";

describe("a page closed mid-game (two real clients, real server)", () => {
  /** @type {Awaited<ReturnType<typeof onlineWorld>>[]} */
  const worlds = [];
  after(async () => {
    for (const world of worlds) {
      await world.close();
    }
  });

  it("a page closed by mistake and opened again takes the player from the menu straight back into the game", async () => {
    const w = await onlineWorld();
    worlds.push(w);
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    await alice.online.queue(alice.deckId);
    await bob.online.queue(bob.deckId);
    await until(() => alice.keychain.open.length === 1 && bob.keychain.open.length === 1, "each is asked to sign");
    alice.keychain.approve();
    bob.keychain.approve();
    await until(() => alice.online.state.status === "playing" && bob.online.state.status === "playing", "the game starts");
    const mover = [alice, bob].find((player) => {
      const session = /** @type {any} */ (player.online.state.session);
      return session.snapshotFor(session.seat).awaitingPlayerId === session.seat;
    });
    assert.ok(mover !== undefined, "someone is to move");
    const gameId = /** @type {any} */ (mover.online.state.session).gameId;

    // The app is closed and opened again: a new page, its screens and its toasts, on the main menu.
    const reopened = await mover.reload();
    const screens = { currentId: /** @type {string | null} */ (null), current: /** @type {any} */ (null), visits: /** @type {string[]} */ ([]) };
    const toasts = /** @type {any[]} */ ([]);
    /** @type {Set<(sceneId: string) => void>} */
    const navigations = new Set();
    const scenes = {
      get currentId() {
        return screens.currentId;
      },
      get current() {
        return screens.current;
      },
      navigate: (/** @type {string} */ sceneId, /** @type {any} */ params = {}) => {
        screens.visits.push(sceneId);
        screens.currentId = sceneId;
        screens.current = { session: params.session ?? null };
        navigations.forEach((listener) => listener(sceneId));
        return true;
      },
      onNavigate: (/** @type {(sceneId: string) => void} */ listener) => (navigations.add(listener), () => navigations.delete(listener)),
    };
    returnToGame({ online: reopened.online, scenes, toasts: { show: (message) => toasts.push(message), dismiss: () => undefined } });
    scenes.navigate(SceneId.HOME);

    await until(() => screens.currentId === SceneId.MATCH, "back in the match without a click");
    assert.deepEqual(screens.visits, [SceneId.HOME, SceneId.MATCH]);
    assert.deepEqual(toasts, [], "no reminder needed: the player is in it");
    const session = screens.current.session;
    assert.equal(session.gameId, gameId, "the same game");
    await until(() => reopened.keychain.open.length === 1, "the new page asks Keychain once for its key");
    reopened.keychain.approve();
    const snapshot = session.snapshotFor(session.seat);
    assert.equal(snapshot.awaitingPlayerId, session.seat, "still its decision");
    const result = await session.submit({ type: snapshot.legalMoves.canEndTurn ? "END_TURN" : "END_PHASE" });
    assert.equal(result.ok, true, JSON.stringify(result));
  });
});
