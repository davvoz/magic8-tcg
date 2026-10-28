/**
 * Chat at the table on the client (docs/tcg/28-chat.md): MatchChat says
 * lines through the server and keeps what it hears, OnlineService hands
 * each line to the session of its game, and the match screen shows the
 * players' lines as bubbles by their seats, every line in the log, a count
 * of the lines not read yet, and the dialog to read and say them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SPECTATOR } from "@magic8/engine/domain/game/GameSnapshot.js";
import { ok } from "@magic8/engine/shared/Result.js";
import { P1, P2 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";
import { MatchChat } from "../../src/application/online/MatchChat.js";
import { OnlineService } from "../../src/application/online/OnlineService.js";
import { RemoteMatchSession } from "../../src/application/online/RemoteMatchSession.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { LogKind } from "../../src/rendering/board/eventLog.js";
import { MatchScene } from "../../src/rendering/scenes/MatchScene.js";
import { TextField } from "../../src/rendering/ui/TextField.js";
import { FakeContext2D, loadTheme } from "../rendering/fakes.js";

const theme = loadTheme();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const GAME = "01j8x3r6h2qkq4w0v7m5a9c1dz";
const OTHER = "01j8x3r6h2qkq4w0v7m5a9c1e0";

/** @param {Partial<{ from: string, seat: string | null, account: string, text: string, at: number, gameId: string }>} [fields] */
const line = (fields = {}) => ({ gameId: GAME, from: "player", seat: "s1", account: "bob", text: "good luck", at: 1000, ...fields });

/** A server that answers each request from `replies` (by type) and remembers what it was asked. */
function server(replies = {}) {
  const requests = [];
  const request = async (t, d) => {
    requests.push({ t, d });
    return ok(replies[t]?.(d) ?? { t: "game.chatted", d: { gameId: d.gameId } });
  };
  return { requests, request };
}

const rendered = (scene) => {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
};

function services(overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true, ...overrides };
}

describe("MatchChat", () => {
  it("says a line through the server, and tells why one did not go", async () => {
    const { requests, request } = server();
    const chat = new MatchChat({ gameId: GAME, request, account: () => "alice" });
    assert.equal((await chat.say("  hi there ")).ok, true);
    assert.deepEqual(requests, [{ t: "game.chat", d: { gameId: GAME, text: "hi there" } }]);
    assert.equal((await chat.say("   ")).error.code, "INVALID_CHAT");
    assert.equal(requests.length, 1, "nothing to say is not sent");
    assert.equal(chat.lines.length, 0, "a line shows once the server sends it back");

    const refusing = new MatchChat({ gameId: GAME, request: async () => ok({ t: "error", d: { code: "CONFLICT", message: "slow down", details: { code: "CHAT_TOO_FAST" } } }), account: () => "alice" });
    const { error } = await refusing.say("again");
    assert.deepEqual([error.code, error.message], ["CHAT_TOO_FAST", "slow down"]);
  });

  it("keeps the lines of its game, and mutes the others but never oneself", () => {
    const chat = new MatchChat({ gameId: GAME, request: server().request, account: () => "alice" });
    const heard = [];
    chat.subscribe((said) => heard.push(said.text));
    chat.hear(line());
    chat.hear(line({ gameId: OTHER, text: "elsewhere" }));
    chat.hear({ ...line(), from: "admin" });
    chat.hear(null);
    assert.deepEqual(heard, ["good luck"]);
    chat.setMuted(true);
    chat.hear(line({ text: "boo", at: 2000 }));
    chat.hear(line({ seat: "s0", account: "alice", text: "thanks", at: 3000 }));
    assert.deepEqual(chat.lines.map((said) => said.text), ["good luck", "thanks"]);
    assert.equal(chat.isOwn(chat.lines[1]), true);
  });

  it("catches up on what the server kept, adding only the lines not heard yet", () => {
    const chat = new MatchChat({ gameId: GAME, request: server().request, account: () => "carol", lines: [line({ at: 1 }), line({ from: "spectator", seat: null, account: "dave", text: "wow", at: 2 })] });
    assert.deepEqual(chat.lines.map((said) => said.text), ["good luck", "wow"]);
    chat.catchUp([line({ at: 1 }), line({ from: "spectator", seat: null, account: "dave", text: "wow", at: 2 }), line({ text: "gg", at: 3 })]);
    assert.deepEqual(chat.lines.map((said) => said.text), ["good luck", "wow", "gg"]);
  });
});

/** OnlineService against a scripted server, signed in as `account`. */
function world(account = "alice") {
  const statusListeners = new Set();
  const listeners = new Set();
  const requests = [];
  const replies = {
    hello: () => ({ t: "welcome", d: { user: { account }, serverTime: 0, activeGame: null, queue: { state: "idle" } } }),
    "watch.start": (d) => ({ t: "watch.state", d: { gameId: d.gameId, status: "ACTIVE", version: 9, snapshot: { version: 9, isOver: false, players: [] }, spectators: 1, chat: [line({ text: "hi all" })] } }),
    "game.chat": (d) => ({ t: "game.chatted", d: { gameId: d.gameId } }),
  };
  const connection = {
    connect: () => statusListeners.forEach((listener) => listener("open", { code: null })),
    close: () => undefined,
    request: async (t, d) => (requests.push({ t, d }), ok(replies[t]?.(d) ?? { t: "error", d: { code: "UNKNOWN", message: "?" } })),
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onStatus: (listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
  };
  const online = new OnlineService({ connection, randomHex: (bytes) => "cd".repeat(bytes), newCommandId: () => "00000000-0000-4000-8000-000000000001", accountDecks: () => [], liveGames: { live: async () => ok([]) }, logger: new MemoryLogger() });
  online.start();
  return { online, requests, push: (t, d) => listeners.forEach((listener) => listener({ t, d })), reconnect: () => statusListeners.forEach((listener) => listener("open", { code: null })) };
}

describe("OnlineService: chat", () => {
  it("gives the player's session the lines of their game, and keeps them when the board is opened again", async () => {
    const { online, push } = world();
    await flush();
    push("match.found", { gameId: GAME, seat: "s0", mode: "casual", opponent: { account: "bob" }, protocol: 1 });
    const session = online.state.session;
    push("game.chat", line());
    push("game.chat", line({ gameId: OTHER, text: "not ours" }));
    assert.deepEqual(session.chat.lines.map((said) => said.text), ["good luck"]);
    assert.equal(session.chat.isOwn(line({ account: "alice" })), true);
    session.stop();
    assert.equal(online.resume().chat, session.chat);
  });

  it("gives a spectator what was said before, then what the players and the stands say", async () => {
    const { online, push, reconnect, requests } = world("carol");
    await flush();
    const session = (await online.watch(GAME)).value;
    assert.deepEqual(session.chat.lines.map((said) => said.text), ["hi all"]);
    push("watch.chat", line({ from: "spectator", seat: null, account: "dave", text: "wow", at: 2000 }));
    push("game.chat", line({ text: "for players only", at: 2500 }));
    assert.deepEqual(session.chat.lines.map((said) => said.text), ["hi all", "wow"]);
    reconnect();
    await flush();
    assert.equal(requests.filter((request) => request.t === "watch.start").length, 2);
    assert.deepEqual(session.chat.lines.map((said) => said.text), ["hi all", "wow"], "what was heard already is not added again");
    await session.chat.say("nice");
    assert.deepEqual(requests.at(-1), { t: "game.chat", d: { gameId: GAME, text: "nice" } });
  });
});

/**
 * A board seen by the player in the first seat, or by a spectator, with the game's chat.
 * @param {{ seat?: string | null, replies?: Record<string, (d: any) => any>, scene?: object }} [options]
 */
function board({ seat = P1, replies = {}, scene: sceneOptions = {} } = {}) {
  const { engine } = createScenario({ p1: { hand: ["lava_brute"], resources: 5 }, p2: { hand: ["ember_bolt"] } });
  const snapshot = engine.getSnapshot(seat ?? SPECTATOR);
  const { requests, request } = server(replies);
  const viewer = seat === null ? "carol" : snapshot.players.find((player) => player.id === seat).name;
  const chat = new MatchChat({ gameId: GAME, request, account: () => viewer });
  const session = new RemoteMatchSession({ gameId: GAME, seat, request, newCommandId: () => "x", chat });
  session.apply({ version: snapshot.version, snapshot });
  const scene = new MatchScene(services(), sceneOptions);
  scene.enter({ session });
  const names = Object.fromEntries(snapshot.players.map((player) => [player.id, player.name]));
  return { scene, chat, requests, names, hear: (fields) => chat.hear(line({ seat: P2, account: names[P2], ...fields })) };
}

describe("MatchScene: chat", () => {
  it("shows what the opponent says by their seat and in the log, with a count until the chat is opened", () => {
    const { scene, hear, names } = board();
    const button = scene.root.findById("chat.open");
    assert.ok(button !== null, "an online game between two people has a chat");
    assert.equal(button.badge, null);
    hear({ text: "good luck" });
    const texts = rendered(scene);
    assert.ok(texts.includes(`@${names[P2]}`), texts.join("|"));
    assert.ok(texts.some((text) => text.includes("good luck")));
    assert.equal(scene.root.findById("chat.open").badge, "1");
    const log = scene.root.findById("log.entries");
    assert.deepEqual(log.entries.at(-1), { text: `@${names[P2]}: good luck`, kind: LogKind.CHAT });
    for (let more = 0; more < 10; more += 1) {
      hear({ text: `line ${more}`, at: 2000 + more });
    }
    assert.equal(scene.root.findById("chat.open").badge, "9+");

    scene.root.findById("chat.open").activate();
    assert.equal(scene.modal?.id, "chat");
    assert.equal(scene.modal.findById("chat.lines").entries.length, 11);
    scene.modal?.findById("chat.close").activate();
    assert.equal(scene.modal, null);
    assert.equal(scene.root.findById("chat.open").badge, null, "read once opened");
  });

  it("says what is typed, closes on success, and keeps the dialog and the line through the opponent's moves", async () => {
    const { scene, requests, chat, names } = board();
    scene.onKey({ type: "keydown", key: "c" });
    assert.equal(scene.modal?.id, "chat");
    const field = scene.modal.findById("chat.input");
    assert.ok(field instanceof TextField);
    assert.equal(scene.focusedNode, field, "typed straight away with a keyboard");
    for (const key of "gl, hf!") {
      scene.onKey({ type: "keydown", key });
    }
    assert.equal(field.value, "gl, hf!");
    chat.hear(line({ seat: P2, account: names[P2], text: "ty" }));
    assert.equal(scene.modal?.id, "chat", "the dialog stays open while lines come in");
    assert.equal(scene.modal.findById("chat.input").value, "gl, hf!", "and keeps what was typed");
    scene.onKey({ type: "keydown", key: "Enter" });
    await flush();
    assert.deepEqual(requests.at(-1), { t: "game.chat", d: { gameId: GAME, text: "gl, hf!" } });
    assert.equal(scene.modal, null, "the line went: back to the board, where it shows");
    chat.hear(line({ seat: P1, account: names[P1], text: "gl, hf!", at: 5000 }));
    assert.ok(rendered(scene).some((text) => text.includes("gl, hf!")), "by the viewer's own seat");
    assert.equal(scene.root.findById("chat.open").badge, null, "one's own line is not news");
  });

  it("says why a line did not go, and sends a quick line with one tap", async () => {
    const replies = { "game.chat": () => ({ t: "error", d: { code: "CONFLICT", message: "slow down", details: { code: "CHAT_TOO_FAST" } } }) };
    const { scene, requests } = board({ replies });
    scene.root.findById("chat.open").activate();
    scene.modal.findById("chat.quick.1").activate();
    await flush();
    assert.deepEqual(requests.at(-1).d.text, "Good luck!");
    assert.equal(scene.modal?.id, "chat");
    assert.equal(scene.modal.findById("chat.notice").text, "Slow down a moment, then try again.");
  });

  it("mutes the others from the dialog", () => {
    const { scene, chat, hear } = board();
    scene.root.findById("chat.open").activate();
    scene.modal.findById("chat.mute").activate();
    assert.equal(chat.muted, true);
    assert.equal(scene.modal.findById("chat.mute").text, "Unmute");
    hear({ text: "boo" });
    assert.equal(chat.lines.length, 0);
  });

  it("lets a spectator read both players and the stands, the stands' lines dimmer and never by a seat", () => {
    const { scene, chat, names } = board({ seat: null });
    assert.ok(scene.root.findById("chat.open") !== null, "the button takes the help's place");
    chat.hear(line({ from: "spectator", seat: null, account: "dave", text: "what a game" }));
    chat.hear(line({ seat: P1, account: names[P1], text: "thanks", at: 2000 }));
    const log = scene.root.findById("log.entries");
    assert.deepEqual(log.entries.slice(-2).map((entry) => entry.kind), [LogKind.COMMENT, LogKind.CHAT]);
    const texts = rendered(scene);
    assert.ok(texts.some((text) => text.includes("thanks")));
    assert.ok(!texts.some((text) => text.includes("what a game") && text.startsWith("“")), "no bubble for the stands");
    scene.root.findById("chat.open").activate();
    assert.equal(scene.modal.findById("chat.quick.1").text, "Wow!");
  });

  it("has no chat for the player against a challenge's character, but those watching still comment", () => {
    const character = { characterName: (account) => (account.length > 0 ? "Kael" : null) };
    const { scene } = board({ scene: character });
    assert.equal(scene.root.findById("chat.open"), null);
    scene.onKey({ type: "keydown", key: "c" });
    assert.equal(scene.modal, null);
    const watched = board({ seat: null, scene: character });
    assert.ok(watched.scene.root.findById("chat.open") !== null);
    watched.scene.onKey({ type: "keydown", key: "c" });
    assert.equal(watched.scene.modal?.id, "chat");
  });
});
