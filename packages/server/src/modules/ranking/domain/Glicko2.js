/**
 * Glicko-2 (Glickman, "Example of the Glicko-2 system", 2012): a rating, its
 * deviation (how uncertain it is) and a volatility (how erratic the player
 * is). Ranked games update both players at once from their ratings before
 * the game; each game is one rating period. New players start uncertain
 * (RD 350) and move fast; the deviation shrinks as they play.
 */
const SCALE = 173.7178;
const BASE = 1500;
const CONVERGENCE = 0.000001;
const MAX_ITERATIONS = 100;

export const DEFAULT_RATING = Object.freeze({ rating: BASE, rd: 350, volatility: 0.06 });
/** System constant: how much volatility may change (0.3–1.2; smaller = steadier). */
export const DEFAULT_TAU = 0.5;
/** Above this deviation a rating is provisional (not ranked on the leaderboard yet). */
export const PROVISIONAL_RD = 110;

/**
 * @typedef {Readonly<{ rating: number, rd: number, volatility: number }>} Rating
 * @typedef {Readonly<{ opponent: Rating, score: 0 | 0.5 | 1 }>} Result
 */

/** @param {number} phi */
const g = (phi) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

/**
 * @param {number} mu
 * @param {number} muJ
 * @param {number} phiJ
 */
const expected = (mu, muJ, phiJ) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * The new volatility (step 5, Illinois algorithm).
 * @param {{ phi: number, sigma: number, v: number, delta: number, tau: number }} input
 */
function newVolatility({ phi, sigma, v, delta, tau }) {
  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    const denominator = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * denominator * denominator) - (x - a) / (tau * tau);
  };
  let upper = a;
  let lower;
  if (delta * delta > phi * phi + v) {
    lower = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k += 1;
    }
    lower = a - k * tau;
  }
  let fUpper = f(upper);
  let fLower = f(lower);
  for (let iteration = 0; iteration < MAX_ITERATIONS && Math.abs(lower - upper) > CONVERGENCE; iteration += 1) {
    const candidate = upper + ((upper - lower) * fUpper) / (fLower - fUpper);
    const fCandidate = f(candidate);
    if (fCandidate * fLower <= 0) {
      upper = lower;
      fUpper = fLower;
    } else {
      fUpper /= 2;
    }
    lower = candidate;
    fLower = fCandidate;
  }
  return Math.exp(upper / 2);
}

/**
 * A player's rating after one rating period with these results.
 * @param {Rating} player
 * @param {readonly Result[]} results
 * @param {number} [tau]
 * @returns {Rating}
 */
export function updateRating(player, results, tau = DEFAULT_TAU) {
  const mu = (player.rating - BASE) / SCALE;
  const phi = player.rd / SCALE;
  if (results.length === 0) {
    return Object.freeze({ ...player, rd: Math.min(DEFAULT_RATING.rd, Math.sqrt(phi * phi + player.volatility * player.volatility) * SCALE) });
  }
  let inverseV = 0;
  let sum = 0;
  for (const { opponent, score } of results) {
    const muJ = (opponent.rating - BASE) / SCALE;
    const phiJ = opponent.rd / SCALE;
    const e = expected(mu, muJ, phiJ);
    inverseV += g(phiJ) * g(phiJ) * e * (1 - e);
    sum += g(phiJ) * (score - e);
  }
  const v = 1 / inverseV;
  const sigma = newVolatility({ phi, sigma: player.volatility, v, delta: v * sum, tau });
  const phiStar = Math.sqrt(phi * phi + sigma * sigma);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * sum;
  return Object.freeze({ rating: muNew * SCALE + BASE, rd: phiNew * SCALE, volatility: sigma });
}

/**
 * Both players of a game, updated from their ratings before it.
 * @param {Rating} first
 * @param {Rating} second
 * @param {0 | 0.5 | 1} firstScore 1 when the first player won
 */
export function rateGame(first, second, firstScore) {
  return Object.freeze([updateRating(first, [{ opponent: second, score: firstScore }]), updateRating(second, [{ opponent: first, score: /** @type {0 | 0.5 | 1} */ (1 - firstScore) }])]);
}
