/**
 * Sharing a game as a ping on cur8.fun (docs/tcg/26-ping.md): a ping is a
 * top-level comment under the latest "wall", a root post the wall account
 * (micro.cur8) publishes every day. The service tells the client where to
 * post (the latest wall), and relays the pings players sign with their
 * posting key in the browser; a player signed in with Keychain has it post
 * the comment itself, and never comes here to post.
 *
 * Only a ping is relayed: one comment by the signed-in account, under one of
 * the latest walls, short. The server is not an open relay for comments.
 *
 * A ping may carry a picture of the result, drawn in the browser: the
 * service hands it to the image host cur8.fun uses (a JPEG or PNG, small)
 * and gives back its address, which the ping then shows.
 */
import { AppError } from "../../../kernel/AppError.js";

/** How long the latest walls are trusted before the chain is read again (one a day is published). */
const WALLS_TTL_MS = 60_000;
/** Today's wall and yesterday's: a ping written as the day changes still lands. */
const WALLS_KEPT = 2;
/** A ping's body: cur8.fun's 280 characters, room for a link and a picture's address, in bytes (emoji take several). */
export const MAX_PING_BODY_BYTES = 1600;
/** A ping's picture: a result card, a JPEG of a few hundred kilobytes at most. */
export const MAX_PING_IMAGE_BYTES = 400 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** What an image starts with: JPEG, PNG. */
const IMAGE_SIGNATURES = Object.freeze([[0xff, 0xd8, 0xff], [0x89, 0x50, 0x4e, 0x47]]);

const encoder = new TextEncoder();

/**
 * @typedef {Readonly<{ author: string, permlink: string }>} PingWallPost
 * @typedef {{ account: string, latest: (count?: number) => Promise<readonly PingWallPost[]> }} PingWallReader the walls on the chain
 * @typedef {{ upload: (base64: string) => Promise<string> }} ImageHost where a ping's picture is hosted; `upload` answers its https address
 * @typedef {{ broadcastComment: (account: string, transaction: unknown, accepts: (comment: { parentAuthor: string, parentPermlink: string, body: string }) => boolean) => Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail> }} CommentRelay
 */

export class PingService {
  #wall;
  #images;
  #wallets;
  #audit;
  #clock;
  /** @type {{ walls: readonly PingWallPost[], atMs: number } | null} */
  #cached = null;

  /**
   * @param {{
   *   wall: PingWallReader,
   *   images?: ImageHost | null,
   *   wallets: ReadonlyMap<string, object>,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   * }} deps `images`: where pings' pictures go (none: pings go without one); `wallets`: by network, the ones that relay a comment
   */
  constructor({ wall, images = null, wallets, audit, clock }) {
    this.#wall = wall;
    this.#images = images;
    this.#wallets = wallets;
    this.#audit = audit;
    this.#clock = clock;
  }

  /**
   * Where a ping goes now: the latest wall, and whether a ping can carry a picture.
   * @returns {Promise<Readonly<{ author: string, permlink: string, images: boolean }>>}
   */
  async latestWall() {
    const [latest] = await this.#walls();
    if (latest === undefined) {
      throw new AppError("NOT_FOUND", "there is no Pings wall to post on yet");
    }
    return Object.freeze({ author: latest.author, permlink: latest.permlink, images: this.#images !== null });
  }

  /**
   * Hosts a ping's picture, drawn in the browser.
   * @param {{ id: string, account: string, network: string }} user
   * @param {unknown} image base64 of a JPEG or a PNG
   * @param {string | null} ip
   * @returns {Promise<string>} its https address
   */
  async uploadImage(user, image, ip) {
    if (this.#images === null) {
      throw new AppError("NOT_FOUND", "pings carry no pictures here");
    }
    checkImage(image);
    let url;
    try {
      url = await this.#images.upload(/** @type {string} */ (image));
    } catch {
      throw new AppError("CHAIN_UNAVAILABLE", "the picture could not be uploaded right now, try again");
    }
    await this.#audit.record({ actorKind: "user", actorUserId: user.id, action: "pings.image_uploaded", targetKind: "account", targetId: `${user.network}:${user.account}`, ip, details: { url } });
    return url;
  }

  /**
   * Relays a ping the player signed in the browser with their posting key.
   * @param {{ id: string, account: string, network: string }} user
   * @param {unknown} transaction signed, in the node's JSON form
   * @param {string | null} ip
   * @returns {Promise<string>} the transaction id
   */
  async relay(user, transaction, ip) {
    const wallet = /** @type {Partial<CommentRelay> | undefined} */ (this.#wallets.get(user.network));
    if (typeof wallet?.broadcastComment !== "function") {
      throw new AppError("UNSUPPORTED_NETWORK", "pings cannot be relayed on this network");
    }
    const walls = await this.#walls();
    const underWall = (/** @type {{ parentAuthor: string, parentPermlink: string, body: string }} */ comment) =>
      walls.some((wall) => wall.author === comment.parentAuthor && wall.permlink === comment.parentPermlink) && encoder.encode(comment.body).length <= MAX_PING_BODY_BYTES;
    const relayed = await wallet.broadcastComment(user.account, transaction, underWall);
    await this.#audit.record({ actorKind: "user", actorUserId: user.id, action: relayed.ok ? "pings.relayed" : "pings.refused", targetKind: "account", targetId: `${user.network}:${user.account}`, ip, details: relayed.ok ? { txId: relayed.value } : { reason: relayed.error.code } });
    if (!relayed.ok) {
      throw failureOf(relayed.error);
    }
    return relayed.value;
  }

  /** The latest walls, newest first, read again once they are a minute old. */
  async #walls() {
    const now = this.#clock.now();
    if (this.#cached !== null && now - this.#cached.atMs < WALLS_TTL_MS) {
      return this.#cached.walls;
    }
    let walls;
    try {
      walls = await this.#wall.latest(WALLS_KEPT);
    } catch {
      throw new AppError("CHAIN_UNAVAILABLE", "the blockchain cannot be reached right now, try again");
    }
    this.#cached = { walls, atMs: now };
    return walls;
  }
}

/**
 * A picture fit for a ping: base64 of a JPEG or a PNG, small.
 * @param {unknown} image
 */
function checkImage(image) {
  if (typeof image !== "string" || !BASE64.test(image) || image.length > Math.ceil(MAX_PING_IMAGE_BYTES / 3) * 4) {
    throw new AppError("VALIDATION", `a picture is a JPEG or PNG of at most ${MAX_PING_IMAGE_BYTES / 1024} KB, base64-encoded`);
  }
  const head = Buffer.from(image.slice(0, 8), "base64");
  if (!IMAGE_SIGNATURES.some((signature) => signature.every((byte, index) => head[index] === byte))) {
    throw new AppError("VALIDATION", "a picture is a JPEG or a PNG");
  }
}

/**
 * What the API tells the player when a ping was not relayed.
 * @param {{ code: string, message: string }} error
 */
function failureOf(error) {
  switch (error.code) {
    case "CHAIN_UNAVAILABLE":
      return new AppError("CHAIN_UNAVAILABLE", "the blockchain cannot be reached right now, try again");
    case "PING_REJECTED":
      // The chain refused it (not enough Resource Credits, a missing authority): the reason is the player's to read.
      return new AppError("PING_REJECTED", error.message);
    default:
      return new AppError("VALIDATION", error.message);
  }
}
