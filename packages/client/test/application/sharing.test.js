/**
 * Sharing a finished game as a ping on cur8.fun (docs/tcg/26-ping.md): what
 * the ping says, the picture of the result as data, and the comment
 * published under the latest wall with cur8.fun's metadata and the picture.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { GameSharing } from "../../src/application/social/GameSharing.js";
import { MAX_PING_LENGTH, pingText } from "../../src/application/social/pingText.js";
import { kindOf, shareCardOf } from "../../src/application/social/shareCard.js";

const URL = "https://play.kijam.example";
const bob = Object.freeze({ name: "bob", account: "bob", character: false });
const gravelord = Object.freeze({ name: "The Gravelord", account: "ai_gravelord", character: true });
const played = (fields = {}) => ({ outcome: "win", opponent: bob, turns: 12, myLife: 14, theirLife: 0, ...fields });

describe("pingText", () => {
  it("tells who won, against whom and in which kind of game, how it went, then where to play", () => {
    assert.equal(pingText({ ...played(), mode: "ranked", url: URL }), `I won a ranked game against @bob on KIJAM! 🏆\n⚔️ 12 turns · ❤️ 14 vs 0\n\nPlay: ${URL}\n#kijam #tcg`);
    assert.match(pingText({ ...played({ outcome: "loss" }), mode: "casual", url: URL }), /^@bob beat me in a casual game on KIJAM\. GG!/);
    assert.match(pingText({ ...played({ outcome: "draw" }), mode: null, url: URL }), /^A draw against @bob in a game on KIJAM/);
  });

  it("names a challenge's character, never mentions its seat, and tells the boss and the track", () => {
    const won = pingText({ ...played({ opponent: gravelord }), mode: "daily", challenge: { boss: true, track: "Hard" }, url: URL });
    assert.match(won, /^I beat The Gravelord, today's boss, in KIJAM's Challenges! 🏆\n⚔️ 12 turns · ❤️ 14 vs 0 · Hard/);
    assert.ok(!won.includes("@ai_"));
    assert.match(pingText({ ...played({ outcome: "loss", opponent: gravelord }), mode: "daily", challenge: { boss: false, track: "Normal" }, url: URL }), /^The Gravelord beat me in KIJAM's Challenges/);
  });

  it("stays within cur8.fun's 280 characters", () => {
    const text = pingText({ ...played(), mode: "ranked", url: `https://${"x".repeat(300)}.example` });
    assert.ok([...text].length <= MAX_PING_LENGTH);
    assert.ok(text.includes("#kijam") && text.includes("14 vs 0"));
  });
});

describe("shareCardOf", () => {
  it("is the result as the picture shows it", () => {
    const card = shareCardOf({ ...played({ opponent: gravelord }), mode: "daily", challenge: { boss: true, track: "Hard" }, url: URL }, { name: "@alice", account: "alice" });
    assert.deepEqual(card, {
      outcome: "win",
      title: "Victory",
      kind: "Challenges · Hard · Boss",
      me: { name: "@alice", account: "alice", life: 14 },
      opponent: { name: "The Gravelord", account: "ai_gravelord", life: 0 },
      turns: 12,
      site: "play.kijam.example",
    });
    assert.equal(kindOf({ mode: "ranked" }), "Ranked game");
    assert.equal(kindOf({ mode: "casual" }), "Casual game");
  });
});

describe("GameSharing", () => {
  /** @param {{ account?: string | null, wall?: any, images?: boolean, painted?: any }} [options] */
  function sharing({ account = "alice", wall, images = true, painted = ok("/9j/4AAQ") } = {}) {
    const posted = [];
    const uploaded = [];
    const service = new GameSharing({
      api: {
        wall: async () => wall ?? ok({ author: "micro.cur8", permlink: "pings-wall-2026-10-16-utc", images }),
        uploadImage: async (image) => (uploaded.push(image), ok("https://images.example/ping.jpg")),
      },
      wallet: { postComment: async (request) => (posted.push(request), ok("a".repeat(40))) },
      image: { render: async () => painted },
      account: () => account,
      mode: (gameId) => (gameId === "g-1" ? "ranked" : null),
      randomHex: () => "0a1b2c3d4e5f",
      url: URL,
      version: "0.31.0",
    });
    return { service, posted, uploaded };
  }

  it("offers sharing an online game while signed in", () => {
    assert.equal(sharing().service.canShare("g-1"), true);
    assert.equal(sharing().service.canShare(undefined), false, "a local game");
    assert.equal(sharing({ account: null }).service.canShare("g-1"), false);
    assert.match(sharing().service.textFor("g-1", played()), /a ranked game against @bob/, "the game's kind comes from the online game");
    assert.equal(sharing().service.cardFor("g-1", played()).me.name, "@alice");
  });

  it("publishes the ping under the latest wall with the picture of the result and cur8.fun's metadata", async () => {
    const { service, posted, uploaded } = sharing();
    assert.deepEqual(await service.share("g-1", played()), ok("a".repeat(40)));
    assert.deepEqual(uploaded, ["/9j/4AAQ"]);
    const [comment] = posted;
    const text = `I won a ranked game against @bob on KIJAM! 🏆\n⚔️ 12 turns · ❤️ 14 vs 0\n\nPlay: ${URL}\n#kijam #tcg`;
    assert.deepEqual({ ...comment, jsonMetadata: JSON.parse(comment.jsonMetadata) }, {
      author: "alice",
      parentAuthor: "micro.cur8",
      parentPermlink: "pings-wall-2026-10-16-utc",
      permlink: "re-pings-wall-2026-10-1-kijam-0a1b2c3d4e5f",
      title: "",
      body: `${text}\n\n![](https://images.example/ping.jpg)`,
      jsonMetadata: { app: "kijam/0.31.0", format: "markdown", type: "ping", tags: ["pings", "kijam", "tcg"], users: ["bob"], image: ["https://images.example/ping.jpg"] },
    });
  });

  it("goes without a picture where the server hosts none, and stops when the picture cannot be made", async () => {
    const plain = sharing({ images: false });
    assert.equal((await plain.service.share("g-1", played())).ok, true);
    assert.ok(!plain.posted[0].body.includes("![]"));
    assert.deepEqual(plain.uploaded, []);
    const broken = sharing({ painted: fail("IMAGE_FAILED", "no canvas") });
    assert.match((await broken.service.share("g-1", played())).error.message, /picture could not be made/);
    assert.deepEqual(broken.posted, []);
  });

  it("posts nothing signed out, or without a wall", async () => {
    const signedOut = sharing({ account: null });
    assert.equal((await signedOut.service.share("g-1", played())).ok, false);
    const noWall = sharing({ wall: fail("NOT_FOUND", "there is no Pings wall to post on yet") });
    assert.equal((await noWall.service.share("g-1", played())).error.code, "NOT_FOUND");
    assert.deepEqual([...signedOut.posted, ...noWall.posted], []);
  });
});
