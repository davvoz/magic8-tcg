/**
 * JackpotApi over the game server's HTTP API, with the response checked for
 * the shape the application relies on.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const STATUSES = new Set(["upcoming", "running", "settling", "settled"]);
const PAID = new Set(["PENDING", "SENT", "CONFIRMED"]);
const AMOUNT = /^\d{1,15}\.\d{1,8}$/;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isTime = (value) => Number.isSafeInteger(value) && value >= 0;
const isAccount = (value) => typeof value === "string" && /^[a-z0-9.-]{1,32}$/.test(value);
const isAmountOrNull = (value) => value === null || (typeof value === "string" && AMOUNT.test(value));
const isPositive = (value) => Number.isSafeInteger(value) && value > 0;

/** @param {any} value */
function season(value) {
  const valid = isObject(value) && typeof value.id === "string" && typeof value.name === "string" && isTime(value.startsAt) && isTime(value.endsAt) && STATUSES.has(value.status);
  return valid ? Object.freeze({ id: value.id, name: value.name, startsAt: value.startsAt, endsAt: value.endsAt, status: value.status }) : null;
}

/** @param {any} value */
function place(value) {
  const valid =
    isPositive(value?.place) &&
    isPositive(value.percent) &&
    isAmountOrNull(value.amount) &&
    (value.account === null || isAccount(value.account)) &&
    (value.rating === null || Number.isSafeInteger(value.rating)) &&
    (value.paid === null || PAID.has(value.paid));
  return valid ? Object.freeze({ place: value.place, percent: value.percent, amount: value.amount, account: value.account, rating: value.rating, paid: value.paid }) : null;
}

/**
 * The bank, its share and the amounts.
 * @param {any} body
 */
const hasAmounts = (body) =>
  isAccount(body.bank) && typeof body.asset === "string" && isPositive(body.share?.numerator) && isPositive(body.share?.denominator) && isAmountOrNull(body.jackpot) && isAmountOrNull(body.opening) && (body.readAt === null || isTime(body.readAt));

/**
 * @param {any} body
 * @returns {import("../../application/ports/JackpotApi.contract.js").Jackpot | null | undefined} undefined when malformed
 */
function jackpot(body) {
  if (body?.season === null) {
    return null;
  }
  const parsedSeason = season(body?.season);
  const places = Array.isArray(body?.places) ? body.places.map(place) : null;
  if (parsedSeason === null || places === null || places.includes(null) || !hasAmounts(body)) {
    return undefined;
  }
  return Object.freeze({
    season: parsedSeason,
    bank: body.bank,
    asset: body.asset,
    share: Object.freeze({ numerator: body.share.numerator, denominator: body.share.denominator }),
    jackpot: body.jackpot,
    opening: body.opening,
    readAt: body.readAt,
    places: Object.freeze(places),
  });
}

export class HttpJackpotApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  async current() {
    const response = await this.#transport.request("GET", "/api/jackpot");
    if (!response.ok) {
      return response;
    }
    const parsed = jackpot(response.value);
    return parsed === undefined ? fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response") : ok(parsed);
  }
}
