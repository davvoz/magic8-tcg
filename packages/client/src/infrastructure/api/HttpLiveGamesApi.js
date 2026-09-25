/**
 * LiveGamesApi over the game server's HTTP API, with every response checked
 * for the shape the application relies on.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const GAME_ID = /^[0-9a-hjkmnp-tv-z]{26}$/;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isAccount = (value) => typeof value === "string" && /^[a-z0-9.-]{1,32}$/.test(value);

/** @param {any} value */
function player(value) {
  return typeof value?.seat === "string" && isAccount(value.account) ? Object.freeze({ seat: value.seat, account: value.account }) : null;
}

/** @param {any} value */
const hasGameFields = (value) => typeof value?.gameId === "string" && GAME_ID.test(value.gameId) && typeof value.mode === "string" && isCount(value.turn) && isCount(value.spectators) && (value.startedAt === null || isCount(value.startedAt));

/** @param {any} value */
function liveGame(value) {
  const players = Array.isArray(value?.players) ? value.players.map(player) : [];
  if (!hasGameFields(value) || players.length !== 2 || players.includes(null)) {
    return null;
  }
  return Object.freeze({ gameId: value.gameId, mode: value.mode, players: Object.freeze(players), turn: value.turn, spectators: value.spectators, startedAt: value.startedAt });
}

export class HttpLiveGamesApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  async live() {
    const response = await this.#transport.request("GET", "/api/games/live");
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const games = Array.isArray(body?.games) ? body.games.map(liveGame) : null;
    if (games === null || games.includes(null)) {
      return fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response");
    }
    return ok(Object.freeze(games));
  }
}
