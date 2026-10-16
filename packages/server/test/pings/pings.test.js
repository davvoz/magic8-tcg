/**
 * Sharing a game as a ping on cur8.fun (docs/tcg/26-ping.md), over HTTP:
 * where to post (the latest wall), the picture of the result handed to the
 * image host, and the relay of a ping a player signed with their posting
 * key, which must be theirs, under a wall, and short.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { serializeTransaction, signDigest, toBroadcastJson, transactionDigest, transactionId } from "@magic8/steem";
import { CLIENT_HEADERS, buildTestApp, keyPair, keychainSign, listen } from "../helpers.js";

const alice = keyPair(1);
const WALLS = Object.freeze([{ author: "micro.cur8", permlink: "wall-2026-09-24" }, { author: "micro.cur8", permlink: "wall-2026-09-23" }]);

async function call(base, path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, json: text.length > 0 ? JSON.parse(text) : null };
}

describe("pings over HTTP", () => {
  let setup;
  let server;
  let wallReads = 0;
  const walls = WALLS;
  const uploads = [];
  const avatarReads = [];
  /** A tiny JPEG: its signature, then anything. */
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");

  before(async () => {
    const pingWall = { account: "micro.cur8", latest: async () => (wallReads += 1, walls) };
    const pingImages = { upload: async (base64) => (uploads.push(base64), "https://images.example/ping-1.jpg") };
    const pingAvatars = { picture: async (account) => (avatarReads.push(account), account === "alice" ? { contentType: "image/png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) } : null) };
    setup = await buildTestApp({ pingWall, pingImages, pingAvatars });
    setup.chain.setAccount("alice", [alice.publicKey]);
    server = await listen(setup.app);
  });

  after(() => server.close());

  async function signIn() {
    const challenge = await call(server.base, "/api/auth/challenges", { method: "POST", headers: CLIENT_HEADERS, body: { account: "alice" } });
    const session = await fetch(`${server.base}/api/auth/sessions`, { method: "POST", headers: CLIENT_HEADERS, body: JSON.stringify({ challengeId: challenge.json.challengeId, signature: keychainSign(challenge.json.message, alice.privateKey) }) });
    return /** @type {string} */ (session.headers.get("set-cookie")).split(";")[0];
  }

  /** A ping signed with alice's posting key. */
  function ping(fields = {}) {
    const transaction = { refBlockNum: 100, refBlockPrefix: 0xb4f4dcdc, expiration: Date.UTC(2026, 8, 24, 10, 1) / 1000, operations: [{ type: "comment", parentAuthor: "micro.cur8", parentPermlink: WALLS[0].permlink, author: "alice", permlink: "re-wall-2026-09-24-kijam-1", title: "", body: "I beat The Gravelord in KIJAM's Challenges! #kijam", jsonMetadata: '{"type":"ping","tags":["pings","kijam"]}', ...fields }] };
    const bytes = serializeTransaction(transaction);
    return { json: toBroadcastJson(transaction, [signDigest(transactionDigest(bytes), alice.privateKey)]), txId: transactionId(bytes) };
  }

  it("tells a signed-in player where to post, reading the chain at most once a minute", async () => {
    const cookie = await signIn();
    assert.deepEqual((await call(server.base, "/api/pings/wall", { headers: { Cookie: cookie } })).json, { ...WALLS[0], images: true });
    await call(server.base, "/api/pings/wall", { headers: { Cookie: cookie } });
    assert.equal(wallReads, 1);
    assert.equal((await call(server.base, "/api/pings/wall")).status, 401);
  });

  it("passes a player's profile picture through as a data URL, kept a while; none for an account without one", async () => {
    const cookie = await signIn();
    const avatar = (account) => call(server.base, `/api/pings/avatars/${account}`, { headers: { Cookie: cookie } });
    assert.deepEqual((await avatar("alice")).json, { image: "data:image/png;base64,iVBORw==" });
    await avatar("alice");
    assert.equal((await avatar("bob")).status, 404);
    assert.equal((await avatar("Not-An-Account")).status, 400);
    assert.deepEqual(avatarReads, ["alice", "bob"], "alice's picture was kept; a bad name never reached the source");
  });

  it("hosts a ping's picture, a JPEG or PNG only", async () => {
    const cookie = await signIn();
    const upload = (image) => call(server.base, "/api/pings/images", { method: "POST", headers: { ...CLIENT_HEADERS, Cookie: cookie }, body: { image } });
    const hosted = await upload(JPEG);
    assert.equal(hosted.status, 201, JSON.stringify(hosted.json));
    assert.deepEqual(hosted.json, { url: "https://images.example/ping-1.jpg" });
    assert.deepEqual(uploads, [JPEG]);
    assert.equal((await upload(Buffer.from("GIF89a....").toString("base64"))).status, 400, "not a JPEG or a PNG");
    assert.equal((await upload("not base64!")).status, 400);
    assert.equal(uploads.length, 1, "nothing else reached the host");
  });

  it("relays the player's own ping under a wall, and nothing else", async () => {
    const cookie = await signIn();
    const post = (transaction) => call(server.base, "/api/pings", { method: "POST", headers: { ...CLIENT_HEADERS, Cookie: cookie }, body: { transaction } });
    const mine = ping();
    const relayed = await post(mine.json);
    assert.equal(relayed.status, 201, JSON.stringify(relayed.json));
    assert.deepEqual(relayed.json, { txId: mine.txId });
    assert.deepEqual(setup.chain.broadcasts.at(-1), { method: "condenser_api.broadcast_transaction", transaction: mine.json });
    assert.equal((await post(ping({ parentPermlink: WALLS[1].permlink }).json)).status, 201, "yesterday's wall still takes a ping");

    const sent = setup.chain.broadcasts.length;
    assert.equal((await post(ping({ parentPermlink: "some-other-post" }).json)).status, 400, "not under a wall");
    assert.equal((await post(ping({ author: "bob" }).json)).status, 400, "someone else's");
    assert.equal((await post(ping({ body: "x".repeat(1601) }).json)).status, 400, "longer than a ping");
    assert.equal(setup.chain.broadcasts.length, sent, "none of them reached the chain");
  });
});
