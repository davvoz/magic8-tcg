/**
 * The painted table (TableArt): the mat the match is played on, the card
 * back and the panel stone, each loaded through an ImageCache, and the
 * painters that use them once they are ready and draw procedurally until then.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { PlayerNode } from "../../src/rendering/board/PlayerNode.js";
import { drawCardBack } from "../../src/rendering/cards/CardRenderer.js";
import { TableArt, TablePiece } from "../../src/rendering/images/TableArt.js";
import { drawTableBackdrop } from "../../src/rendering/ui/backdrop.js";
import { Panel } from "../../src/rendering/ui/Panel.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const URLS = { [TablePiece.MAT]: "art/mat.jpg", [TablePiece.CARD_BACK]: "art/back.jpg", [TablePiece.PANEL]: "art/stone.jpg" };
const readyArt = { imageFor: (piece) => ({ source: { piece }, width: 800, height: 1200 }) };
const noArt = { imageFor: () => null };

/** The pieces drawn, in order, with where they landed. */
const drawnPieces = (context) => context.calls.filter((call) => call.method === "drawImage").map((call) => [call.args[0].piece, ...call.args.slice(5).map((value) => Math.round(value))]);

function assertBalanced(context) {
  assert.equal(context.calls.filter((call) => call.method === "save").length, context.calls.filter((call) => call.method === "restore").length, "save/restore balanced");
  assert.equal(context.globalAlpha, 1, "alpha restored");
}

describe("TableArt", () => {
  const instantLoader = (requested = []) => async (url) => {
    requested.push(url);
    return { source: { url }, width: 800, height: 1200 };
  };

  it("loads each piece from its own image", async () => {
    const requested = [];
    let redraws = 0;
    const art = new TableArt({ urls: URLS, loadImage: instantLoader(requested), onLoaded: () => { redraws += 1; }, logger: new MemoryLogger() });
    assert.equal(art.imageFor(TablePiece.MAT), null, "not ready on first ask");
    await art.preload();
    assert.deepEqual(requested.sort(), ["art/back.jpg", "art/mat.jpg", "art/stone.jpg"]);
    assert.equal(redraws, 3);
    assert.deepEqual(art.imageFor(TablePiece.CARD_BACK)?.source, { url: "art/back.jpg" });
    assert.equal(art.imageFor("ceiling"), null, "no such piece");
  });

  it("warns once about a piece that cannot be loaded, which stays drawn procedurally", async () => {
    const logger = new MemoryLogger();
    const art = new TableArt({ urls: URLS, loadImage: async () => Promise.reject(new Error("404")), logger });
    await art.preload();
    assert.equal(art.imageFor(TablePiece.PANEL), null);
    assert.deepEqual(logger.entries.map((entry) => [entry.message, entry.data.piece]).sort(), [["table art unavailable", "cardBack"], ["table art unavailable", "mat"], ["table art unavailable", "panel"]]);
  });

  it("refuses art missing a piece", () => {
    assert.throws(() => new TableArt({ urls: { [TablePiece.MAT]: "mat.jpg" }, loadImage: instantLoader(), logger: new MemoryLogger() }), /each piece/);
  });

  it("the bundled art is there: one JPEG per piece", () => {
    for (const file of ["Tappeto.jpg", "Dorso.jpg", "Texture.jpg"]) {
      const bytes = readFileSync(new URL(`../../../../data/art/${file}`, import.meta.url));
      assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8], `${file} is a JPEG`);
    }
  });
});

describe("painting the table", () => {
  it("the card back is the painted one, clipped to the card, once it is ready", () => {
    const at = { x: 10, y: 20, width: 48, height: 68 };
    const painted = new FakeContext2D();
    drawCardBack(painted, { ...theme, tableArt: readyArt }, at);
    assert.deepEqual(drawnPieces(painted), [[TablePiece.CARD_BACK, 10, 20, 48, 68]]);
    assert.ok(painted.calls.some((call) => call.method === "clip"));
    assert.deepEqual(painted.texts, []);
    assertBalanced(painted);

    const drawn = new FakeContext2D();
    drawCardBack(drawn, { ...theme, tableArt: noArt }, at);
    assert.deepEqual(drawnPieces(drawn), [], "the procedural back while the image is on its way");
    assertBalanced(drawn);
  });

  it("the match is played on the mat, which covers the whole screen", () => {
    const bounds = { x: 0, y: 0, width: 1600, height: 900 };
    const painted = new FakeContext2D();
    drawTableBackdrop(painted, { ...theme, tableArt: readyArt }, bounds);
    assert.deepEqual(drawnPieces(painted), [[TablePiece.MAT, 0, 0, 1600, 900]]);
    assertBalanced(painted);

    const drawn = new FakeContext2D();
    drawTableBackdrop(drawn, theme, bounds);
    assert.deepEqual(drawnPieces(drawn), [], "without the mat, the shared backdrop");
    assert.ok(drawn.calls.some((call) => call.method === "createRadialGradient"));
  });

  it("textured panels and the player HUD are cut from the stone; plain panels are not", () => {
    const withArt = { ...theme, tableArt: readyArt };
    const textured = new FakeContext2D();
    new Panel({ x: 0, y: 0, width: 200, height: 400, textured: true }).draw(textured, withArt);
    assert.deepEqual(drawnPieces(textured), [[TablePiece.PANEL, 0, 0, 200, 400]]);
    assertBalanced(textured);

    const plain = new FakeContext2D();
    new Panel({ x: 0, y: 0, width: 200, height: 400 }).draw(plain, withArt);
    assert.deepEqual(drawnPieces(plain), []);

    const player = { id: "p1", name: "Alice", life: 12, resources: { current: 1, max: 3 }, librarySize: 20, handSize: 3, graveyard: [] };
    const hud = new FakeContext2D();
    new PlayerNode({ player, rect: { x: 16, y: 16, width: 200, height: 184 }, isMe: true, isActive: false, highlight: null, onTap: () => undefined }).draw(hud, withArt);
    assert.deepEqual(drawnPieces(hud), [[TablePiece.PANEL, 16, 16, 200, 184]]);
    assert.ok(hud.texts.includes("Alice") && hud.texts.includes("12"), "the HUD still reads on top of it");
    assertBalanced(hud);
  });
});
