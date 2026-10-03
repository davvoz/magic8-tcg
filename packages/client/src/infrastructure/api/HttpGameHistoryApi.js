/**
 * GameHistoryApi over the game server's HTTP API, with every response
 * checked for the shape the application relies on.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const GAME_ID = /^[0-9a-hjkmnp-tv-z]{26}$/;
const RESULTS = Object.freeze(["win", "loss", "draw"]);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isAccount = (value) => typeof value === "string" && /^[a-z0-9.-]{1,32}$/.test(value);
const isGameId = (value) => typeof value === "string" && GAME_ID.test(value);

/** @param {any} value */
function playedGame(value) {
  const valid =
    isGameId(value?.gameId) &&
    typeof value.mode === "string" &&
    isAccount(value.opponent) &&
    RESULTS.includes(value.result) &&
    (value.endReason === null || typeof value.endReason === "string") &&
    isCount(value.turn) &&
    (value.startedAt === null || isCount(value.startedAt)) &&
    isCount(value.finishedAt);
  if (!valid) {
    return null;
  }
  const { gameId, mode, opponent, result, endReason, turn, startedAt, finishedAt } = value;
  return Object.freeze({ gameId, mode, opponent, result, endReason, turn, startedAt, finishedAt });
}

export class HttpGameHistoryApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  /**
   * @param {string} account
   * @param {string | null} [before]
   */
  async played(account, before = null) {
    const page = before === null ? "" : "&before=" + encodeURIComponent(before);
    const query = `account=${encodeURIComponent(account)}${page}`;
    const response = await this.#transport.request("GET", `/api/games/history?${query}`);
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const games = Array.isArray(body?.games) ? body.games.map(playedGame) : null;
    if (!isAccount(body?.account) || games === null || games.includes(null) || !(body.next === null || isGameId(body.next))) {
      return fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response");
    }
    return ok(Object.freeze({ account: body.account, games: Object.freeze(games), next: body.next }));
  }
}
