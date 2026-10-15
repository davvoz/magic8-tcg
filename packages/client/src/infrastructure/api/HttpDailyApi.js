/**
 * DailyApi over the game server's HTTP API, with every response checked
 * for the shape the application relies on.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

/** @typedef {import("../../application/ports/DailyApi.contract.js").DailyDay} DailyDay */

const STATES = Object.freeze(["beaten", "next", "locked"]);
const LINE_KINDS = Object.freeze(["intro", "low", "win", "lose", "unlock"]);
const isText = (value) => typeof value === "string" && value.length > 0;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const freezeAll = (items) => Object.freeze(items.map((item) => Object.freeze({ ...item })));

export class HttpDailyApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  async today() {
    return dayOf(await this.#transport.request("GET", "/api/daily"));
  }

  /** @param {string} track */
  async chooseTrack(track) {
    return dayOf(await this.#transport.request("POST", "/api/daily/track", { body: { track } }));
  }

  /** @param {string} deckId */
  async play(deckId) {
    const response = await this.#transport.request("POST", "/api/daily/play", { body: { deckId } });
    if (!response.ok) {
      return response;
    }
    const gameId = /** @type {any} */ (response.value)?.gameId;
    return isText(gameId) ? ok(Object.freeze({ gameId })) : badResponse();
  }
}

/**
 * @param {import("@magic8/engine/shared/Result.js").Ok<unknown> | import("@magic8/engine/shared/Result.js").Fail} response
 * @returns {import("@magic8/engine/shared/Result.js").Ok<DailyDay> | import("@magic8/engine/shared/Result.js").Fail}
 */
function dayOf(response) {
  if (!response.ok) {
    return response;
  }
  const value = /** @type {any} */ (response.value);
  const valid = isObject(value) && isText(value.day) && Number.isFinite(value.endsAt) && Array.isArray(value.tracks) && value.tracks.every(isTrack) && Array.isArray(value.opponents) && value.opponents.every(isOpponent) && (value.run === null || isRun(value.run));
  if (!valid) {
    return badResponse();
  }
  return ok(
    Object.freeze({
      day: value.day,
      endsAt: value.endsAt,
      tracks: freezeAll(value.tracks),
      opponents: Object.freeze(value.opponents.map(opponentOf)),
      run: value.run === null ? null : runOf(value.run),
    }),
  );
}

/** @param {any} value */
function isTrack(value) {
  return isObject(value) && isText(value.id) && isText(value.name) && isText(value.reward);
}

/** @param {any} value */
function isOpponent(value) {
  const texts = ["id", "account", "name", "title", "faction", "style"].every((key) => isText(value?.[key]));
  const lines = isObject(value?.lines) && LINE_KINDS.every((kind) => Array.isArray(value.lines[kind]) && value.lines[kind].every(isText));
  const conditions = Array.isArray(value?.conditions) && value.conditions.every((condition) => isObject(condition) && isText(condition.name) && isText(condition.text) && isText(condition.scope));
  return texts && lines && conditions && typeof value.boss === "boolean" && isObject(value.deck) && isText(value.deck.name) && isCount(value.deck.size) && STATES.includes(value.state);
}

/** @param {any} value */
function isRun(value) {
  return isObject(value) && isText(value.track) && isCount(value.stage) && (value.gameId === null || isText(value.gameId)) && isCount(value.attempts) && typeof value.rewarded === "boolean" && isLast(value.last) && isReward(value.reward);
}

/** @param {any} last the last challenge settled, or null */
function isLast(last) {
  return last === null || (isObject(last) && isText(last.gameId) && isCount(last.stage) && isText(last.opponent) && isText(last.result));
}

/** @param {any} reward the pack won, or null */
function isReward(reward) {
  return reward === null || (isObject(reward) && (reward.pack === null || isText(reward.pack)) && Array.isArray(reward.cards) && reward.cards.every(isRewardCard));
}

/** @param {any} value */
function isRewardCard(value) {
  return isObject(value) && isText(value.id) && isText(value.definitionId) && Number.isSafeInteger(value.serial) && value.serial > 0;
}

/** @param {any} value */
function opponentOf(value) {
  const lines = Object.fromEntries(LINE_KINDS.map((kind) => [kind, Object.freeze([...value.lines[kind]])]));
  return Object.freeze({ ...value, deck: Object.freeze({ ...value.deck }), lines: Object.freeze(lines), conditions: freezeAll(value.conditions) });
}

/** @param {any} value */
function runOf(value) {
  return Object.freeze({
    ...value,
    last: value.last === null ? null : Object.freeze({ ...value.last }),
    reward: value.reward === null ? null : Object.freeze({ pack: value.reward.pack, cards: freezeAll(value.reward.cards) }),
  });
}

function badResponse() {
  return fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response");
}
