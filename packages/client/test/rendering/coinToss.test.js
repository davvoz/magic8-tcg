/**
 * The opening coin toss on screen: the Timeline it runs on, the CoinFlip
 * animation state, the CoinTossNode that paints it (with the painted coin
 * from CoinArt and its ImageCache, or drawn when that is not ready), and the match screen
 * that plays it before a practice match begins (and before an online one
 * can be played), then the deck selection that asks for it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { GameEventType } from "@magic8/engine/domain/game/GameEventType.js";
import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { CoinFace, CoinToss } from "../../src/application/match/CoinToss.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSession } from "../../src/application/match/MatchSession.js";
import { MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { DeckBuildingService } from "../../src/application/decks/DeckBuildingService.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { RemoteMatchSession } from "../../src/application/online/RemoteMatchSession.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredDeckRepository } from "../../src/infrastructure/persistence/StoredDeckRepository.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { Timeline } from "../../src/rendering/animation/Timeline.js";
import { Easing } from "../../src/rendering/animation/Tween.js";
import { CardNode } from "../../src/rendering/board/CardNode.js";
import { CoinArt } from "../../src/rendering/board/CoinArt.js";
import { CoinFlip } from "../../src/rendering/board/CoinFlip.js";
import { CoinTossNode } from "../../src/rendering/board/CoinTossNode.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { ImageCache } from "../../src/rendering/images/ImageCache.js";
import { DeckSelectionScene } from "../../src/rendering/scenes/DeckSelectionScene.js";
import { MatchScene } from "../../src/rendering/scenes/MatchScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { effects, loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const [ember, iron] = content.preconDecks;
const { animation } = theme;
/** Long enough for any toss to play out whole. */
const WHOLE_TOSS_MS = 20 * animation.longMs;

function services(overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true, ...overrides };
}

const rendered = (scene) => {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
};
const paintedTexts = (node) => {
  const context = new FakeContext2D();
  node.draw(context, theme);
  return context.texts;
};
/** Every node of a tree, depth first. */
const nodesOf = (root) => [root, ...root.children.flatMap((child) => nodesOf(child))];
const buttonWithId = (scene, id) => nodesOf(scene.root).find((node) => node.id === id);
/** Steps `thing.update` in frames until `reached()`; fails past `limitMs`. */
const runUntil = (thing, reached, label, { step = 40, limitMs = WHOLE_TOSS_MS } = {}) => {
  for (let elapsed = 0; elapsed <= limitMs; elapsed += step) {
    if (reached()) {
      return elapsed;
    }
    thing.update(step);
  }
  return assert.fail(`never reached: ${label}`);
};

/** A toss between the human ("player") and the AI ("ai"), won by `winner`, with heads for `headsFor`. */
const tossWonBy = (winner, headsFor = "player") =>
  new CoinToss({ calls: { player: headsFor === "player" ? CoinFace.HEADS : CoinFace.TAILS, ai: headsFor === "ai" ? CoinFace.HEADS : CoinFace.TAILS }, landed: winner === headsFor ? CoinFace.HEADS : CoinFace.TAILS });

/** A practice match (human vs AI) whose coin seed makes `winner` go first. */
function practiceSession(winner) {
  const service = new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger: new MemoryLogger() });
  for (let coinSeed = 1; coinSeed < 100; coinSeed += 1) {
    const created = service.createMatch({
      seats: [
        { id: "player", name: "You", deckList: ember, controller: humanController },
        { id: "ai", name: "Opponent", deckList: iron, controller: new BasicAiController() },
      ],
      seed: 42,
      coinSeed,
    });
    if (created.ok && created.value.openingToss?.firstPlayerId === winner) {
      return created.value;
    }
  }
  return assert.fail(`no coin seed lets ${winner} go first`);
}

describe("Timeline", () => {
  it("plays its stages in order, each from where the last one left off, holds included", () => {
    const timeline = new Timeline({
      from: { x: 0 },
      stages: [
        { to: { x: 100 }, durationMs: 100, easing: Easing.linear },
        { to: { x: 100 }, durationMs: 50, easing: Easing.linear },
        { to: { x: 0 }, durationMs: 100, easing: Easing.linear },
      ],
    });
    assert.equal(timeline.update(50), true);
    assert.equal(timeline.frame.x, 50);
    assert.equal(timeline.update(50), true);
    assert.equal(timeline.frame.x, 100);
    assert.equal(timeline.update(25), false, "a hold changes nothing: no redraw");
    assert.equal(timeline.update(25), false);
    timeline.update(50);
    assert.equal(timeline.frame.x, 50, "the last stage starts from the held value");
    timeline.update(1000);
    assert.equal(timeline.frame.x, 0);
    assert.equal(timeline.isDone, true);
    assert.equal(timeline.update(16), false, "done: nothing more to draw");
  });

  it("with no stages it is done at once, at its starting point", () => {
    const timeline = new Timeline({ from: { x: 3 }, stages: [] });
    assert.equal(timeline.isDone, true);
    assert.deepEqual(timeline.frame, { x: 3 });
  });
});

describe("CoinFlip", () => {
  for (const landed of [CoinFace.HEADS, CoinFace.TAILS]) {
    it(`spins through the air and settles showing ${landed}`, () => {
      const winner = landed === CoinFace.HEADS ? "player" : "ai";
      const flip = new CoinFlip({ toss: tossWonBy(winner), animation });
      assert.equal(flip.faceShown, CoinFace.HEADS, "heads up in the hand");
      assert.equal(flip.lift, 0);
      const faces = new Set();
      let highest = 0;
      let edgeOn = false;
      runUntil(
        {
          update: (dt) => {
            flip.update(dt);
            faces.add(flip.faceShown);
            highest = Math.max(highest, flip.lift);
            edgeOn ||= flip.squeeze < 0.2;
          },
        },
        () => flip.hasLanded,
        "the coin lands",
        { step: 10 },
      );
      assert.equal(flip.faceShown, landed);
      assert.equal(flip.lift, 0, "back on the table");
      assert.ok(Math.abs(flip.squeeze - 1) < 1e-9, "lying flat");
      assert.deepEqual([...faces].sort(), [CoinFace.HEADS, CoinFace.TAILS], "both faces flash by in the air");
      assert.ok(highest > 0.95, "it goes up to the top of its arc");
      assert.ok(edgeOn, "it turns edge-on as it spins");
    });
  }

  it("brings the faces in, holds them to be read, then the verdict, then fades out and is done", () => {
    const flip = new CoinFlip({ toss: tossWonBy("player"), animation });
    assert.deepEqual(flip.frame, { veil: 0, calls: 0, flight: 0, shine: 0, verdict: 0 });
    flip.update(animation.longMs);
    assert.equal(flip.frame.calls, 1, "the players' faces are in");
    assert.equal(flip.frame.flight, 0, "and read before the coin goes up");
    runUntil(flip, () => flip.frame.verdict === 1, "the verdict is in");
    assert.equal(flip.frame.shine, 1, "the landing flashed first");
    assert.equal(flip.isDone, false, "held to be read");
    runUntil(flip, () => flip.isDone, "the toss is over");
    assert.deepEqual({ veil: flip.frame.veil, calls: flip.frame.calls, verdict: flip.frame.verdict }, { veil: 0, calls: 0, verdict: 0 }, "faded back to the board");
  });
});

describe("CoinTossNode", () => {
  /** @param {CoinToss} toss @param {string | null} viewerId */
  const nodeFor = (toss, viewerId) => {
    const flip = new CoinFlip({ toss, animation });
    const node = new CoinTossNode({ flip, width: 1600, height: 900, viewerId, nameOf: (id) => (id === "ai" ? "Opponent" : `@${id}`) });
    return { flip, node };
  };

  it("names each player beside their face, the viewer on the left as \"You\"", () => {
    const { flip, node } = nodeFor(tossWonBy("ai", "ai"), "player");
    flip.update(animation.longMs);
    const texts = paintedTexts(node);
    assert.ok(texts.includes("Coin toss"));
    assert.deepEqual(
      texts.filter((text) => ["You", "Opponent", "Heads", "Tails"].includes(text)),
      ["You", "Tails", "Opponent", "Heads"],
      "left plate (you, tails) then right plate (the opponent, heads)",
    );
    assert.ok(!texts.some((text) => text.endsWith("first")), "no verdict before the coin lands");
  });

  it("leads each name with the player's portrait online, and with none against the AI", () => {
    const flip = new CoinFlip({ toss: tossWonBy("ai", "ai"), animation });
    const online = new CoinTossNode({ flip, width: 1600, height: 900, viewerId: "player", nameOf: (id) => `@${id}`, accountOf: (id) => id });
    flip.update(animation.longMs);
    const texts = paintedTexts(online);
    assert.deepEqual(texts.filter((text) => ["P", "You", "A", "@ai"].includes(text)), ["P", "You", "A", "@ai"], "each initial (no picture yet) before its name");
    const offline = nodeFor(tossWonBy("ai", "ai"), "player");
    offline.flip.update(animation.longMs);
    assert.ok(!paintedTexts(offline.node).includes("P"));
  });

  it("announces the face that came up and who plays first", () => {
    for (const [winner, verdict] of /** @type {const} */ ([["player", "You play first"], ["ai", "Opponent plays first"]])) {
      const { flip, node } = nodeFor(tossWonBy(winner), "player");
      runUntil(flip, () => flip.frame.verdict === 1, "the verdict is in");
      const texts = paintedTexts(node);
      assert.ok(texts.includes(winner === "player" ? "Heads!" : "Tails!"), texts.join(", "));
      assert.ok(texts.includes(verdict));
      assert.equal(node.verdictText, verdict);
    }
  });

  it("for a spectator, names both players and keeps the toss's order", () => {
    const toss = new CoinToss({ calls: { s0: CoinFace.HEADS, s1: CoinFace.TAILS }, landed: CoinFace.TAILS });
    const { flip, node } = nodeFor(toss, null);
    runUntil(flip, () => flip.frame.verdict === 1, "the verdict is in");
    const texts = paintedTexts(node);
    assert.deepEqual(texts.filter((text) => /^@s\d$/.test(text)), ["@s0", "@s1"], "left plate, then right");
    assert.ok(texts.includes("@s1 plays first"));
    assert.ok(!texts.includes("You"));
  });

  it("swallows presses: it is the only thing under the pointer", () => {
    const { node } = nodeFor(tossWonBy("player"), "player");
    assert.equal(node.hitTest({ x: 800, y: 450 }), node);
    assert.equal(node.hitTest({ x: 5, y: 890 }), node);
    assert.doesNotThrow(() => node.activate());
  });
});

describe("MatchScene coin toss (practice match)", () => {
  it("plays the toss before the match begins: the AI waits, the board keeps the result, nothing can be played", async () => {
    const session = practiceSession("ai");
    const scene = new MatchScene(services());
    scene.enter({ session });
    assert.equal(scene.isTossing, true);
    await session.whenIdle();
    assert.equal(session.version, 0, "the match has not begun");

    const texts = rendered(scene);
    assert.ok(texts.includes("Coin toss · who plays first?"), "the banner does not tell whose turn it is");
    assert.ok(!texts.some((text) => /Your turn|Opponent's turn/.test(text)));
    assert.ok(texts.includes("Coin toss"));
    assert.equal(buttonWithId(scene, "endTurn").enabled, false, "no ending a turn under the coin");
    const card = nodesOf(scene.root).find((node) => node instanceof CardNode);
    assert.ok(card, "the opening hand is on the table");
    const centre = { x: card.bounds.x + card.bounds.width / 2, y: card.bounds.y + card.bounds.height / 2 };
    assert.ok(scene.root.hitTest(centre) instanceof CoinTossNode, "the coin covers the board");
    scene.onKey({ type: "keydown", key: "e", repeat: false });
    assert.equal(session.version, 0, "keys are ignored during the toss");

    runUntil(scene, () => !scene.isTossing, "the toss ends");
    await session.whenIdle();
    assert.ok(session.version > 0, "the match began once the coin had landed");
    assert.equal(session.snapshotFor(null).turnNumber >= 1, true);
    assert.equal(session.snapshotFor(null).awaitingPlayerId, "player", "the AI took the first turn, now it is ours");
    assert.ok(!rendered(scene).includes("Coin toss"), "the coin is gone");
    assert.equal(buttonWithId(scene, "endTurn").enabled, false, "held back while the AI's turn is shown");
    runUntil(scene, () => !scene.isBusy, "the board settles");
    const after = rendered(scene);
    assert.ok(after.some((text) => text.includes("Your turn")), after.join(" | "));
    assert.equal(buttonWithId(scene, "endTurn").enabled, true);
  });

  it("gives the first turn to the human when they win the toss", async () => {
    const session = practiceSession("player");
    const scene = new MatchScene(services());
    scene.enter({ session });
    runUntil(scene, () => !scene.isTossing, "the toss ends");
    await session.whenIdle();
    const snapshot = session.snapshotFor("player");
    assert.equal(snapshot.turnNumber, 1);
    assert.equal(snapshot.activePlayerId, "player");
  });

  it("starts straight away when there is no toss to show, and leaves a running match alone", async () => {
    const service = new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger: new MemoryLogger() });
    const created = service.createMatch({
      seats: [
        { id: "player", name: "You", deckList: ember, controller: humanController },
        { id: "ai", name: "Opponent", deckList: iron, controller: new BasicAiController() },
      ],
      seed: 42,
    });
    assert.ok(created.ok);
    const scene = new MatchScene(services());
    scene.enter({ session: created.value });
    assert.equal(scene.isTossing, false);
    assert.ok(created.value.version > 0, "begun on entering");

    const version = created.value.version;
    scene.exit();
    scene.enter({ session: created.value });
    assert.equal(created.value.version, version, "entering again does not restart it");
  });

  it("leaving during the toss drops it", () => {
    const scene = new MatchScene(services());
    scene.enter({ session: practiceSession("ai") });
    scene.exit();
    assert.equal(scene.isTossing, false);
  });
});

describe("MatchScene coin toss (online)", () => {
  const PLAYERS = [
    { id: "s0", name: "alice" },
    { id: "s1", name: "bob" },
  ];

  /** A session for seat s0 fed the server's opening, from a real engine snapshot with the online seat ids. */
  function openedOnline() {
    const local = practiceSession("player").snapshotFor("player");
    const rename = (id) => (id === "player" ? "s0" : "s1");
    const snapshot = { ...local, version: 1, activePlayerId: "s1", awaitingPlayerId: "s1", players: local.players.map((player) => ({ ...player, id: rename(player.id), name: PLAYERS.find((seat) => seat.id === rename(player.id))?.name })) };
    const session = new RemoteMatchSession({ gameId: "01j8x3r6h2qkq4w0v7m5a9c1dz", seat: "s0", request: async () => ({ ok: false, error: { code: "OFFLINE", message: "offline" } }), newCommandId: () => "c1" });
    session.apply({ version: 1, snapshot, events: [{ type: GameEventType.GAME_STARTED, firstPlayerId: "s1" }] });
    return session;
  }

  it("shows the server's choice as a toss between the two accounts, then hands the board over", () => {
    const session = openedOnline();
    const scene = new MatchScene(services());
    scene.enter({ session, againScene: SceneId.ONLINE });
    assert.equal(scene.isTossing, true);
    runUntil(scene, () => scene.isTossing === false || rendered(scene).includes("@bob plays first"), "the verdict");
    const texts = rendered(scene);
    assert.ok(texts.includes("You"));
    assert.ok(texts.includes("@bob"));
    assert.ok(texts.includes("@bob plays first"));
    runUntil(scene, () => !scene.isTossing, "the toss ends");
    assert.ok(rendered(scene).some((text) => text.includes("Opponent's turn")));
  });

  it("does not toss again for a game already under way", () => {
    const session = openedOnline();
    session.apply({ version: 2, snapshot: { ...session.snapshotFor("s0"), version: 2 }, events: [] });
    const scene = new MatchScene(services());
    scene.enter({ session, againScene: SceneId.ONLINE });
    assert.equal(scene.isTossing, false);
  });
});

describe("DeckSelectionScene coin toss", () => {
  it("hands the match screen a match that has not begun, with its toss", () => {
    const logger = new MemoryLogger();
    const repository = new StoredDeckRepository({ store: new InMemoryStore(), logger });
    let seeds = 0;
    const app = {
      content,
      repository,
      deckSelection: new DeckSelectionService({ content, repository, logger }),
      deckBuilding: new DeckBuildingService({ content, repository }),
      matchSetup: new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger }),
      createSeed: () => (seeds++ % 2 === 0 ? "9f" : "3c").repeat(32),
      logger,
      environment: { version: "test", storage: "memory" },
    };
    const navigated = [];
    const scene = new DeckSelectionScene(services({ navigate: (id, params) => navigated.push({ id, params }) }), app);
    scene.enter({});
    nodesOf(scene.root).find((node) => node.id === "startMatch").activate();
    assert.equal(navigated.length, 1);
    const { session } = navigated[0].params;
    assert.ok(session instanceof MatchSession);
    assert.equal(session.version, 0, "the match begins after the toss, on the match screen");
    assert.ok(session.openingToss !== null);
    assert.deepEqual([...session.openingToss.playerIds].sort(), ["ai", "player"]);
    const entry = logger.entries.find((line) => line.message === "match created");
    assert.equal(entry?.data?.coinSeed, "3c".repeat(32), "the coin has its own seed, logged to replay the match");
    assert.equal(entry?.data?.first, session.openingToss.firstPlayerId);
  });
});

describe("ImageCache", () => {
  /** A loader whose downloads the test settles by hand. */
  function manualLoader() {
    /** @type {Map<string, { resolve: (image: object) => void, reject: (error: Error) => void }>} */
    const pending = new Map();
    const requested = [];
    return {
      requested,
      loadImage: (url) => {
        requested.push(url);
        return new Promise((resolve, reject) => pending.set(url, { resolve, reject }));
      },
      succeed: (url, size = { width: 64, height: 64 }) => pending.get(url)?.resolve({ source: { url }, ...size }),
      fail: (url) => pending.get(url)?.reject(new Error("404")),
    };
  }

  it("answers null until the image is decoded, downloads it once, and asks for a redraw when it arrives", async () => {
    const loader = manualLoader();
    let redraws = 0;
    const cache = new ImageCache({ loadImage: loader.loadImage, onLoaded: () => { redraws += 1; } });
    assert.equal(cache.imageFor("a", "art/a.png"), null);
    assert.equal(cache.imageFor("a", "art/a.png"), null);
    assert.deepEqual(loader.requested, ["art/a.png"], "one download per key");
    loader.succeed("art/a.png");
    await cache.load("a", "art/a.png");
    assert.equal(redraws, 1);
    assert.deepEqual(cache.imageFor("a", "art/a.png")?.source, { url: "art/a.png" });
  });

  it("reports a failed or empty image once and never retries it", async () => {
    const loader = manualLoader();
    const failures = [];
    const cache = new ImageCache({ loadImage: loader.loadImage, onFailed: (failure) => failures.push(failure) });
    cache.imageFor("missing", "art/missing.png");
    cache.imageFor("empty", "art/empty.png");
    loader.fail("art/missing.png");
    loader.succeed("art/empty.png", { width: 0, height: 0 });
    await Promise.all([cache.load("missing", "art/missing.png"), cache.load("empty", "art/empty.png")]);
    assert.deepEqual(failures, [
      { key: "missing", url: "art/missing.png", reason: "404" },
      { key: "empty", url: "art/empty.png", reason: "the image is empty" },
    ]);
    assert.equal(cache.imageFor("missing", "art/missing.png"), null);
    assert.equal(loader.requested.length, 2, "no retry");
  });
});

describe("CoinArt", () => {
  const URLS = { [CoinFace.HEADS]: "art/coin_testa.png", [CoinFace.TAILS]: "art/coin_croce.png" };
  const DISC = { x: 0.5, y: 0.465, radius: 0.36 };
  const instantLoader = (requested = []) => async (url) => {
    requested.push(url);
    return { source: { url }, width: 1024, height: 1024 };
  };

  it("loads each face from its own image and hands it out with where its disc sits", async () => {
    const requested = [];
    let redraws = 0;
    const art = new CoinArt({ urls: URLS, disc: DISC, loadImage: instantLoader(requested), onLoaded: () => { redraws += 1; }, logger: new MemoryLogger() });
    assert.equal(art.imageFor(CoinFace.HEADS), null, "not ready on first ask");
    await art.preload();
    assert.deepEqual(requested.sort(), ["art/coin_croce.png", "art/coin_testa.png"]);
    assert.equal(redraws, 2);
    assert.deepEqual(art.imageFor(CoinFace.HEADS)?.image.source, { url: "art/coin_testa.png" });
    assert.deepEqual(art.imageFor(CoinFace.TAILS)?.image.source, { url: "art/coin_croce.png" });
    assert.deepEqual(art.imageFor(CoinFace.TAILS)?.disc, DISC);
    assert.equal(art.imageFor("edge"), null, "no such face");
  });

  it("warns once about a face that cannot be loaded, which stays drawn procedurally", async () => {
    const logger = new MemoryLogger();
    const art = new CoinArt({ urls: URLS, disc: DISC, loadImage: async () => Promise.reject(new Error("404")), logger });
    await art.preload();
    assert.equal(art.imageFor(CoinFace.HEADS), null);
    assert.deepEqual(logger.entries.map((entry) => [entry.level, entry.message, entry.data.face]).sort(), [["warn", "coin art unavailable", "heads"], ["warn", "coin art unavailable", "tails"]]);
  });

  it("refuses art missing a face, or a disc that is not a fraction of the image", () => {
    const deps = { loadImage: instantLoader(), logger: new MemoryLogger() };
    assert.throws(() => new CoinArt({ ...deps, urls: { [CoinFace.HEADS]: "a.png" }, disc: DISC }), /each face/);
    assert.throws(() => new CoinArt({ ...deps, urls: URLS, disc: { x: 0.5, y: 0.5, radius: 360 } }), /fractions/);
  });

  it("the bundled art is there: one 1024x1024 PNG per face", () => {
    for (const file of ["coin_testa.png", "coin_croce.png"]) {
      const bytes = readFileSync(new URL(`../../../../data/art/${file}`, import.meta.url));
      assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${file} is a PNG`);
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1024, 1024], `${file} is 1024x1024 (the disc framing in main.js assumes it)`);
    }
  });
});

describe("CoinTossNode with the painted coin", () => {
  /** Coin art whose images are ready at once: 200x200, the disc filling it. */
  const readyArt = { imageFor: (face) => ({ image: { source: { face }, width: 200, height: 200 }, disc: { x: 0.5, y: 0.5, radius: 0.5 } }) };
  const drawnImages = (node, withTheme) => {
    const context = new FakeContext2D();
    node.draw(context, withTheme);
    return context.calls.filter((call) => call.method === "drawImage").map((call) => [call.args[0].face, ...call.args.slice(1).map((value) => Math.round(value))]);
  };

  it("draws each face from its image, its disc on the coin's centre and at the coin's size", () => {
    const flip = new CoinFlip({ toss: tossWonBy("ai", "ai"), animation });
    flip.update(animation.longMs);
    const node = new CoinTossNode({ flip, width: 1600, height: 900, viewerId: "player", nameOf: () => "Opponent" });
    assert.deepEqual(
      drawnImages(node, { ...theme, coinArt: readyArt }),
      [
        [CoinFace.TAILS, 800 - 420 - 38, 450 - 38 - 38, 76, 76],
        [CoinFace.HEADS, 800 + 420 - 38, 450 - 38 - 38, 76, 76],
        [CoinFace.HEADS, 800 - 74, 450 + 40 - 74, 148, 148],
      ],
      "your plate (tails), the opponent's (heads), then the coin in the hand, heads up",
    );
  });

  it("squashes the image as the coin turns edge-on", () => {
    const flip = new CoinFlip({ toss: tossWonBy("player"), animation });
    runUntil(flip, () => flip.frame.flight > 0 && flip.squeeze < 0.3, "the coin turns edge-on", { step: 5 });
    const node = new CoinTossNode({ flip, width: 1600, height: 900, viewerId: "player", nameOf: () => "Opponent" });
    const [, , , width, height] = drawnImages(node, { ...theme, coinArt: readyArt }).at(-1) ?? [];
    assert.ok(height < width * 0.35, `thin while edge-on: ${width}x${height}`);
  });

  it("draws the coin itself while no image is ready", () => {
    const flip = new CoinFlip({ toss: tossWonBy("player"), animation });
    flip.update(animation.longMs);
    const node = new CoinTossNode({ flip, width: 1600, height: 900, viewerId: "player", nameOf: () => "Opponent" });
    assert.deepEqual(drawnImages(node, { ...theme, coinArt: { imageFor: () => null } }), []);
    assert.deepEqual(drawnImages(node, theme), [], "nor without any coin art");
    const context = new FakeContext2D();
    node.draw(context, theme);
    assert.ok(context.calls.some((call) => call.method === "ellipse"), "the procedural coin");
  });
});
