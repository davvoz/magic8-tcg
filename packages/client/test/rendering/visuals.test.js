/**
 * The procedural look: colour arithmetic, deterministic hashing behind the
 * card art, the card face layout, and the decorative widgets (option rows,
 * card strips, backdrop, hero fan, HUD) rendering the right texts without
 * leaking context state.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashString, unitSequence } from "@magic8/engine/shared/hash.js";
import { CardNode } from "../../src/rendering/board/CardNode.js";
import { CARD_SIZE } from "../../src/rendering/board/BoardLayout.js";
import { CastReveal } from "../../src/rendering/board/CastReveal.js";
import { EffectsNode } from "../../src/rendering/board/EffectsNode.js";
import { PlayerNode } from "../../src/rendering/board/PlayerNode.js";
import { CardVisual } from "../../src/rendering/cards/CardVisual.js";
import { artSeedOf, paintCardArt } from "../../src/rendering/cards/CardArt.js";
import { CardFaceProfile, cardFaceLayout, paintCardFace, typeLineFor } from "../../src/rendering/cards/CardFace.js";
import { drawCardBack } from "../../src/rendering/cards/CardRenderer.js";
import { CardStrip } from "../../src/rendering/cards/CardStrip.js";
import { HeroNode } from "../../src/rendering/scenes/mainMenu/HeroNode.js";
import { hexToRgb, mix, rgbToHex, shade, withAlpha } from "../../src/rendering/theme/color.js";
import { bodyFont, displayFont, factionTones, fontFor } from "../../src/rendering/theme/Theme.js";
import { drawSceneBackdrop } from "../../src/rendering/ui/backdrop.js";
import { OptionRow } from "../../src/rendering/ui/OptionRow.js";
import { Ornament } from "../../src/rendering/ui/Ornament.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();

/** A presenter with nothing on the board but one cast playing out. */
function fakePresenter(reveal) {
  return { leavingVisuals: [], floats: [], cardFor: () => null, get reveal() { return reveal.isDone ? null : reveal; } };
}

/** No NaN or negative extent may reach the canvas: the flip passes through zero width. */
function assertFinite(context) {
  for (const call of context.calls) {
    for (const argument of call.args) {
      assert.ok(typeof argument !== "number" || Number.isFinite(argument), `${call.method} got ${argument}`);
    }
  }
  const radii = context.calls.filter((call) => call.method === "arc").map((call) => call.args[2]);
  assert.ok(radii.every((radius) => radius >= 0), "no negative radius");
}

/** Every save() must be matched by a restore(), or state leaks into the next widget. */
function assertBalanced(context) {
  const saves = context.calls.filter((call) => call.method === "save").length;
  const restores = context.calls.filter((call) => call.method === "restore").length;
  assert.equal(saves, restores, "save/restore balanced");
  assert.equal(context.globalAlpha, 1, "alpha restored");
  assert.equal(context.shadowBlur, 0, "shadow restored");
}

describe("color helpers", () => {
  it("round-trips hex, blends, shades and builds rgba strings", () => {
    assert.deepEqual(hexToRgb("#ff8000"), { r: 255, g: 128, b: 0 });
    assert.equal(rgbToHex({ r: 255, g: 128, b: 0 }), "#ff8000");
    assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
    assert.equal(mix("#000000", "#ffffff", 0), "#000000");
    assert.equal(mix("#000000", "#ffffff", 7), "#ffffff", "t is clamped");
    assert.equal(shade("#808080", 1), "#ffffff");
    assert.equal(shade("#808080", -1), "#000000");
    assert.equal(withAlpha("#102030", 0.5), "rgba(16, 32, 48, 0.5)");
    assert.equal(withAlpha("#102030", 3), "rgba(16, 32, 48, 1)", "alpha is clamped");
    assert.deepEqual(hexToRgb("red"), { r: 0, g: 0, b: 0 }, "malformed input degrades to black instead of throwing");
  });
});

describe("hash", () => {
  it("is deterministic, spreads similar strings apart and yields unit values", () => {
    assert.equal(hashString("ember_imp"), hashString("ember_imp"));
    assert.notEqual(hashString("ember_imp"), hashString("ember_imq"));
    assert.equal(hashString(""), 0x811c9dc5);
    const values = unitSequence(hashString("seed"), 50);
    assert.equal(values.length, 50);
    assert.ok(values.every((value) => value >= 0 && value < 1));
    assert.ok(new Set(values).size > 40, "not degenerate");
    assert.deepEqual(unitSequence(7, 3), unitSequence(7, 3));
  });
});

describe("Theme fonts", () => {
  it("uses the display face for titles and headings and the body face elsewhere", () => {
    assert.ok(fontFor(theme, "title", "bold").endsWith(theme.fonts.displayFamily));
    assert.ok(fontFor(theme, "heading").endsWith(theme.fonts.displayFamily));
    assert.ok(fontFor(theme, "body").endsWith(theme.fonts.family));
    assert.equal(displayFont(theme, 13.6), `bold 14px ${theme.fonts.displayFamily}`);
    assert.equal(bodyFont(theme, 0.2), `normal 1px ${theme.fonts.family}`, "never a zero-size font");
    assert.deepEqual(Object.keys(factionTones(theme, "ember")), ["base", "light", "dark"]);
    assert.equal(factionTones(theme, "unknown").base, theme.colors.panelBorder, "unknown factions fall back to panel tones");
  });
});

describe("CardFace layout", () => {
  const frame = { x: 0, y: 0, width: 130, height: 182 };

  it("keeps every region inside the frame, in reading order, for both profiles and types", () => {
    for (const profile of [CardFaceProfile.COMPACT, CardFaceProfile.FULL]) {
      for (const type of ["creature", "spell"]) {
        const layout = cardFaceLayout(frame, profile, type);
        assert.ok(layout.header.y < layout.art.y && layout.art.y + layout.art.height <= layout.typeLine.y, `${profile.id} ${type}: header, art, type line`);
        assert.ok(layout.typeLine.y + layout.typeLine.height <= layout.textBox.y, "type line above text");
        assert.ok(layout.textBox.y + layout.textBox.height <= frame.height, "text inside the frame");
        assert.ok(layout.textLines >= 3, `${profile.id} ${type}: room for at least three lines (${layout.textLines})`);
        assert.ok(layout.health.x + layout.health.radius <= frame.width && layout.attack.x - layout.attack.radius >= 0, "gems inside the frame");
      }
    }
    const creature = cardFaceLayout(frame, CardFaceProfile.COMPACT, "creature");
    const spell = cardFaceLayout(frame, CardFaceProfile.COMPACT, "spell");
    assert.ok(spell.textBox.height > creature.textBox.height, "spells use the stat band for text");
    assert.ok(creature.textBox.y + creature.textBox.height <= creature.attack.y - creature.attack.radius + creature.attack.radius * 0.5, "text box ends above the stat gems");
  });

  it("capitalises the type line and draws name, cost, keywords and stats in the full profile", () => {
    const creature = content.catalog.all().find((card) => card.isCreature && card.keywords.length > 0);
    assert.equal(typeLineFor(creature), `${creature.type[0].toUpperCase()}${creature.type.slice(1)} · ${creature.faction[0].toUpperCase()}${creature.faction.slice(1)}`);
    const context = new FakeContext2D();
    paintCardFace(context, theme, creature, { frame: { x: 10, y: 10, width: 380, height: 540 }, profile: CardFaceProfile.FULL });
    assert.ok(context.texts.includes(creature.name));
    assert.ok(context.texts.includes(String(creature.cost)));
    assert.ok(context.texts.includes(creature.keywords.join(" · ")), "keywords line in the full profile");
    assertBalanced(context);
    const compact = new FakeContext2D();
    paintCardFace(compact, theme, creature, { frame: { x: 0, y: 0, width: 130, height: 182 }, profile: CardFaceProfile.COMPACT });
    assert.ok(!compact.texts.includes(creature.keywords.join(" · ")), "no keywords line in the compact profile (the rules text says it)");
    assertBalanced(compact);
    const empty = new FakeContext2D();
    paintCardFace(empty, theme, creature, { frame: { x: 0, y: 0, width: 0, height: 0 }, profile: CardFaceProfile.COMPACT });
    assert.deepEqual(empty.calls, [], "degenerate frames draw nothing");
  });
});

describe("CardArt", () => {
  it("varies on the definition id, falls back to the name, and paints every faction without leaking state", () => {
    assert.equal(artSeedOf({ name: "X", type: "creature", faction: "ember", definitionId: "d", id: "i" }), "d");
    assert.equal(artSeedOf({ name: "X", type: "creature", faction: "ember", id: "i" }), "i");
    assert.equal(artSeedOf({ name: "X", type: "creature", faction: "ember" }), "X");
    const area = { x: 5, y: 5, width: 100, height: 50 };
    for (const faction of ["ember", "iron", "neutral", "unknown"]) {
      for (const type of ["creature", "spell"]) {
        const context = new FakeContext2D();
        paintCardArt(context, theme, { name: "Test", type, faction, id: `${faction}-${type}` }, area);
        assert.ok(context.calls.some((call) => call.method === "clip"), `${faction} ${type} clips to the window`);
        assert.ok(context.calls.some((call) => call.method === "fill"), `${faction} ${type} paints`);
        assertBalanced(context);
      }
    }
    const first = new FakeContext2D();
    const second = new FakeContext2D();
    paintCardArt(first, theme, { name: "A", type: "creature", faction: "ember", id: "a" }, area);
    paintCardArt(second, theme, { name: "A", type: "creature", faction: "ember", id: "a" }, area);
    assert.deepEqual(first.calls, second.calls, "same id, same picture");
    const other = new FakeContext2D();
    paintCardArt(other, theme, { name: "A", type: "creature", faction: "ember", id: "b" }, area);
    assert.notDeepEqual(first.calls, other.calls, "different id, different picture");
  });

  it("draws the card back at any size without text", () => {
    const context = new FakeContext2D();
    drawCardBack(context, theme, { x: 0, y: 0, width: 48, height: 68 });
    assert.deepEqual(context.texts, []);
    assertBalanced(context);
  });
});

describe("OptionRow", () => {
  it("shows title, subtitle and a drawn check mark when selected; stays a Button", () => {
    let activated = 0;
    const row = new OptionRow({ id: "row", width: 400, height: 72, text: "Ember Vanguard", subtitle: "ember · 30 cards", stripeColor: "#c8472f", selected: true, onActivate: () => { activated += 1; } });
    const context = new FakeContext2D();
    row.draw(context, theme);
    assert.deepEqual(context.texts, ["Ember Vanguard", "ember · 30 cards"]);
    assert.ok(context.calls.filter((call) => call.method === "lineTo").length >= 2, "check mark is drawn, not typed");
    assertBalanced(context);
    row.activate();
    assert.equal(activated, 1);
    const plain = new OptionRow({ width: 400, height: 40, text: "Only a title", onActivate: () => undefined });
    const plainContext = new FakeContext2D();
    plain.draw(plainContext, theme);
    assert.deepEqual(plainContext.texts, ["Only a title"]);
    plain.enabled = false;
    plain.activate();
    assert.equal(activated, 1, "disabled rows do not fire");
  });
});

describe("CardStrip", () => {
  it("draws cost, name, type line, copy count and stat gems for creatures, none for spells", () => {
    const creature = content.catalog.all().find((card) => card.isCreature);
    const spell = content.catalog.all().find((card) => card.isSpell);
    const context = new FakeContext2D();
    new CardStrip({ width: 400, height: 56, card: creature, count: 3 }).draw(context, theme);
    assert.ok(context.texts.includes(String(creature.cost)));
    assert.ok(context.texts.includes(creature.name));
    assert.ok(context.texts.includes("x3"));
    assert.ok(context.texts.includes(String(creature.attack)) && context.texts.includes(String(creature.health)));
    assertBalanced(context);
    const spellContext = new FakeContext2D();
    new CardStrip({ width: 400, height: 56, card: spell, count: 0, muted: true }).draw(spellContext, theme);
    assert.ok(!spellContext.texts.some((text) => text.startsWith("x")), "no count badge at zero copies");
    assert.equal(spellContext.texts.filter((text) => /^\d+$/.test(text)).length, 1, "only the cost is numeric for a spell");
    assertBalanced(spellContext);
  });
});

describe("decorative nodes", () => {
  it("backdrop, hero fan, ornament and HUD render without leaking context state", () => {
    const bounds = { x: 0, y: 0, width: 1600, height: 900 };
    const backdrop = new FakeContext2D();
    drawSceneBackdrop(backdrop, theme, bounds, { seed: "test" });
    assert.ok(backdrop.calls.some((call) => call.method === "createRadialGradient"));
    assertBalanced(backdrop);
    const quiet = new FakeContext2D();
    drawSceneBackdrop(quiet, theme, bounds, { motes: false });
    assert.ok(quiet.calls.filter((call) => call.method === "arc").length < backdrop.calls.filter((call) => call.method === "arc").length, "motes are optional");

    const hero = new FakeContext2D();
    new HeroNode({ x: 400, y: 20, width: 800, height: 280 }).draw(hero, theme);
    assert.equal(hero.calls.filter((call) => call.method === "rotate").length, 5, "five fanned cards");
    assertBalanced(hero);

    const ornament = new FakeContext2D();
    new Ornament({ x: 0, y: 0, width: 300, height: 16 }).draw(ornament, theme);
    assertBalanced(ornament);

    const player = { id: "p1", name: "Alice", life: 4, resources: { current: 2, max: 5 }, librarySize: 20, handSize: 3, graveyard: [{}] };
    const hud = new FakeContext2D();
    new PlayerNode({ player, rect: { x: 0, y: 0, width: 200, height: 184 }, isMe: true, isActive: true, highlight: null, onTap: () => undefined }).draw(hud, theme);
    assert.ok(hud.texts.includes("Alice") && hud.texts.includes("YOU") && hud.texts.includes("4") && hud.texts.includes("2 / 5"));
    assert.ok(hud.texts.includes("3") && hud.texts.includes("20") && hud.texts.includes("1"), "hand, deck and graveyard counts");
    assert.equal(hud.calls.filter((call) => call.method === "arc").length >= 5 * 2, true, "one orb (plus highlight) per resource point");
    assertBalanced(hud);
  });
});

describe("cast reveal", () => {
  /** The opponent's cast drawn all the way through, including the instant the card is edge-on. */
  it("turns the card over and marks its target without leaking context state or drawing degenerate geometry", () => {
    const spell = content.catalog.all().find((definition) => definition.isSpell);
    const card = { ...spell, instanceId: "c9", damage: 0, summoningSick: false, exhausted: false };
    const reveal = new CastReveal({
      card,
      caption: "Bob casts",
      targets: [{ x: 320, y: 640, name: "Cinder Hound" }],
      from: { x: 700, y: 20, width: 48, height: 68 },
      at: { x: 695, y: 300, width: 210, height: 294 },
      to: { x: 16, y: 16, width: 200, height: 184 },
      animation: theme.animation,
      holdMs: theme.animation.longMs,
    });
    const layout = { width: 1600, height: 900, cards: {} };
    const node = new EffectsNode({ presenter: fakePresenter(reveal), layout, blocks: [] });
    const step = theme.animation.mediumMs / 2;
    const seen = { backs: 0, faces: 0, marks: 0 };
    for (let frames = 0; frames < 200 && !reveal.isDone; frames += 1) {
      const context = new FakeContext2D();
      node.draw(context, theme);
      assertBalanced(context);
      assertFinite(context);
      seen.backs += reveal.frame.turn < 0.5 ? 1 : 0;
      seen.faces += reveal.frame.turn >= 0.5 ? 1 : 0;
      seen.marks += context.texts.includes("Cinder Hound") ? 1 : 0;
      reveal.update(step);
    }
    assert.ok(seen.backs > 0, "drawn face-down on the way up");
    assert.ok(seen.faces > 0, "and face-up once it has turned");
    assert.ok(seen.marks > 0, "the target is named once the beam reaches it");
    assert.equal(reveal.isDone, true, "the cast finishes");
    const after = new FakeContext2D();
    node.draw(after, theme);
    const idle = new FakeContext2D();
    new EffectsNode({ presenter: { leavingVisuals: [], floats: [], cardFor: () => null, reveal: null }, layout, blocks: [] }).draw(idle, theme);
    assert.equal(after.calls.length, idle.calls.length, "and leaves nothing behind: the overlay draws what an empty one draws");
  });
});

describe("CardNode lift", () => {
  it("draws a tappable card larger around its centre while hovered or focused, never while leaving", () => {
    const card = { ...content.catalog.all().find((definition) => definition.isCreature), instanceId: "c1", damage: 0, summoningSick: false, exhausted: false };
    const slot = { x: 100, y: 100, ...CARD_SIZE.battlefield };
    const visual = new CardVisual("c1", { ...slot, alpha: 1 });
    const node = new CardNode({ card, visual, slot, highlight: "playable", enabled: true, onTap: () => undefined });
    const scaleOf = (context) => context.calls.find((call) => call.method === "scale").args[0];
    const translateOf = (context) => context.calls.find((call) => call.method === "translate").args;
    const rest = new FakeContext2D();
    node.draw(rest, theme);
    assert.equal(node.isLifted, false);
    assert.equal(scaleOf(rest), 1);
    node.hovered = true;
    const lifted = new FakeContext2D();
    node.draw(lifted, theme);
    assert.equal(node.isLifted, true);
    assert.ok(scaleOf(lifted) > 1, "grown");
    assert.ok(translateOf(lifted)[0] < slot.x && translateOf(lifted)[1] < slot.y, "around the centre");
    node.hovered = false;
    node.enabled = false;
    node.focused = true;
    assert.equal(node.isLifted, true, "keyboard focus lifts too");
    visual.leaveTo(slot, 100);
    const leaving = new FakeContext2D();
    node.draw(leaving, theme);
    assert.deepEqual(leaving.calls, [], "leaving cards are drawn by the effects layer instead");
  });
});
