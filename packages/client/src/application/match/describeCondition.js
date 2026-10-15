/**
 * A game's match conditions (the engine's MatchCondition, as snapshots carry
 * them) in words, for the player who sees them: "Your spells cost 1 more",
 * "Everyone draws 1 more card each turn". Written from the rule alone, so a
 * new condition reads right wherever it comes from.
 */

/**
 * @typedef {Readonly<{ kind: string, players: readonly string[], [field: string]: unknown }>} PlainCondition
 * @typedef {Readonly<{ viewerId: string | null, nameOf: (playerId: string) => string }>} Readers who reads (null: a spectator) and how the others are named
 */

const KEYWORD_NAMES = Object.freeze({ haste: "Haste", trample: "Trample", vigilance: "Vigilance" });
/** The cards a filter's type names. */
const TYPE_NOUNS = Object.freeze({ creature: "creatures", spell: "spells" });

/**
 * How each kind of condition reads, given who it holds for.
 * @type {Readonly<Record<string, (condition: PlainCondition, who: Who) => string>>}
 */
const DESCRIBERS = Object.freeze({
  cost: (condition, who) => {
    const amount = Number(condition.amount ?? 0);
    return `${who.possessive} ${cardsOf(filterOf(condition))} cost ${Math.abs(amount)} ${amount >= 0 ? "more" : "less"}`;
  },
  enter_stats: (condition, who) => `${who.possessive} ${withFilter("creatures", filterOf(condition))} enter the battlefield with ${signed(Number(condition.attack))}/${signed(Number(condition.health))}`,
  keyword: (condition, who) => `${who.possessive} ${withFilter("creatures", filterOf(condition))} enter the battlefield with ${keywordName(String(condition.keyword))}`,
  turn_start: (condition, who) => `At the start of ${who.possessive.toLowerCase()} turn, ${turnStartEffect(String(condition.effect), Number(condition.amount ?? 0), who)}`,
  extra_draw: (condition, who) => `${who.subject} ${who.verb("draw")} ${countOf(Number(condition.amount ?? 0), "more card")} each turn`,
  starting_hand: (condition, who) => `${who.subject} ${who.verb("start")} with ${countOf(Number(condition.amount ?? 0), "more card")} in hand`,
  starting_life: (condition, who) => {
    const amount = Number(condition.amount ?? 0);
    const change = amount >= 0 ? `${amount} more` : `${-amount} less`;
    return `${who.subject} ${who.verb("start")} with ${change} life`;
  },
});

/**
 * @typedef {{ subject: string, possessive: string, verb: (verb: string) => string, object: string }} Who
 */

/**
 * @param {PlainCondition} condition
 * @param {Readers} readers
 * @returns {string}
 */
export function describeCondition(condition, readers) {
  const describe = DESCRIBERS[condition.kind];
  return describe === undefined ? "A special rule holds in this game" : describe(condition, whoOf(condition.players, readers));
}

/** @param {PlainCondition} condition */
function filterOf(condition) {
  return /** @type {Readonly<{ type?: string, faction?: string, keyword?: string }>} */ (condition.filter ?? {});
}

/** @param {string} keyword */
function keywordName(keyword) {
  return KEYWORD_NAMES[/** @type {keyof typeof KEYWORD_NAMES} */ (keyword)] ?? keyword;
}

/**
 * @param {readonly string[]} players
 * @param {Readers} readers
 * @returns {Who}
 */
function whoOf(players, { viewerId, nameOf }) {
  if (players.length > 1) {
    return { subject: "Everyone", possessive: "Everyone's", verb: (verb) => `${verb}s`, object: "they" };
  }
  const [only] = players;
  if (only === viewerId) {
    return { subject: "You", possessive: "Your", verb: (verb) => verb, object: "you" };
  }
  const name = nameOf(only);
  return { subject: name, possessive: `${name}'s`, verb: (verb) => `${verb}s`, object: name };
}

/**
 * @param {string} effect
 * @param {number} amount
 * @param {Who} who
 */
function turnStartEffect(effect, amount, who) {
  const player = who.subject === "Everyone" ? "that player" : who.object;
  const verb = (word) => (player === "you" ? word : `${word}s`);
  if (effect === "draw") {
    return `${player} ${verb("draw")} ${countOf(amount, "card")}`;
  }
  return `${player} ${effect === "lose_life" ? verb("lose") : verb("gain")} ${amount} life`;
}

/** @param {Readonly<{ type?: string, faction?: string, keyword?: string }>} filter */
function cardsOf(filter) {
  return withFilter(TYPE_NOUNS[/** @type {keyof typeof TYPE_NOUNS} */ (filter.type)] ?? "cards", filter);
}

/**
 * @param {string} noun
 * @param {Readonly<{ faction?: string, keyword?: string }>} filter
 */
function withFilter(noun, { faction, keyword }) {
  const factionText = faction === undefined ? "" : `${faction[0].toUpperCase()}${faction.slice(1)} `;
  const keywordText = keyword === undefined ? "" : ` with ${keywordName(keyword)}`;
  return `${factionText}${noun}${keywordText}`;
}

/** @param {number} value */
function signed(value) {
  return value < 0 ? `${value}` : `+${value}`;
}

/**
 * @param {number} count
 * @param {string} noun singular
 */
function countOf(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
