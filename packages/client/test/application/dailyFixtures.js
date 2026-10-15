/** A day of daily challenges as the server sends it, for the client's tests. */

const lines = (name) => ({ intro: [`${name} says hello`], low: [`${name} is hurt`], win: [`${name} wins`], lose: [`${name} loses`], unlock: [] });
const opponent = (id, fields = {}) => ({ id, account: `ai_${id}`, name: id[0].toUpperCase() + id.slice(1), title: "A title", faction: "ember", style: "aggressive", boss: false, deck: { name: "Ember Vanguard", size: 30 }, lines: lines(id), conditions: [], state: "locked", ...fields });

/** A day as the server sends it. */
export const DAY = Object.freeze({
  day: "2026-10-15",
  endsAt: Date.UTC(2026, 9, 16),
  tracks: [
    { id: "normal", name: "Normal", reward: "core_mini_booster" },
    { id: "hard", name: "Hard", reward: "core_booster" },
  ],
  opponents: [opponent("kael", { state: "next" }), opponent("sira"), opponent("wyrm", { boss: true, lines: { ...lines("wyrm"), unlock: ["The mountain wakes"] }, conditions: [{ name: "Scorched Earth", text: "Everyone burns.", scope: "everyone" }] })],
  run: null,
});
