/**
 * Glicko-2 against the worked example of Glickman's paper.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_RATING, rateGame, updateRating } from "../../src/modules/ranking/domain/Glicko2.js";

const close = (actual, expected, digits, what) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${what}: ${actual} ≠ ${expected}`);

describe("Glicko-2", () => {
  it("reproduces Glickman's example", () => {
    const player = { rating: 1500, rd: 200, volatility: 0.06 };
    const updated = updateRating(player, [
      { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
      { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
      { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
    ]);
    close(updated.rating, 1464.06, 2, "rating");
    close(updated.rd, 151.52, 2, "deviation");
    close(updated.volatility, 0.05999, 5, "volatility");
  });

  it("moves new players fast and settled players slowly, symmetrically", () => {
    const [winner, loser] = rateGame(DEFAULT_RATING, DEFAULT_RATING, 1);
    assert.ok(winner.rating > 1600 && loser.rating < 1400, `${winner.rating} / ${loser.rating}`);
    close(winner.rating - 1500, 1500 - loser.rating, 6, "zero-sum between equals");
    assert.ok(winner.rd < 350);
    const settled = { rating: 1500, rd: 50, volatility: 0.06 };
    const [after] = rateGame(settled, settled, 1);
    assert.ok(after.rating - 1500 < 15, "a settled rating barely moves");
    const [upset] = rateGame({ rating: 1300, rd: 60, volatility: 0.06 }, { rating: 1700, rd: 60, volatility: 0.06 }, 1);
    assert.ok(upset.rating - 1300 > 2 * (after.rating - 1500), "beating a much stronger player is worth more");
    const [draw] = rateGame(settled, settled, 0.5);
    close(draw.rating, 1500, 6, "a draw between equals changes nothing");
    assert.ok(updateRating(settled, []).rd > 50, "inactivity makes a rating less certain");
  });
});
