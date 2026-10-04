import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InfoTopicId, JOIN_URL, infoTopics } from "../../src/application/info/infoTopics.js";
import { loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();
const textOf = (topic) => topic.blocks.map((block) => block.text).join("\n");

describe("infoTopics", () => {
  it("covers how to play, purchases, sign-in, ranked and the shop, in that order", () => {
    const topics = infoTopics(content);
    assert.deepEqual(topics.map((topic) => topic.id), [InfoTopicId.MECHANICS, InfoTopicId.PURCHASES, InfoTopicId.ACCOUNT, InfoTopicId.RANKED, InfoTopicId.SHOP]);
    for (const topic of topics) {
      assert.ok(topic.title.length > 0 && topic.shortTitle.length > 0, `${topic.id} is named`);
      assert.equal(topic.blocks[0].kind, "heading", `${topic.id} opens with a heading`);
      assert.ok(topic.blocks.every((block) => block.text.trim().length > 0), `${topic.id} has no empty block`);
    }
  });

  it("explains the goal, the cards, abilities, mana, the turn and what to click", () => {
    const mechanics = infoTopics(content).find((topic) => topic.id === InfoTopicId.MECHANICS);
    const headings = mechanics.blocks.filter((block) => block.kind === "heading").map((block) => block.text);
    for (const expected of ["The goal", "Creatures and spells", "Creature abilities", "Mana", "How a turn works", "What to click"]) {
      assert.ok(headings.includes(expected), `has "${expected}"`);
    }
    const steps = mechanics.blocks.filter((block) => block.marker !== undefined);
    assert.deepEqual(steps.map((block) => block.marker), ["1.", "2.", "3.", "4.", "5.", "6.", "7."], "the seven phases, numbered");
    const text = textOf(mechanics);
    for (const button of ["End phase", "End turn", "Attack with", "Skip combat", "No blocks", "Concede"]) {
      assert.ok(text.includes(button), `names the "${button}" button`);
    }
  });

  it("quotes the numbers of the rules the game is played by", () => {
    const { gameRules, deckRules } = content;
    const text = textOf(infoTopics(content)[0]);
    assert.ok(text.includes(`starts with ${gameRules.startingLife} life points`));
    assert.ok(text.includes(`draws ${gameRules.startingHandSize} cards`));
    assert.ok(text.includes(`up to ${gameRules.resource.max})`));
    assert.ok(text.includes(`${deckRules.minSize} to ${deckRules.maxSize} cards`));

    const rules = { ...gameRules, startingLife: 30, resource: { ...gameRules.resource, gainPerTurn: 2, max: 12 } };
    const changed = textOf(infoTopics({ gameRules: rules, deckRules })[0]);
    assert.ok(changed.includes("starts with 30 life points"));
    assert.ok(changed.includes("grows by 2 (up to 12)"));
    assert.ok(changed.includes("you have 2 mana on your first turn, 4 on your second"));
  });

  it("links the account topic to the free sign-up at join.cur8.fun, and only that one", () => {
    const topics = infoTopics(content);
    const account = topics.find((topic) => topic.id === InfoTopicId.ACCOUNT);
    assert.equal(JOIN_URL, "https://join.cur8.fun");
    assert.equal(account.link?.url, JOIN_URL);
    assert.ok(textOf(account).includes("join.cur8.fun"));
    assert.deepEqual(topics.filter((topic) => topic.link !== null).map((topic) => topic.id), [InfoTopicId.ACCOUNT]);
  });

  it("explains that ranked entries are bought in advance and go into the jackpot", () => {
    const text = textOf(infoTopics(content).find((topic) => topic.id === InfoTopicId.RANKED));
    assert.ok(text.includes("buy entries in advance"));
    assert.ok(text.includes("get their entry back"));
    assert.ok(text.includes("Every entry goes into the season's jackpot."));
  });
});
