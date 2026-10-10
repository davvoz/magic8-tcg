/**
 * AutoApi over the game server's HTTP API, with every response checked for
 * the shape the application relies on.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const GAME_ID = /^[0-9a-hjkmnp-tv-z]{26}$/;
const HEX = (bytes) => new RegExp(`^[0-9a-f]{${2 * bytes}}$`);
const HASH = HEX(32);
const ENTROPY = HEX(16);
const isAccount = (value) => typeof value === "string" && /^[a-z0-9.-]{1,32}$/.test(value);
const isSeat = (value) => value === "s0" || value === "s1";

/** @param {any} value */
function ticket(value) {
  const valid = isSeat(value?.seat) && isAccount(value.account) && typeof value.style === "string" && HASH.test(value.commit) && HASH.test(value.secret) && ENTROPY.test(value.entropy);
  return valid ? Object.freeze({ seat: value.seat, account: value.account, style: value.style, commit: value.commit, secret: value.secret, entropy: value.entropy }) : null;
}

/** @param {any} value */
function event(value) {
  const valid = Number.isSafeInteger(value?.i) && typeof value.k === "string" && (value.a === null || isSeat(value.a)) && Number.isSafeInteger(value.t) && Number.isSafeInteger(value.ms) && value.d !== null && typeof value.d === "object";
  return valid ? Object.freeze({ i: value.i, k: value.k, a: value.a, t: value.t, ms: value.ms, d: value.d }) : null;
}

/** @param {any} value */
function player(value) {
  return isSeat(value?.seat) && isAccount(value.account) ? Object.freeze({ seat: value.seat, account: value.account }) : null;
}

/**
 * Every item read with `read`, or null when the list is not one, has another length, or holds a bad item.
 * @template T
 * @param {unknown} value
 * @param {(item: any) => T | null} read
 * @param {(count: number) => boolean} counts
 * @returns {readonly T[] | null}
 */
function listOf(value, read, counts) {
  if (!Array.isArray(value) || !counts(value.length)) {
    return null;
  }
  const items = value.map(read);
  return items.includes(null) ? null : Object.freeze(/** @type {T[]} */ (items));
}

/** @param {any} value */
const hasGame = (value) => typeof value?.gameId === "string" && GAME_ID.test(value.gameId) && value.mode === "auto" && HASH.test(value.contentHash);

/** @param {any} value */
function replay(value) {
  const two = (/** @type {number} */ count) => count === 2;
  const players = listOf(value?.players, player, two);
  const tickets = listOf(value?.tickets, ticket, two);
  const events = listOf(value?.events, event, (count) => count > 0);
  if (!hasGame(value) || players === null || tickets === null || events === null) {
    return null;
  }
  return Object.freeze({
    gameId: value.gameId,
    mode: value.mode,
    contentHash: value.contentHash,
    winnerSeat: isSeat(value.winnerSeat) ? value.winnerSeat : null,
    endReason: typeof value.endReason === "string" ? value.endReason : null,
    finishedAt: Number.isSafeInteger(value.finishedAt) ? value.finishedAt : null,
    players,
    aiVersion: Number.isSafeInteger(value.aiVersion) ? value.aiVersion : null,
    tickets,
    events,
  });
}

export class HttpAutoApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  /** @param {string} gameId */
  async replay(gameId) {
    if (!GAME_ID.test(gameId)) {
      return fail(ApiFailure.BAD_RESPONSE, "not a game id");
    }
    const response = await this.#transport.request("GET", `/api/auto/games/${gameId}`);
    if (!response.ok) {
      return response;
    }
    const parsed = replay(response.value);
    return parsed === null ? fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response") : ok(parsed);
  }
}
