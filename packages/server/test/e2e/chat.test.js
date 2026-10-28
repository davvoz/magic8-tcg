/**
 * Chat at the table end to end (docs/tcg/28-chat.md): two real clients in
 * a game on a real server, and a third watching it. Whatever a player or
 * the spectator says reaches everyone at the table; the line the server
 * refuses says why.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { onlineWorld, settle, until } from "./onlineHarness.js";

describe("chat at the table (two real clients and a spectator, real server)", () => {
  /** @type {Awaited<ReturnType<typeof onlineWorld>>[]} */
  const worlds = [];
  after(async () => {
    for (const world of worlds) {
      await world.close();
    }
  });

  it("brings every line to the players and to the stands", async () => {
    const w = await onlineWorld();
    worlds.push(w);
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    const carol = await w.player("carol");
    await alice.online.queue(alice.deckId);
    await bob.online.queue(bob.deckId);
    await until(() => alice.keychain.open.length === 1 && bob.keychain.open.length === 1, "each is asked to sign");
    alice.keychain.approve();
    bob.keychain.approve();
    await until(() => alice.online.state.status === "playing" && bob.online.state.status === "playing", "the game starts");
    const aliceChat = /** @type {any} */ (alice.online.state.session).chat;
    const bobChat = /** @type {any} */ (bob.online.state.session).chat;
    const gameId = aliceChat.gameId;

    assert.equal((await aliceChat.say("good luck, have fun 🙂")).ok, true);
    await until(() => bobChat.lines.length === 1, "bob reads alice");
    assert.deepEqual([bobChat.lines[0].account, bobChat.lines[0].seat, bobChat.lines[0].text], ["alice", alice.online.state.session?.seat, "good luck, have fun 🙂"]);
    await until(() => aliceChat.lines.length === 1, "alice sees her own line as the server kept it");

    const watched = await carol.online.watch(gameId);
    assert.equal(watched.ok, true);
    const carolChat = /** @type {any} */ (watched.value).chat;
    assert.deepEqual(carolChat.lines.map((line) => line.text), ["good luck, have fun 🙂"], "what was said before she came");

    assert.equal((await bobChat.say("thanks!")).ok, true);
    await until(() => carolChat.lines.length === 2, "the stands read the players");
    assert.equal((await carolChat.say("what a match")).ok, true);
    await until(() => carolChat.lines.length === 3, "the spectator reads herself");
    assert.deepEqual(carolChat.lines.at(-1).from, "spectator");
    await until(() => aliceChat.lines.length === 3 && bobChat.lines.length === 3, "the players read the stands");
    assert.deepEqual(aliceChat.lines.map((line) => line.text), ["good luck, have fun 🙂", "thanks!", "what a match"]);
    await settle();

    for (let line = 0; line < 3; line += 1) {
      await aliceChat.say(`spam ${line}`);
    }
    const refused = await aliceChat.say("one too many");
    assert.equal(refused.error.code, "CHAT_TOO_FAST");
  });
});
