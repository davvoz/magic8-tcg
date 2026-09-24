import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CardCatalog } from "../../src/domain/cards/CardCatalog.js";
import { validateCardDefinition, validateCardSet } from "../../src/domain/cards/validateCardDefinition.js";
import { EffectRegistry, Targeting } from "../../src/domain/effects/EffectRegistry.js";
import { createCoreEffectRegistry } from "../../src/domain/effects/registerCoreEffects.js";
import { TriggerType } from "../../src/domain/effects/TriggerType.js";

const context = Object.freeze({ factions: ["ember", "iron", "neutral"], effects: createCoreEffectRegistry() });

const creature = () => ({
  id: "iron_watcher",
  name: "Iron Watcher",
  type: "creature",
  faction: "iron",
  cost: 3,
  attack: 2,
  health: 4,
  abilities: [{ trigger: "on_play", effect: "draw_card", params: { amount: 1 } }],
  text: "Draw a card.",
});

const spell = () => ({
  id: "ember_bolt",
  name: "Ember Bolt",
  type: "spell",
  faction: "ember",
  cost: 2,
  abilities: [
    {
      trigger: "on_cast",
      effect: "deal_damage",
      params: { amount: 3 },
      target: { kind: "creature_or_player", owner: "any", count: 1 },
    },
  ],
});

/** @param {unknown} raw */
function problemsOf(raw) {
  const result = validateCardDefinition(raw, context);
  assert.equal(result.ok, false, "expected validation to fail");
  return result.error.details.problems;
}

describe("validateCardDefinition — accepted input", () => {
  it("builds a frozen CardDefinition for a creature with an untargeted ability", () => {
    const result = validateCardDefinition(creature(), context);
    assert.equal(result.ok, true);
    const definition = result.value;
    assert.equal(definition.isCreature, true);
    assert.equal(definition.attack, 2);
    assert.equal(definition.abilities.length, 1);
    assert.equal(definition.abilities[0].target, null);
    assert.deepEqual(definition.abilities[0].params, { amount: 1 });
    assert.ok(Object.isFrozen(definition));
    assert.ok(Object.isFrozen(definition.abilities));
    assert.ok(Object.isFrozen(definition.abilities[0].params));
  });

  it("builds a spell with a player-chosen target and normalises defaults", () => {
    const result = validateCardDefinition(spell(), context);
    assert.equal(result.ok, true);
    const [ability] = result.value.abilities;
    assert.equal(ability.target.kind, "creature_or_player");
    assert.equal(result.value.attack, 0);
    assert.equal(result.value.text, "");
    assert.equal(result.value.playerTargetedAbilities.length, 1);
  });

  it("applies effect param defaults (modify_stats duration)", () => {
    const raw = spell();
    raw.abilities = [
      {
        trigger: "on_cast",
        effect: "modify_stats",
        params: { attack: 2 },
        target: { kind: "creature", owner: "ally" },
      },
    ];
    const result = validateCardDefinition(raw, context);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.abilities[0].params, { attack: 2, health: 0, duration: "permanent" });
    assert.equal(result.value.abilities[0].target.count, 1);
  });

  it("strips control characters from name and text", () => {
    const raw = creature();
    raw.name = "Iron\u0007 Watcher";
    raw.text = "line\u0000break";
    const result = validateCardDefinition(raw, context);
    assert.equal(result.ok, true);
    assert.equal(result.value.name, "Iron Watcher");
    assert.equal(result.value.text, "linebreak");
  });

  it("abilitiesFor filters by trigger", () => {
    const definition = validateCardDefinition(creature(), context).value;
    assert.equal(definition.abilitiesFor(TriggerType.ON_PLAY).length, 1);
    assert.equal(definition.abilitiesFor(TriggerType.ON_DEATH).length, 0);
  });
});

describe("validateCardDefinition — rejected input", () => {
  it("rejects non-objects and prototype-polluting keys", () => {
    assert.match(problemsOf(null)[0], /expected an object/);
    const polluted = JSON.parse(`{"__proto__": {"x": 1}, "id": "a"}`);
    assert.match(problemsOf(polluted)[0], /forbidden key/);
  });

  it("rejects unknown fields, bad ids, unknown types and factions", () => {
    const raw = { ...creature(), id: "Iron Watcher!", type: "land", faction: "water", bogus: true };
    const problems = problemsOf(raw);
    assert.ok(problems.some((p) => p.includes("card.bogus: unknown field")));
    assert.ok(problems.some((p) => p.startsWith("card.id:")));
    assert.ok(problems.some((p) => p.startsWith("card.type:")));
    assert.ok(problems.some((p) => p.startsWith("card.faction:")));
  });

  it("rejects out-of-range and non-integer numbers without coercion", () => {
    assert.ok(problemsOf({ ...creature(), cost: "3" }).some((p) => p.startsWith("card.cost:")));
    assert.ok(problemsOf({ ...creature(), cost: 21 }).some((p) => p.startsWith("card.cost:")));
    assert.ok(problemsOf({ ...creature(), health: 0 }).some((p) => p.startsWith("card.health:")));
    assert.ok(problemsOf({ ...creature(), attack: 1.5 }).some((p) => p.startsWith("card.attack:")));
  });

  it("requires stats on creatures and forbids them on spells", () => {
    const noStats = creature();
    delete noStats.attack;
    assert.ok(problemsOf(noStats).some((p) => p.startsWith("card.attack:")));
    assert.ok(problemsOf({ ...spell(), attack: 1, health: 1 }).some((p) => p.includes("only valid on creature")));
  });

  it("rejects unknown effects, unknown triggers and trigger/type mismatches", () => {
    const unknownEffect = creature();
    unknownEffect.abilities[0].effect = "destroy_everything";
    assert.ok(problemsOf(unknownEffect).some((p) => p.includes('unknown effect "destroy_everything"')));

    const badTrigger = creature();
    badTrigger.abilities[0].trigger = "on_upkeep";
    assert.ok(problemsOf(badTrigger).some((p) => p.startsWith("card.abilities[0].trigger:")));

    const castOnCreature = creature();
    castOnCreature.abilities[0].trigger = "on_cast";
    assert.ok(problemsOf(castOnCreature).some((p) => p.includes('"on_cast" is not valid on creature')));
  });

  it("validates effect params against the registry schema and rejects extra params", () => {
    const tooMany = creature();
    tooMany.abilities[0].params = { amount: 99 };
    assert.ok(problemsOf(tooMany).some((p) => p.startsWith("card.abilities[0].params.amount:")));

    const extra = creature();
    extra.abilities[0].params = { amount: 1, evil: "yes" };
    assert.ok(problemsOf(extra).some((p) => p.includes("params.evil: unknown field")));

    const missing = creature();
    missing.abilities[0].params = {};
    assert.ok(problemsOf(missing).some((p) => p.includes("required parameter is missing")));
  });

  it("enforces target presence according to the effect's targeting", () => {
    const targetOnDraw = creature();
    targetOnDraw.abilities[0].target = { kind: "player" };
    assert.ok(problemsOf(targetOnDraw).some((p) => p.includes("does not take a target")));

    const noTargetOnDamage = spell();
    delete noTargetOnDamage.abilities[0].target;
    assert.ok(problemsOf(noTargetOnDamage).some((p) => p.includes("requires a target")));
  });

  it("restricts target kinds per effect (modify_stats only targets creatures)", () => {
    const raw = spell();
    raw.abilities = [
      { trigger: "on_cast", effect: "modify_stats", params: { attack: 1 }, target: { kind: "player", owner: "ally" } },
    ];
    assert.ok(problemsOf(raw).some((p) => p.includes("accepts only creature")));
  });

  it("forbids player-chosen targets on on_death triggers", () => {
    const raw = creature();
    raw.abilities = [
      { trigger: "on_death", effect: "deal_damage", params: { amount: 1 }, target: { kind: "creature", owner: "enemy" } },
    ];
    assert.ok(problemsOf(raw).some((p) => p.includes("cannot ask the player for a target")));

    raw.abilities[0].target = { kind: "player", owner: "enemy" };
    assert.equal(validateCardDefinition(raw, context).ok, true);
  });

  it("allows on_turn_start only on creatures and only with automatic targets", () => {
    const raw = creature();
    raw.abilities = [{ trigger: "on_turn_start", effect: "mill", params: { amount: 1 }, target: { kind: "player", owner: "enemy" } }];
    assert.equal(validateCardDefinition(raw, context).ok, true);

    raw.abilities[0].target = { kind: "creature", owner: "enemy" };
    assert.ok(problemsOf(raw).some((p) => p.includes("accepts only player")), "mill targets players only");
    raw.abilities[0] = { trigger: "on_turn_start", effect: "return_to_hand", target: { kind: "creature", owner: "enemy" } };
    assert.ok(problemsOf(raw).some((p) => p.includes("cannot ask the player for a target")));

    const onSpell = spell();
    onSpell.abilities = [{ trigger: "on_turn_start", effect: "draw_card", params: { amount: 1 } }];
    assert.ok(problemsOf(onSpell).some((p) => p.includes('"on_turn_start" is not valid on spell cards')));
  });

  it("accepts mandatory only on a play ability whose target the player chooses", () => {
    const raw = creature();
    raw.abilities = [{ trigger: "on_play", effect: "sacrifice", mandatory: true, target: { kind: "creature", owner: "ally" } }];
    const tribute = validateCardDefinition(raw, context);
    assert.equal(tribute.ok, true);
    assert.equal(tribute.value.abilities[0].mandatory, true);
    assert.equal(validateCardDefinition(creature(), context).value.abilities[0].mandatory, false, "defaults to false");

    raw.abilities[0].mandatory = "yes";
    assert.ok(problemsOf(raw).some((p) => p.startsWith("card.abilities[0].mandatory:")));

    const automatic = creature();
    automatic.abilities = [{ trigger: "on_play", effect: "mill", params: { amount: 1 }, mandatory: true, target: { kind: "player", owner: "enemy" } }];
    assert.ok(problemsOf(automatic).some((p) => p.includes("only a play ability whose target the player chooses")));

    const onDeath = creature();
    onDeath.abilities = [{ trigger: "on_death", effect: "mill", params: { amount: 1 }, mandatory: true, target: { kind: "player", owner: "enemy" } }];
    assert.ok(problemsOf(onDeath).some((p) => p.includes("only a play ability whose target the player chooses")));
  });

  it("caps abilities and keywords and rejects duplicate keywords", () => {
    const many = creature();
    many.abilities = Array.from({ length: 5 }, () => ({ trigger: "on_play", effect: "draw_card", params: { amount: 1 } }));
    assert.ok(problemsOf(many).some((p) => p.includes("card.abilities: expected at most 4")));

    const dupes = { ...creature(), keywords: ["haste", "haste"] };
    assert.ok(problemsOf(dupes).some((p) => p.includes("duplicate")));
    assert.ok(problemsOf({ ...creature(), keywords: ["flying"] }).some((p) => p.startsWith("card.keywords[0]:")));
  });
});

describe("validateCardSet / CardCatalog", () => {
  it("validates a set and rejects duplicate ids and wrong schema versions", () => {
    const good = validateCardSet({ schemaVersion: 1, cards: [creature(), spell()] }, context);
    assert.equal(good.ok, true);
    assert.equal(good.value.length, 2);

    const duplicate = validateCardSet({ schemaVersion: 1, cards: [creature(), creature()] }, context);
    assert.equal(duplicate.ok, false);
    assert.ok(duplicate.error.details.problems.some((p) => p.includes("duplicate")));

    const version = validateCardSet({ schemaVersion: 2, cards: [] }, context);
    assert.equal(version.ok, false);
  });

  it("reports the failing card path inside a set", () => {
    const bad = validateCardSet({ schemaVersion: 1, cards: [creature(), { ...spell(), cost: -1 }] }, context);
    assert.equal(bad.ok, false);
    assert.ok(bad.error.details.problems.some((p) => p.startsWith("cardSet.cards[1].cost:")));
  });

  it("builds a catalog and refuses duplicates", () => {
    const definitions = validateCardSet({ schemaVersion: 1, cards: [creature(), spell()] }, context).value;
    const catalog = CardCatalog.fromDefinitions(definitions).value;
    assert.equal(catalog.size, 2);
    assert.equal(catalog.get("ember_bolt").name, "Ember Bolt");
    assert.equal(catalog.has("nope"), false);
    assert.equal(CardCatalog.fromDefinitions([...definitions, definitions[0]]).ok, false);
  });
});

describe("EffectRegistry", () => {
  it("throws on malformed descriptors and duplicate registration (programmer errors)", () => {
    const registry = new EffectRegistry();
    const resolve = () => undefined;
    assert.throws(() => registry.register({ type: "", targeting: Targeting.NONE, params: {}, resolve }), TypeError);
    assert.throws(() => registry.register({ type: "x", targeting: "sometimes", params: {}, resolve }), TypeError);
    assert.throws(() => registry.register({ type: "x", targeting: Targeting.NONE, params: { a: { kind: "float" } }, resolve }), TypeError);
    assert.throws(() => registry.register({ type: "x", targeting: Targeting.NONE, params: {} }), /resolve/);
    registry.register({ type: "x", targeting: Targeting.NONE, params: {}, resolve });
    assert.throws(() => registry.register({ type: "x", targeting: Targeting.NONE, params: {}, resolve }), /already registered/);
  });

  it("exposes the ten core effects", () => {
    assert.deepEqual([...createCoreEffectRegistry().types()].sort(), ["deal_damage", "destroy", "discard", "drain", "draw_card", "heal", "mill", "modify_stats", "return_to_hand", "sacrifice"]);
  });
});
