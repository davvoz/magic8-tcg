/**
 * RankingApi over the game server's HTTP API, with every response checked
 * for the shape the application relies on.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isAccount = (value) => typeof value === "string" && /^[a-z0-9.-]{1,32}$/.test(value);

/**
 * @param {any} value
 * @returns {Readonly<{ id: string, name: string }> | null | undefined} undefined when malformed
 */
function season(value) {
  if (value === null) {
    return null;
  }
  return isObject(value) && typeof value.id === "string" && typeof value.name === "string" ? Object.freeze({ id: value.id, name: value.name }) : undefined;
}

/** @param {any} value */
function entry(value) {
  const counts = ["rank", "games", "wins", "losses", "draws"].every((key) => isCount(value?.[key]));
  return counts && isAccount(value.account) && Number.isSafeInteger(value.rating)
    ? Object.freeze({ rank: value.rank, account: value.account, rating: value.rating, games: value.games, wins: value.wins, losses: value.losses, draws: value.draws })
    : null;
}

/** @param {any} value */
function standing(value) {
  const counts = ["deviation", "games", "wins", "losses", "draws", "casualGamesNeeded"].every((key) => isCount(value?.[key]));
  const parsedSeason = season(value?.season);
  if (!counts || parsedSeason === undefined || !Number.isSafeInteger(value.rating) || typeof value.provisional !== "boolean" || typeof value.eligible !== "boolean" || !(value.rank === null || isCount(value.rank))) {
    return null;
  }
  const { rating, deviation, provisional, rank, games, wins, losses, draws, eligible, casualGamesNeeded } = value;
  return Object.freeze({ season: parsedSeason, rating, deviation, provisional, rank, games, wins, losses, draws, eligible, casualGamesNeeded });
}

/** @param {unknown} value */
const shaped = (value) => (value === null ? fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response") : ok(value));

export class HttpRankingApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  async standing() {
    const response = await this.#transport.request("GET", "/api/ranking/me");
    return response.ok ? shaped(standing(response.value)) : response;
  }

  async leaderboard() {
    const response = await this.#transport.request("GET", "/api/ranking/leaderboard");
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const parsedSeason = season(body?.season);
    const entries = Array.isArray(body?.entries) ? body.entries.map(entry) : null;
    const valid = parsedSeason !== undefined && entries !== null && entries.every((item) => item !== null);
    return shaped(valid ? Object.freeze({ season: parsedSeason, entries: Object.freeze(entries) }) : null);
  }
}
