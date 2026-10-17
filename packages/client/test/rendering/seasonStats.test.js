/**
 * The player's season in figures on Home's season card: place, rating, games, wins, losses and win rate, shown on a
 * wide card with room for them in place of the line on where the player stands.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SeasonCard } from "../../src/rendering/scenes/home/SeasonCard.js";
import { SeasonStats, seasonStats } from "../../src/rendering/scenes/home/SeasonStats.js";

const STANDING = Object.freeze({ season: { id: "s1", name: "Season 1" }, rating: 1612, deviation: 80, provisional: false, rank: 4, games: 12, wins: 8, losses: 4, draws: 0, eligible: true, casualGamesNeeded: 0, practiceGamesNeeded: 0 });

describe("SeasonStats", () => {
  it("gives the season's six figures, dashes where no game has been played", () => {
    assert.deepEqual(seasonStats(STANDING).map((stat) => [stat.label, stat.value]), [["Place", "#4"], ["Rating", "1612"], ["Games", "12"], ["Wins", "8"], ["Losses", "4"], ["Win rate", "67%"]]);
    const fresh = seasonStats({ ...STANDING, provisional: true, rank: null, games: 0, wins: 0, losses: 0, rating: 1500 });
    assert.deepEqual(fresh.map((stat) => stat.value), ["—", "1500", "0", "0", "0", "—"]);
    assert.equal(seasonStats({ ...STANDING, draws: 2 })[3].label, "Wins · 2 drawn");
  });

  it("takes the standing line's place on a wide card with room, and keeps the line on a phone's", () => {
    const view = { kind: "open", season: "Season 1", jackpot: null, now: () => 0, standing: "You: #4 · rating 1612", figures: STANDING };
    const wide = new SeasonCard({ id: "home.season", x: 0, y: 0, width: 500, height: 800, compact: false, view, canOpen: true, onOpen: () => undefined });
    assert.ok(wide.findById("home.season.stats") instanceof SeasonStats);
    assert.equal(wide.findById("home.season.standing"), null);
    const phone = new SeasonCard({ id: "home.season", x: 0, y: 0, width: 200, height: 300, compact: true, view, canOpen: true, onOpen: () => undefined });
    assert.equal(phone.findById("home.season.stats"), null);
    assert.equal(phone.findById("home.season.standing").text, "You: #4 · rating 1612");
  });
});
