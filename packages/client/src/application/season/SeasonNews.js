/**
 * What a season brings, as the players are shown it once after signing in
 * (data/ui/season-news.json): its name, and pages of a few kinds, each
 * drawn its own way (SeasonNewsShow). A new season is a new file with a new
 * `id`, and every player sees it once more.
 *
 * - intro: the season's name over a short text, a fan of up to three cards
 * - features: up to three new ways to play, each with a card that shows it
 * - cards: the new cards, revealed one by one
 * - cycle: factions that each beat the next, the last beating the first, each with its card
 * - changes: cards whose cost or rarity changed, each tagged nerf, buff or change
 *
 * The file is fetched, so it is untrusted: anything malformed, or naming a
 * card or faction the game does not know, rejects the whole of it, and the
 * season simply goes unannounced.
 */

export const SEASON_NEWS_SCHEMA_VERSION = 1;

export const NewsPageKind = Object.freeze({ INTRO: "intro", FEATURES: "features", CARDS: "cards", CYCLE: "cycle", CHANGES: "changes" });
export const ChangeTag = Object.freeze({ NERF: "nerf", BUFF: "buff", CHANGE: "change" });

const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const LIMITS = Object.freeze({
  eyebrow: 32,
  name: 40,
  title: 48,
  featureName: 32,
  text: 320,
  pages: 8,
  introCards: 3,
  features: 3,
  cards: 16,
  cycle: Object.freeze({ min: 3, max: 6 }),
  changes: 3,
  cost: 20,
});

/**
 * @typedef {Readonly<{ cost?: number, rarity?: string }>} CardFacts
 * @typedef {Readonly<{ kind: "intro", text: string, cardIds: readonly string[] }>} IntroPage
 * @typedef {Readonly<{ kind: "features", title: string, items: readonly Readonly<{ name: string, text: string, cardId: string }>[] }>} FeaturesPage
 * @typedef {Readonly<{ kind: "cards", title: string, text: string, cardIds: readonly string[] }>} CardsPage
 * @typedef {Readonly<{ kind: "cycle", title: string, text: string, steps: readonly Readonly<{ faction: string, cardId: string }>[] }>} CyclePage
 * @typedef {Readonly<{ kind: "changes", title: string, items: readonly Readonly<{ cardId: string, tag: string, text: string, before: CardFacts, after: CardFacts }>[] }>} ChangesPage
 * @typedef {IntroPage | FeaturesPage | CardsPage | CyclePage | ChangesPage} NewsPage
 * @typedef {Readonly<{ id: string, eyebrow: string, name: string, accent: string, pages: readonly NewsPage[] }>} SeasonNews
 * @typedef {{ ok: true, value: SeasonNews } | { ok: false, message: string }} SeasonNewsResult
 */

class Invalid extends Error {}

/**
 * @param {unknown} raw the parsed file
 * @param {{ catalog: { has: (cardId: string) => boolean }, factions: readonly string[], rarities: readonly string[] }} known
 *   what the game knows: cards, factions, and rarities (none known: any rarity name is refused)
 * @returns {SeasonNewsResult}
 */
export function buildSeasonNews(raw, known) {
  try {
    const file = object(raw, "the file");
    if (file.schemaVersion !== SEASON_NEWS_SCHEMA_VERSION) {
      throw new Invalid(`schemaVersion must be ${SEASON_NEWS_SCHEMA_VERSION}`);
    }
    const pages = list(file.pages, "pages", { min: 1, max: LIMITS.pages }).map((page, index) => pageOf(page, `pages[${index}]`, known));
    return {
      ok: true,
      value: Object.freeze({
        id: pattern(file.id, "id", ID),
        eyebrow: text(file.eyebrow, "eyebrow", LIMITS.eyebrow),
        name: text(file.name, "name", LIMITS.name),
        accent: oneOf(file.accent, "accent", known.factions),
        pages: Object.freeze(pages),
      }),
    };
  } catch (error) {
    if (error instanceof Invalid) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

/** @type {Readonly<Record<string, (page: Record<string, unknown>, path: string, known: any) => NewsPage>>} */
const PAGE_READERS = Object.freeze({
  [NewsPageKind.INTRO]: (page, path, known) => ({
    kind: NewsPageKind.INTRO,
    text: text(page.text, `${path}.text`, LIMITS.text),
    cardIds: cardIds(page.cardIds, `${path}.cardIds`, known, { min: 0, max: LIMITS.introCards }),
  }),
  [NewsPageKind.FEATURES]: (page, path, known) => ({
    kind: NewsPageKind.FEATURES,
    title: text(page.title, `${path}.title`, LIMITS.title),
    items: list(page.items, `${path}.items`, { min: 1, max: LIMITS.features }).map((raw, index) => {
      const item = object(raw, `${path}.items[${index}]`);
      const at = `${path}.items[${index}]`;
      return Object.freeze({ name: text(item.name, `${at}.name`, LIMITS.featureName), text: text(item.text, `${at}.text`, LIMITS.text), cardId: cardId(item.cardId, `${at}.cardId`, known) });
    }),
  }),
  [NewsPageKind.CARDS]: (page, path, known) => ({
    kind: NewsPageKind.CARDS,
    title: text(page.title, `${path}.title`, LIMITS.title),
    text: page.text === undefined ? "" : text(page.text, `${path}.text`, LIMITS.text),
    cardIds: cardIds(page.cardIds, `${path}.cardIds`, known, { min: 1, max: LIMITS.cards }),
  }),
  [NewsPageKind.CYCLE]: (page, path, known) => ({
    kind: NewsPageKind.CYCLE,
    title: text(page.title, `${path}.title`, LIMITS.title),
    text: text(page.text, `${path}.text`, LIMITS.text),
    steps: list(page.steps, `${path}.steps`, LIMITS.cycle).map((raw, index) => {
      const step = object(raw, `${path}.steps[${index}]`);
      const at = `${path}.steps[${index}]`;
      return Object.freeze({ faction: oneOf(step.faction, `${at}.faction`, known.factions), cardId: cardId(step.cardId, `${at}.cardId`, known) });
    }),
  }),
  [NewsPageKind.CHANGES]: (page, path, known) => ({
    kind: NewsPageKind.CHANGES,
    title: text(page.title, `${path}.title`, LIMITS.title),
    items: list(page.items, `${path}.items`, { min: 1, max: LIMITS.changes }).map((raw, index) => {
      const item = object(raw, `${path}.items[${index}]`);
      const at = `${path}.items[${index}]`;
      return Object.freeze({
        cardId: cardId(item.cardId, `${at}.cardId`, known),
        tag: oneOf(item.tag, `${at}.tag`, Object.values(ChangeTag)),
        text: item.text === undefined ? "" : text(item.text, `${at}.text`, LIMITS.text),
        before: facts(item.before, `${at}.before`, known),
        after: facts(item.after, `${at}.after`, known),
      });
    }),
  }),
});

/**
 * @param {unknown} raw
 * @param {string} path
 * @param {any} known
 * @returns {NewsPage}
 */
function pageOf(raw, path, known) {
  const page = object(raw, path);
  const read = PAGE_READERS[/** @type {string} */ (page.kind)];
  if (read === undefined) {
    throw new Invalid(`${path}.kind must be one of ${Object.values(NewsPageKind).join(", ")}`);
  }
  return Object.freeze(read(page, path, known));
}

/**
 * @param {unknown} raw
 * @param {string} path
 * @param {any} known
 * @returns {CardFacts}
 */
function facts(raw, path, known) {
  const fields = object(raw, path);
  /** @type {{ cost?: number, rarity?: string }} */
  const result = {};
  if (fields.cost !== undefined) {
    if (!Number.isInteger(fields.cost) || /** @type {number} */ (fields.cost) < 0 || /** @type {number} */ (fields.cost) > LIMITS.cost) {
      throw new Invalid(`${path}.cost must be a whole number from 0 to ${LIMITS.cost}`);
    }
    result.cost = /** @type {number} */ (fields.cost);
  }
  if (fields.rarity !== undefined) {
    result.rarity = oneOf(fields.rarity, `${path}.rarity`, known.rarities);
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} raw
 * @param {string} path
 * @param {any} known
 * @param {{ min: number, max: number }} size
 */
function cardIds(raw, path, known, size) {
  return Object.freeze(list(raw, path, size).map((id, index) => cardId(id, `${path}[${index}]`, known)));
}

/**
 * @param {unknown} raw
 * @param {string} path
 * @param {any} known
 */
function cardId(raw, path, known) {
  if (typeof raw !== "string" || !known.catalog.has(raw)) {
    throw new Invalid(`${path} must name a card of the game`);
  }
  return raw;
}

/**
 * @param {unknown} raw
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function object(raw, path) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Invalid(`${path} must be an object`);
  }
  return /** @type {Record<string, unknown>} */ (raw);
}

/**
 * @param {unknown} raw
 * @param {string} path
 * @param {{ min: number, max: number }} size
 * @returns {readonly unknown[]}
 */
function list(raw, path, { min, max }) {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) {
    throw new Invalid(`${path} must be a list of ${min} to ${max}`);
  }
  return raw;
}

/**
 * @param {unknown} raw
 * @param {string} path
 * @param {number} maxLength
 */
function text(raw, path, maxLength) {
  if (typeof raw !== "string" || raw.trim().length === 0 || raw.length > maxLength) {
    throw new Invalid(`${path} must be text of 1 to ${maxLength} characters`);
  }
  return raw;
}

/**
 * @param {unknown} raw
 * @param {string} path
 * @param {RegExp} shape
 */
function pattern(raw, path, shape) {
  if (typeof raw !== "string" || !shape.test(raw)) {
    throw new Invalid(`${path} is malformed`);
  }
  return raw;
}

/**
 * @param {unknown} raw
 * @param {string} path
 * @param {readonly string[]} allowed
 */
function oneOf(raw, path, allowed) {
  if (typeof raw !== "string" || !allowed.includes(raw)) {
    throw new Invalid(`${path} must be one of ${allowed.join(", ")}`);
  }
  return raw;
}
