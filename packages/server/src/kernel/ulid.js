/**
 * ULIDs in lowercase Crockford base32 (26 characters): 48 bits of
 * milliseconds then 80 random bits. Game ids use them (the protocol's
 * GAME_ID_PATTERN): sortable by creation time, unguessable.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const TIME_CHARS = 10;
const RANDOM_BYTES = 10;

/**
 * @param {import("./time.js").Clock} clock
 * @param {import("./random.js").SecureRandom} random
 * @returns {string}
 */
export function ulid(clock, random) {
  let time = clock.now();
  if (!Number.isSafeInteger(time) || time < 0 || time >= 2 ** 48) {
    throw new RangeError("ulid: time out of range");
  }
  let prefix = "";
  for (let index = 0; index < TIME_CHARS; index += 1) {
    prefix = ALPHABET[time % 32] + prefix;
    time = Math.floor(time / 32);
  }
  let suffix = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of random.bytes(RANDOM_BYTES)) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      suffix += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  return prefix + suffix;
}
