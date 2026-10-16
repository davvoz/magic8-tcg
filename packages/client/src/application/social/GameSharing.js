/**
 * Sharing a finished online game as a ping on cur8.fun (docs/tcg/26-ping.md):
 * a comment under the latest wall of micro.cur8, published with the wallet
 * the player signed in with (Keychain posts it itself; a posting key signs
 * it here and the game server relays it).
 *
 * The ping says who won, against whom, in which kind of game and how it went
 * (pingText), and shows a picture of the result (shareCard, painted by the
 * ShareImage, hosted by the game server) when the server hosts pictures. Its
 * json_metadata is cur8.fun's: a ping, its hashtags as tags, the accounts it
 * mentions, its picture.
 */
import { fail } from "@magic8/engine/shared/Result.js";
import { pingText } from "./pingText.js";
import { shareCardOf } from "./shareCard.js";

const APP = "kijam";
const PING_TYPE = "ping";
const PING_TAG = "pings";
const MAX_TAGS = 10;
const HASHTAG = /(^|[^\w&/])#([a-z0-9][a-z0-9-]{0,23})/gi;
const MENTION = /(^|[^\w/@])@([a-z][a-z0-9.-]{2,15})/gi;
/** The parent's permlink in a reply's own, as cur8.fun shortens it. */
const PARENT_IN_PERMLINK = 20;

/**
 * @typedef {import("./pingText.js").SharedGame} SharedGame
 * @typedef {Omit<SharedGame, "mode" | "url" | "challenge">} PlayedGame what the board knows of a finished game
 */

export class GameSharing {
  #api;
  #wallet;
  #image;
  #account;
  #mode;
  #challenge;
  #randomHex;
  #url;
  #version;

  /**
   * @param {{
   *   api: import("../ports/PingsApi.contract.js").PingsApi,
   *   wallet: Pick<import("../ports/WalletConnector.contract.js").WalletConnector, "postComment">,
   *   image?: import("../ports/ShareImage.contract.js").ShareImage | null,
   *   account: () => string | null,
   *   mode: (gameId: string) => string | null,
   *   challenge?: (account: string) => import("./pingText.js").SharedChallenge | null,
   *   randomHex: (bytes: number) => string,
   *   url: string,
   *   version: string,
   * }} deps `image`: paints the picture (none: pings go without one); `account`: the signed-in player; `mode`: an online game's kind
   *   (casual, ranked, daily); `challenge`: a challenge character's place in the day, from its seat; `url`: where the game is played
   */
  constructor({ api, wallet, image = null, account, mode, challenge = () => null, randomHex, url, version }) {
    this.#api = api;
    this.#wallet = wallet;
    this.#image = image;
    this.#account = account;
    this.#mode = mode;
    this.#challenge = challenge;
    this.#randomHex = randomHex;
    this.#url = url;
    this.#version = version;
  }

  /**
   * Whether this game can be shared: an online one, while signed in.
   * @param {string | undefined} gameId
   */
  canShare(gameId) {
    return gameId !== undefined && this.#account() !== null;
  }

  /**
   * The ping for a finished game.
   * @param {string} gameId
   * @param {PlayedGame} played
   */
  textFor(gameId, played) {
    return pingText(this.#gameOf(gameId, played));
  }

  /**
   * The picture of a finished game, as data.
   * @param {string} gameId
   * @param {PlayedGame} played
   */
  cardFor(gameId, played) {
    const account = this.#account();
    return shareCardOf(this.#gameOf(gameId, played), { name: account === null ? "Me" : `@${account}`, account });
  }

  /**
   * Publishes the ping under today's wall, with the picture of the result when the server hosts it.
   * @param {string} gameId
   * @param {PlayedGame} played
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async share(gameId, played) {
    const author = this.#account();
    if (author === null) {
      return fail("SIGNED_OUT", "sign in to share your games");
    }
    const wall = await this.#api.wall();
    if (!wall.ok) {
      return wall;
    }
    const picture = wall.value.images && this.#image !== null ? await this.#picture(gameId, played) : null;
    if (picture !== null && !picture.ok) {
      return picture;
    }
    const text = this.textFor(gameId, played);
    const image = picture === null ? null : picture.value;
    const tags = [PING_TAG, ...matches(text, HASHTAG)].slice(0, MAX_TAGS);
    const users = matches(text, MENTION);
    const metadata = { app: `${APP}/${this.#version}`, format: "markdown", type: PING_TYPE, tags, ...(users.length > 0 ? { users } : {}), ...(image === null ? {} : { image: [image] }) };
    return this.#wallet.postComment({
      author,
      parentAuthor: wall.value.author,
      parentPermlink: wall.value.permlink,
      permlink: `re-${trimEnd(wall.value.permlink.slice(0, PARENT_IN_PERMLINK), "-")}-${APP}-${this.#randomHex(6)}`,
      title: "",
      body: image === null ? text : `${text}\n\n![](${image})`,
      jsonMetadata: JSON.stringify(metadata),
    });
  }

  /**
   * The picture of the result, painted and hosted: its address.
   * @param {string} gameId
   * @param {PlayedGame} played
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async #picture(gameId, played) {
    const painted = await /** @type {import("../ports/ShareImage.contract.js").ShareImage} */ (this.#image).render(this.cardFor(gameId, played));
    if (!painted.ok) {
      return fail(painted.error.code, `the picture could not be made (${painted.error.message})`);
    }
    return this.#api.uploadImage(painted.value);
  }

  /**
   * @param {string} gameId
   * @param {PlayedGame} played
   * @returns {SharedGame}
   */
  #gameOf(gameId, played) {
    const account = played.opponent.account;
    return { ...played, mode: this.#mode(gameId), url: this.#url, challenge: account === null ? null : this.#challenge(account) };
  }
}

/**
 * The distinct names a pattern finds (hashtags, mentions), lowercase, in order.
 * @param {string} text
 * @param {RegExp} pattern
 */
function matches(text, pattern) {
  return [...new Set(Array.from(text.matchAll(pattern), (match) => trimEnd(match[2].toLowerCase(), ".-")))];
}

/**
 * The text without the given characters at its end (a mention's trailing full stop, a permlink's dash).
 * @param {string} text
 * @param {string} characters
 */
function trimEnd(text, characters) {
  let end = text.length;
  while (end > 0 && characters.includes(text[end - 1])) {
    end -= 1;
  }
  return text.slice(0, end);
}
