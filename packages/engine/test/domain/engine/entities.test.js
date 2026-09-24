import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CardInstance, ModifierDuration } from "../../../src/domain/cards/CardInstance.js";
import { CombatState } from "../../../src/domain/combat/CombatState.js";
import { Player } from "../../../src/domain/game/Player.js";
import { Zone } from "../../../src/domain/game/Zone.js";
import { ZoneType } from "../../../src/domain/game/ZoneType.js";
import { IncrementalResourceSystem, createResourceSystem } from "../../../src/domain/resources/IncrementalResourceSystem.js";
import { ResourcePool } from "../../../src/domain/resources/ResourcePool.js";
import { catalog, rulesWith } from "./fixtures.js";

const creature = (id = "x1") =>
  new CardInstance({ instanceId: id, definition: catalog.get("iron_watcher"), ownerId: "p1", zone: ZoneType.BATTLEFIELD });

describe("CardInstance", () => {
  it("derives current stats from definition, modifiers and damage", () => {
    const card = creature();
    assert.equal(card.attack, 2);
    assert.equal(card.health, 4);
    card.addModifier({ attack: 2, health: 1, duration: ModifierDuration.END_OF_TURN });
    card.addModifier({ attack: -1, health: 0, duration: ModifierDuration.PERMANENT });
    assert.equal(card.attack, 3);
    assert.equal(card.maxHealth, 5);
    assert.equal(card.takeDamage(3), 3);
    assert.equal(card.health, 2);
    assert.equal(card.isLethallyDamaged, false);
    assert.equal(card.expireEndOfTurnModifiers(), true);
    assert.equal(card.health, 1);
    assert.equal(card.expireEndOfTurnModifiers(), false);
  });

  it("never reports negative attack and caps healing at damage taken", () => {
    const card = creature();
    card.addModifier({ attack: -5, health: 0, duration: ModifierDuration.PERMANENT });
    assert.equal(card.attack, 0);
    card.takeDamage(2);
    assert.equal(card.heal(10), 2);
    assert.equal(card.damage, 0);
    assert.equal(card.takeDamage(-3), 0);
  });

  it("is lethally damaged only on the battlefield", () => {
    const card = creature();
    card.takeDamage(4);
    assert.equal(card.isLethallyDamaged, true);
    card.moveTo(ZoneType.GRAVEYARD);
    assert.equal(card.isLethallyDamaged, false);
    assert.equal(card.damage, 0, "leaving the battlefield resets damage");
  });

  it("clones deeply including modifiers", () => {
    const card = creature();
    card.addModifier({ attack: 1, health: 1, duration: ModifierDuration.PERMANENT });
    card.exhausted = true;
    const copy = card.clone();
    copy.addModifier({ attack: 5, health: 5, duration: ModifierDuration.PERMANENT });
    assert.equal(card.attack, 3);
    assert.equal(copy.attack, 8);
    assert.equal(copy.exhausted, true);
  });

  it("bounds the number of modifiers", () => {
    const card = creature();
    for (let i = 0; i < 64; i += 1) {
      card.addModifier({ attack: 0, health: 0, duration: ModifierDuration.PERMANENT });
    }
    assert.throws(() => card.addModifier({ attack: 0, health: 0, duration: ModifierDuration.PERMANENT }), RangeError);
  });
});

describe("Zone", () => {
  it("keeps order, updates zone markers and removes by id", () => {
    const zone = new Zone(ZoneType.HAND);
    const a = creature("a");
    const b = creature("b");
    zone.add(a);
    zone.add(b);
    assert.equal(a.zone, ZoneType.HAND);
    assert.deepEqual(zone.cards.map((card) => card.instanceId), ["a", "b"]);
    assert.equal(zone.remove("zzz"), undefined);
    assert.equal(zone.remove("a"), a);
    assert.equal(zone.takeTop(), b);
    assert.equal(zone.takeTop(), undefined);
    assert.equal(zone.isEmpty, true);
  });

  it("exposes copies, not its internal array", () => {
    const zone = new Zone(ZoneType.HAND, [creature("a")]);
    const cards = zone.cards;
    assert.ok(Object.isFrozen(cards));
    assert.equal(zone.size, 1);
  });
});

describe("ResourcePool / IncrementalResourceSystem", () => {
  it("spends only when affordable and grows to the cap", () => {
    const pool = new ResourcePool({ current: 2, max: 2 });
    assert.equal(pool.spend(3), false);
    assert.equal(pool.current, 2);
    assert.equal(pool.spend(2), true);
    assert.equal(pool.current, 0);
    pool.grow(5, 3);
    pool.refill();
    assert.deepEqual({ current: pool.current, max: pool.max }, { current: 3, max: 3 });
  });

  it("applies the incremental model from rules", () => {
    const system = new IncrementalResourceSystem({ type: "incremental", gainPerTurn: 1, max: 2, startingMax: 0 });
    const pool = system.createPool();
    assert.equal(system.onTurnStart(pool), true);
    assert.deepEqual({ current: pool.current, max: pool.max }, { current: 1, max: 1 });
    system.onTurnStart(pool);
    assert.equal(system.onTurnStart(pool), false, "at cap and full: nothing changes");
    assert.ok(createResourceSystem(rulesWith()) instanceof IncrementalResourceSystem);
  });
});

describe("Player / CombatState", () => {
  it("bounds life gain by the cap and never gains negative", () => {
    const player = new Player({ id: "p1", name: "A", life: 18, resources: new ResourcePool({ current: 0, max: 0 }) });
    assert.equal(player.gainLife(5, 20), 2);
    assert.equal(player.gainLife(-5, 20), 0);
    assert.equal(player.loseLife(25), 25);
    assert.equal(player.life, -5);
    assert.throws(() => player.zone("exile"), RangeError);
  });

  it("clones combat state independently", () => {
    const combat = new CombatState({ attackerIds: ["a"], blocks: new Map([["a", ["b"]]]) });
    const copy = combat.clone();
    copy.clear();
    assert.equal(combat.hasAttackers, true);
    assert.deepEqual(combat.blockersOf("a"), ["b"]);
    assert.deepEqual(combat.toPlain(), { attackerIds: ["a"], blocks: [{ attackerId: "a", blockerIds: ["b"] }] });
  });
});
