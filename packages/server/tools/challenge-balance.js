/**
 * Balance check for the daily challenges (docs/tcg/24-sfide.md): a stand-in
 * challenger plays every opponent of the roster with every free starter
 * deck, the way the server sets the game up (the opponent's deck, its style,
 * the track's level for its stage, a boss's conditions), each seat going
 * first in turn. It prints the challenger's win rate against each opponent,
 * and for each track what a day costs: the chance to win each challenge and
 * how many games, on average, it takes to win all three.
 *
 * The challenger is an AI standing in for a player: basic (BasicAi, a
 * beginner who plays the most expensive card) or search:<level> (a player
 * who thinks ahead, stronger with the level).
 *
 *   node packages/server/tools/challenge-balance.js [--games=4] [--challenger=basic] [--track=normal,hard] [--opponents=kael,gravelord] [--decks=precon_ember] [--levels=2,3,4] [--roster=file.json]
 *
 * --games is per opponent, per starter deck and per first seat; --levels
 * tries other levels than the track's (one per stage), --roster another
 * roster file (other decks or conditions), before changing the data.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BasicAi, AiStyle } from "@magic8/engine/domain/ai/BasicAi.js";
import { SearchAi } from "@magic8/engine/domain/ai/search/SearchAi.js";
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { buildGameContent } from "@magic8/engine/domain/content/GameContent.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { SEATS, createGameEngine } from "@magic8/protocol";
import { readServerContent } from "../src/contentFiles.js";
import { conditionsAt, validateDailyRoster, validateDailyTracks } from "../src/modules/daily/index.js";
import { forcedCommandFor } from "../src/modules/gameplay/domain/forcedCommand.js";

const DATA = resolve(fileURLToPath(new URL("../../../data", import.meta.url)));
const [CHALLENGER_SEAT, OPPONENT_SEAT] = SEATS;
/** A game longer than this many moves is a bug, not a long game. */
const MAX_MOVES = 3000;
const percent = (share) => `${(share * 100).toFixed(0)}%`.padStart(5);

const options = parseOptions(process.argv.slice(2));
const effects = createCoreEffectRegistry();
const files = await readServerContent(DATA);
const content = unwrap(buildGameContent(files.raw, effects), "content");
const rawRoster = options.roster === null ? files.daily.roster : JSON.parse(readFileSync(options.roster, "utf8"));
const roster = unwrap(validateDailyRoster(rawRoster, content), "roster");
const tracks = unwrap(validateDailyTracks(files.daily.tracks, { hasDropTable: () => true }), "tracks");
const starters = /** @type {{ choices: string[] }} */ (files.starterOffer).choices
  .filter((id) => options.decks === null || options.decks.includes(id))
  .map((id) => /** @type {import("@magic8/engine/domain/decks/DeckList.js").DeckList} */ (content.preconDecks.find((deck) => deck.id === id)));
const opponents = [...roster.characters, ...roster.bosses].filter((opponent) => options.opponents === null || options.opponents.includes(opponent.id));

console.log(`challenger ${options.challenger}, starters ${starters.map((deck) => deck.id.replace("precon_", "")).join(" ")}, ${options.games} games per opponent, deck and first seat\n`);
for (const trackId of options.tracks) {
  const known = tracks.get(trackId);
  if (known === undefined) {
    throw new Error(`unknown track ${trackId}`);
  }
  const track = options.levels === null ? known : { ...known, levels: options.levels };
  console.log(`${track.name} (levels ${track.levels.join(", ")})`);
  const results = opponents.map((opponent) => measure(opponent, track));
  for (const result of results) {
    const decks = result.byDeck.map(({ deck, share }) => `${deck.replace("precon_", "").slice(0, 7)} ${percent(share).trim()}`).join("  ");
    console.log(`  ${result.opponent.name.padEnd(20)} lv ${result.levels.padEnd(5)} won ${percent(result.share)}  ${result.turns.toFixed(1).padStart(4)} turns  ${(result.ms / 1000).toFixed(1).padStart(5)}s   ${decks}`);
  }
  summarize(results);
  console.log("");
}

/**
 * The challenger's record against one opponent on a track: characters play
 * at the levels of both character stages in turn, a boss at the last stage's.
 * @param {import("../src/modules/daily/domain/DailyRoster.js").Opponent} opponent
 * @param {import("../src/modules/daily/domain/DailyTracks.js").Track} track
 */
function measure(opponent, track) {
  const levels = opponent.boss ? [track.levels[2]] : [track.levels[0], track.levels[1]];
  const started = Date.now();
  let turns = 0;
  const byDeck = starters.map((deck) => {
    let wins = 0;
    let games = 0;
    for (let game = 0; game < options.games; game += 1) {
      for (const firstSeat of SEATS) {
        const level = levels[(game + games) % levels.length];
        const played = playGame({ opponent, deck, level, firstSeat, salt: `${track.id}|${deck.id}|${game}|${firstSeat}` });
        wins += played.winner === CHALLENGER_SEAT ? 1 : 0;
        turns += played.turns;
        games += 1;
      }
    }
    return { deck: deck.id, share: wins / games };
  });
  const share = byDeck.reduce((sum, { share: deckShare }) => sum + deckShare, 0) / byDeck.length;
  return { opponent, share, byDeck, levels: levels.join("/"), turns: turns / (byDeck.length * options.games * SEATS.length), ms: Date.now() - started };
}

/**
 * One game, set up as the server sets up a challenge.
 * @param {{ opponent: import("../src/modules/daily/domain/DailyRoster.js").Opponent, deck: import("@magic8/engine/domain/decks/DeckList.js").DeckList, level: number, firstSeat: string, salt: string }} game
 * @returns {{ winner: string | null, turns: number }}
 */
function playGame({ opponent, deck, level, firstSeat, salt }) {
  const engine = unwrap(createGameEngine({
    content: { rules: content.gameRules, catalog: content.catalog, effects, createCommands: createCoreCommandRegistry },
    accounts: ["challenger", `ai_${opponent.id}`],
    decks: [deck.entries, opponent.deck.entries],
    firstSeat,
    engineSeed: createHash("sha256").update(`${opponent.id}|${salt}|${level}`).digest("hex"),
    conditions: conditionsAt(opponent, { challenger: CHALLENGER_SEAT, opponent: OPPONENT_SEAT }),
  }), "game");
  unwrap(engine.start(), "start");
  const ais = new Map([
    [CHALLENGER_SEAT, challengerAi(salt)],
    [OPPONENT_SEAT, new SearchAi({ rules: content.gameRules, catalog: content.catalog, effects, level, style: opponent.style, salt })],
  ]);
  for (let moves = 0; !engine.isOver; moves += 1) {
    if (moves > MAX_MOVES) {
      throw new Error(`game against ${opponent.id} did not end (${salt})`);
    }
    const seat = /** @type {string} */ (engine.awaitingPlayerId);
    const view = engine.getSnapshot(seat);
    const chosen = /** @type {any} */ (ais.get(seat)).decide(view);
    const applied = chosen === null ? null : engine.execute(chosen);
    if (applied === null || !applied.ok) {
      unwrap(engine.execute({ ...forcedCommandFor(/** @type {any} */ (view)), playerId: seat }), "forced move");
    }
  }
  const final = engine.getSnapshot(null);
  return { winner: final.winnerId, turns: final.turnNumber };
}

/** @param {string} salt */
function challengerAi(salt) {
  const [kind, level] = options.challenger.split(":");
  return kind === "basic" ? new BasicAi(AiStyle.BALANCED) : new SearchAi({ rules: content.gameRules, catalog: content.catalog, effects, level: Number(level), salt: `challenger|${salt}` });
}

/**
 * What a day on the track costs the challenger: two characters (the
 * average one) then a boss (the average one), retried until won.
 * @param {ReturnType<typeof measure>[]} results
 */
function summarize(results) {
  const average = (list) => (list.length === 0 ? null : list.reduce((sum, result) => sum + result.share, 0) / list.length);
  const character = average(results.filter((result) => !result.opponent.boss));
  const boss = average(results.filter((result) => result.opponent.boss));
  if (character === null || boss === null) {
    return;
  }
  const games = 2 / Math.max(character, 0.01) + 1 / Math.max(boss, 0.01);
  const firstTry = character * character * boss;
  console.log(`  → a character ${percent(character).trim()}, a boss ${percent(boss).trim()}: the day takes ${games.toFixed(1)} games on average, won without a loss ${percent(firstTry).trim()} of the time`);
}

/**
 * @template T
 * @param {{ ok: true, value: T } | { ok: false, error: { message: string } }} result
 * @param {string} what
 * @returns {T}
 */
function unwrap(result, what) {
  if (!result.ok) {
    throw new Error(`${what}: ${result.error.message}`);
  }
  return result.value;
}

/** @param {string[]} args */
function parseOptions(args) {
  const value = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  const list = (name) => value(name)?.split(",").map((item) => item.trim()) ?? null;
  return {
    games: Number(value("games") ?? 4),
    challenger: value("challenger") ?? "basic",
    tracks: list("track") ?? ["normal", "hard"],
    opponents: list("opponents"),
    decks: list("decks"),
    levels: list("levels")?.map(Number) ?? null,
    roster: value("roster"),
  };
}
