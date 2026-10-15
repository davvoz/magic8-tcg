/**
 * The challenges screen's services for the preview harness: a day made from
 * the real roster (data/daily/characters.json) by a scripted server that
 * answers only the reads, and the bundled starter decks to fight with.
 * Development only.
 *
 *   /tools/preview/?scene=daily                          Kael, Morwen and the Gravelord, the track not chosen yet
 *   ...&opponents=sira,elda,worldroot                    any two characters and a boss, by id
 *   ...&stage=1                                          on the hard track, that many beaten
 */
import { ok } from "@magic8/engine/shared/Result.js";
import { DailyService } from "../../src/application/daily/DailyService.js";

const DEFAULT_OPPONENTS = Object.freeze(["kael", "morwen", "gravelord"]);
const HOUR = 3_600_000;
const TRACKS = Object.freeze([
  Object.freeze({ id: "normal", name: "Normal", reward: "core_mini_booster" }),
  Object.freeze({ id: "hard", name: "Hard", reward: "core_booster" }),
]);

/**
 * @param {import("../../src/application/content/ContentService.js").GameContent} content
 * @param {{ opponents: string | null, stage: number | null }} request
 */
export async function dailyServices(content, { opponents, stage }) {
  const roster = await (await fetch("/data/daily/characters.json")).json();
  const ids = opponents === null ? DEFAULT_OPPONENTS : opponents.split(",");
  const people = [...roster.characters.map((character) => ({ ...character, boss: false })), ...roster.bosses.map((boss) => ({ ...boss, boss: true }))];
  const day = Object.freeze({
    day: new Date().toISOString().slice(0, 10),
    endsAt: Date.now() + 5 * HOUR,
    tracks: TRACKS,
    opponents: ids.map((id, index) => viewOf(people.find((person) => person.id === id) ?? people[index], stateAt(index, stage))),
    run: stage === null ? null : { track: "hard", stage, gameId: null, attempts: stage, rewarded: false, last: null, reward: null },
  });
  const api = { today: async () => ok(day), chooseTrack: async () => ok(day), play: async () => ok({ gameId: "preview" }) };
  const decks = content.preconDecks.map((deck) => ({ id: deck.id, name: deck.name, playable: true }));
  const online = {
    state: { status: "idle", session: null, mode: null },
    subscribe: () => () => undefined,
    decks: () => decks,
    resume: () => null,
  };
  return { daily: new DailyService({ api }), online };
}

/**
 * @param {number} index
 * @param {number | null} stage
 */
function stateAt(index, stage) {
  const reached = stage ?? 0;
  if (index < reached) {
    return "beaten";
  }
  return index === reached ? "next" : "locked";
}

/** A roster entry as the server shows it to the player. */
function viewOf(person, state) {
  return {
    id: person.id,
    account: `ai_${person.id}`,
    name: person.name,
    title: person.title,
    faction: person.faction,
    style: person.style,
    boss: person.boss,
    deck: { name: person.name, size: 30 },
    lines: { intro: [], low: [], win: [], lose: [], unlock: [], ...person.lines },
    conditions: (person.conditions ?? []).map(({ name, text, scope }) => ({ name, text, scope })),
    state,
  };
}
