/**
 * The walls of cur8.fun's Pings (its microblog): every day the wall account
 * (micro.cur8) publishes a root post, and each ping is a top-level comment
 * under the latest one. This reads the latest walls, newest first, so a
 * ping can be posted under today's and a relayed one checked to be under a
 * wall indeed.
 */
import { isValidAccountName } from "../accountName.js";

/** @typedef {Readonly<{ author: string, permlink: string }>} PingWallPost */

export class SteemPingWall {
  #rpc;
  #account;

  /**
   * @param {{ rpc: { call: (method: string, params: unknown) => Promise<unknown> }, account: string }} deps `account`: the one publishing the walls
   */
  constructor({ rpc, account }) {
    if (!isValidAccountName(account)) {
      throw new TypeError(`SteemPingWall: "${account}" is not an account name`);
    }
    this.#rpc = rpc;
    this.#account = account;
  }

  get account() {
    return this.#account;
  }

  /**
   * The latest walls, newest first; none when the account has not published one. Throws when the chain cannot be read.
   * @param {number} [count]
   * @returns {Promise<readonly PingWallPost[]>}
   */
  async latest(count = 2) {
    const posts = await this.#rpc.call("bridge.get_account_posts", { account: this.#account, sort: "posts", limit: count });
    if (!Array.isArray(posts)) {
      return Object.freeze([]);
    }
    const walls = posts.filter((post) => post !== null && typeof post === "object" && post.author === this.#account && typeof post.permlink === "string" && (post.depth ?? 0) === 0);
    return Object.freeze(walls.map((post) => Object.freeze({ author: post.author, permlink: post.permlink })));
  }
}
