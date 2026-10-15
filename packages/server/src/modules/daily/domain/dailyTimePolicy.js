/**
 * How long a daily challenge waits on its player (gameplay's TimePolicy, for
 * the daily mode): nobody else is waiting, so a turn may take ten minutes
 * and there is no reserve. A player who leaves forfeits after fifteen
 * minutes away, which also ends a game left open: the next try starts anew.
 */
const MINUTE = 60_000;

export const DAILY_TIME_POLICY = Object.freeze({
  turnMs: 10 * MINUTE,
  blockMs: 10 * MINUTE,
  reserveMs: 0,
  disconnectGraceMs: 15 * MINUTE,
  abandonMs: 15 * MINUTE,
});
