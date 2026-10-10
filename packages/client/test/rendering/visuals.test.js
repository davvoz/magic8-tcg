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
import { TriggerFlare } from "../../src/rendering/board/TriggerFlare.js";
import { TurnBanner } from "../../src/rendering/board/TurnBanner.js";
import { GameOverNode } from "../../src/rendering/board/GameOverNode.js";
import { GameOverMood, GameOverSequence } from "../../src/rendering/board/GameOverSequence.js";
import { MatchResultNode, Standing } from "../../src/rendering/board/MatchResultNode.js";
import { PlayerNode } from "../../src/rendering/board/PlayerNode.js";
import { CardVisual } from "../../src/rendering/cards/CardVisual.js";
import { artSeedOf, paintCardArt } from "../../src/rendering/cards/CardArt.js";
import { CardFaceProfile, cardFaceLayout, paintCardFace, typeLineFor } from "../../src/rendering/cards/CardFace.js";
import { drawCardBack } from "../../src/rendering/cards/CardRenderer.js";
import { CardOption } from "../../src/rendering/cards/CardOption.js";
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
  return { leavingVisuals: [], floats: [], breakthroughs: [], cardFor: () => null, get moment() { return reveal.isDone ? null : reveal; } };
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

  it("capitalises the type line and draws name, cost, keywords and stats", () => {
    const creature = content.catalog.all().find((card) => card.isCreature && card.keywords.length > 0);
    assert.equal(typeLineFor(creature), `${creature.type[0].toUpperCase()}${creature.type.slice(1)} · ${creature.faction[0].toUpperCase()}${creature.faction.slice(1)}`);
    const context = new FakeContext2D();
    paintCardFace(context, theme, creature, { frame: { x: 10, y: 10, width: 380, height: 540 }, profile: CardFaceProfile.FULL });
    assert.ok(context.texts.includes(creature.name));
    assert.ok(context.texts.includes(String(creature.cost)));
    const named = (/** @type {string} */ keyword) => `${keyword[0].toUpperCase()}${keyword.slice(1)}`;
    assert.ok(creature.keywords.every((keyword) => context.texts.includes(named(keyword))), "keywords named in the full profile's rules text");
    assertBalanced(context);
    const compact = new FakeContext2D();
    paintCardFace(compact, theme, creature, { frame: { x: 0, y: 0, width: 130, height: 182 }, profile: CardFaceProfile.COMPACT });
    assert.ok(creature.keywords.every((keyword) => compact.texts.includes(named(keyword))), "and in the compact profile's");
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
    const row = new OptionRow({ id: "row", width: 400, height: 72, text: "Ember Vanguard", subtitle: "30 cards · ember 28 · neutral 2", stripe: [{ color: "#c8472f", weight: 28 }, { color: "#8a8a8a", weight: 2 }], selected: true, onActivate: () => { activated += 1; } });
    const context = new FakeContext2D();
    row.draw(context, theme);
    assert.deepEqual(context.texts, ["Ember Vanguard", "30 cards · ember 28 · neutral 2"]);
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

  it("splits the stripe among its bands in proportion to their weights, top to bottom", () => {
    const row = new OptionRow({ width: 400, height: 60, text: "Spire Bastion", stripe: [{ color: "#3a6fd8", weight: 19 }, { color: "#9aa4ad", weight: 11 }, { color: "#ffffff", weight: 0 }], onActivate: () => undefined });
    const context = new FakeContext2D();
    row.draw(context, theme);
    const bands = context.calls.filter((call) => call.method === "fillRect").map((call) => call.args);
    assert.deepEqual(bands, [[0, 0, 12, 38], [0, 38, 12, 22]], "an empty band takes no room");
    assertBalanced(context);
    const none = new FakeContext2D();
    new OptionRow({ width: 400, height: 60, text: "Empty", stripe: [{ color: "#3a6fd8", weight: 0 }], onActivate: () => undefined }).draw(none, theme);
    assert.equal(none.calls.filter((call) => call.method === "fillRect").length, 0, "no cards, no stripe");
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

  it("shows a badge in place of the count, and a check once chosen", () => {
    const creature = content.catalog.all().find((card) => card.isCreature);
    const context = new FakeContext2D();
    new CardStrip({ width: 400, height: 56, card: creature, count: 3, badge: "#7", selected: true }).draw(context, theme);
    assert.ok(context.texts.includes("#7") && !context.texts.includes("x3"), "the badge replaces the count");
    const plain = new FakeContext2D();
    new CardStrip({ width: 400, height: 56, card: creature, badge: "#7" }).draw(plain, theme);
    assert.ok(context.calls.filter((call) => call.method === "arc").length > plain.calls.filter((call) => call.method === "arc").length, "a chosen card is checked");
    assertBalanced(context);
  });
});

describe("CardOption", () => {
  it("is a button named after its card, whose strip dims when it cannot be chosen", () => {
    const creature = content.catalog.all().find((card) => card.isCreature);
    let picked = 0;
    const option = new CardOption({ id: "pick", width: 400, height: 56, card: creature, rarity: "rare", badge: "#2", selected: true, enabled: false, onActivate: () => (picked += 1) });
    assert.equal(option.text, creature.name);
    assert.equal(option.badge, "#2");
    assert.equal(option.selected, true);
    const context = new FakeContext2D();
    option.draw(context, theme);
    assert.ok(context.texts.includes(creature.name) && context.texts.includes("#2"));
    assert.equal(option.children[0].muted, true, "disabled: dimmed");
    option.activate();
    assert.equal(picked, 0, "a disabled option does nothing");
    option.enabled = true;
    option.activate();
    assert.equal(picked, 1);
    assertBalanced(context);
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
  /**
   * The rune spreads from behind the held card; the beam and the mark it
   * leaves from are drawn over its face, not hidden behind it.
   * @returns {{ rune: boolean, beam: boolean }} which of them this frame drew
   */
  function assertOverCard(context, frame, { name, origin }) {
    const face = context.calls.findLastIndex((call) => call.method === "fillText" && call.args[0] === name);
    const spreading = frame.ring > 0 && frame.ring < 1 && frame.alpha > 0;
    const beaming = frame.strike > 0 && frame.alpha > 0;
    if (spreading) {
      const runeRadius = frame.width * (0.5 + 0.85 * frame.ring) * 0.9;
      const rune = context.calls.findIndex((call) => call.method === "arc" && Math.abs(call.args[2] - runeRadius) < 1e-6);
      assert.ok(rune !== -1 && rune < face, "the rune spreads from behind the card");
    }
    if (beaming) {
      const at = (call) => call.args[0] === origin.x && call.args[1] === origin.y;
      const beam = context.calls.findIndex((call) => call.method === "moveTo" && at(call));
      const source = context.calls.findIndex((call) => call.method === "arc" && at(call) && call.args[2] < 0.5 * frame.width);
      assert.ok(face !== -1 && beam > face && source > face, "the beam and the mark it leaves from are drawn over the card");
    }
    return { rune: spreading, beam: beaming };
  }

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
    const origin = { x: 695 + 210 / 2, y: 300 + 294 / 2 };
    const seen = { backs: 0, faces: 0, marks: 0, runes: 0, beams: 0 };
    for (let frames = 0; frames < 200 && !reveal.isDone; frames += 1) {
      const context = new FakeContext2D();
      node.draw(context, theme);
      assertBalanced(context);
      assertFinite(context);
      seen.backs += reveal.frame.turn < 0.5 ? 1 : 0;
      seen.faces += reveal.frame.turn >= 0.5 ? 1 : 0;
      seen.marks += context.texts.includes("Cinder Hound") ? 1 : 0;
      const over = assertOverCard(context, reveal.frame, { name: spell.name, origin });
      seen.runes += over.rune ? 1 : 0;
      seen.beams += over.beam ? 1 : 0;
      reveal.update(step);
    }
    assert.ok(seen.beams > 0, "it beams at its target");
    assert.ok(seen.backs > 0, "drawn face-down on the way up");
    assert.ok(seen.faces > 0, "and face-up once it has turned");
    assert.ok(seen.runes > 0, "its rune spreads from it");
    assert.ok(seen.marks > 0, "the target is named once the beam reaches it");
    assert.equal(reveal.isDone, true, "the cast finishes");
    const after = new FakeContext2D();
    node.draw(after, theme);
    const idle = new FakeContext2D();
    new EffectsNode({ presenter: { leavingVisuals: [], floats: [], breakthroughs: [], cardFor: () => null, reveal: null }, layout, blocks: [] }).draw(idle, theme);
    assert.equal(after.calls.length, idle.calls.length, "and leaves nothing behind: the overlay draws what an empty one draws");
  });
});

describe("trigger flare", () => {
  it("kindles a rune over each source, names it, beams to its targets and leaves nothing behind", () => {
    const creature = content.catalog.all().find((definition) => !definition.isSpell);
    const card = { ...creature, instanceId: "c7", damage: 0, summoningSick: false, exhausted: false };
    const flare = new TriggerFlare({ sources: [{ card, origin: { x: 800, y: 600 }, targets: [{ x: 800, y: 120, name: "Bob" }] }], animation: theme.animation });
    const layout = { width: 1600, height: 900, cards: {} };
    const node = new EffectsNode({ presenter: fakePresenter(flare), layout, blocks: [] });
    const seen = { names: 0, marks: 0, struck: false };
    for (let frames = 0; frames < 200 && !flare.isDone; frames += 1) {
      const context = new FakeContext2D();
      node.draw(context, theme);
      assertBalanced(context);
      assertFinite(context);
      seen.names += context.texts.includes(creature.name) ? 1 : 0;
      seen.marks += context.texts.includes("Bob") ? 1 : 0;
      seen.struck ||= flare.hasStruck;
      flare.update(theme.animation.shortMs / 2);
    }
    assert.ok(seen.names > 0, "the source is named over its rune");
    assert.ok(seen.marks > 0, "the target once the beam reaches it");
    assert.equal(seen.struck, true, "it strikes before it fades");
    assert.equal(flare.isDone, true);
    const after = new FakeContext2D();
    node.draw(after, theme);
    const idle = new FakeContext2D();
    new EffectsNode({ presenter: { leavingVisuals: [], floats: [], breakthroughs: [], cardFor: () => null, moment: null }, layout, blocks: [] }).draw(idle, theme);
    assert.equal(after.calls.length, idle.calls.length, "the overlay draws what an empty one draws");
  });
});

describe("turn banner", () => {
  it("sweeps whose turn it is across the table and leaves nothing behind", () => {
    const banner = new TurnBanner({ playerId: "p1", turnNumber: 7, animation: theme.animation });
    const layout = { width: 1600, height: 900, cards: {}, banner: { x: 300, y: 420, width: 1000, height: 56 } };
    const labels = [];
    const node = new EffectsNode({ presenter: { leavingVisuals: [], floats: [], breakthroughs: [], cardFor: () => null, get moment() { return banner.isDone ? null : banner; } }, layout, blocks: [], turnLabel: (playerId) => (labels.push(playerId), { text: "Your turn", mine: true }) });
    let shown = 0;
    for (let frames = 0; frames < 200 && !banner.isDone; frames += 1) {
      const context = new FakeContext2D();
      node.draw(context, theme);
      assertBalanced(context);
      assertFinite(context);
      shown += context.texts.includes("Your turn") && context.texts.includes("Turn 7") ? 1 : 0;
      banner.update(theme.animation.shortMs / 2);
    }
    assert.ok(shown > 0, "the words and the turn number are drawn");
    assert.ok(labels.every((playerId) => playerId === "p1"), "asked for the label of the player whose turn it is");
    assert.equal(banner.isDone, true, "the banner finishes");
  });
});

describe("life crystal pulse", () => {
  it("swells and throws off a ring when life moves, and shakes the plate only for a blow", () => {
    const player = { id: "p1", name: "Alice", life: 12, resources: { current: 0, max: 0 }, librarySize: 20, handSize: 3, graveyard: [] };
    const draw = (kick) => {
      const context = new FakeContext2D();
      new PlayerNode({ player, rect: { x: 0, y: 0, width: 200, height: 184 }, isMe: true, isActive: false, highlight: null, onTap: () => undefined, lifeKick: () => kick }).draw(context, theme);
      assertBalanced(context);
      assertFinite(context);
      return context;
    };
    const count = (context, method) => context.calls.filter((call) => call.method === method).length;
    const still = draw(null);
    const hit = draw({ progress: 0.1, delta: -3 });
    const healed = draw({ progress: 0.1, delta: 2 });
    assert.equal(count(still, "translate"), 0, "no shake at rest");
    assert.equal(count(hit, "translate"), 1, "a blow shakes the plate");
    assert.equal(count(healed, "translate"), 0, "healing does not");
    assert.equal(count(hit, "arc"), count(still, "arc") + 1, "the ring spreading from the crystal");
    assert.ok(hit.texts.includes("12") && healed.texts.includes("12"));
  });
});

describe("game over sequence", () => {
  const crystal = { x: 60, y: 90, radius: 30 };
  const play = (mood, crystals) => {
    const sequence = new GameOverSequence({ mood, title: mood === GameOverMood.TRIUMPH ? "Victory" : "Defeat", subtitle: "Life reached zero.", crystals, animation: theme.animation });
    const node = new GameOverNode({ sequence, width: 1600, height: 900, centreY: 450 });
    const seen = { titles: 0, shards: 0, frames: 0 };
    for (let frames = 0; frames < 400 && !sequence.isDone; frames += 1) {
      const context = new FakeContext2D();
      node.draw(context, theme);
      assertBalanced(context);
      assertFinite(context);
      seen.titles += context.texts.includes(sequence.title) ? 1 : 0;
      seen.shards = Math.max(seen.shards, sequence.shards.length);
      seen.frames += 1;
      sequence.update(theme.animation.shortMs / 2);
    }
    const after = new FakeContext2D();
    node.draw(after, theme);
    return { sequence, seen, after };
  };

  it("cracks the crystal, bursts it into shards, shows the outcome, and ends without leaving anything drawn", () => {
    for (const mood of [GameOverMood.TRIUMPH, GameOverMood.DEFEAT, GameOverMood.NEUTRAL]) {
      const { sequence, seen, after } = play(mood, [crystal]);
      assert.equal(sequence.isDone, true, `${mood} finishes`);
      assert.ok(seen.titles > 0, `${mood}: the outcome is shown`);
      assert.ok(seen.shards > 0, `${mood}: the crystal bursts`);
      assert.deepEqual(after.calls, [], `${mood}: nothing is drawn once it is over`);
      assert.equal(sequence.update(16), false);
    }
  });

  it("shakes only while something strikes, and never without a crystal to break unless a defeat lands", () => {
    const quiet = new GameOverSequence({ mood: GameOverMood.TRIUMPH, title: "Victory", subtitle: "", crystals: [], animation: theme.animation });
    let moved = false;
    for (let step = 0; step < 200 && !quiet.isDone; step += 1) {
      const { x, y } = quiet.shake;
      moved ||= x !== 0 || y !== 0;
      quiet.update(20);
    }
    assert.equal(moved, false, "a conceded victory does not shake");
    assert.deepEqual(play(GameOverMood.TRIUMPH, []).seen.shards, 0, "and throws no shards");
    const heavy = new GameOverSequence({ mood: GameOverMood.DEFEAT, title: "Defeat", subtitle: "", crystals: [], animation: theme.animation });
    let thud = false;
    for (let step = 0; step < 200 && !heavy.isDone; step += 1) {
      thud ||= heavy.shake.y !== 0;
      heavy.update(20);
    }
    assert.equal(thud, true, "a defeat lands with a thud");
  });
});

describe("match result duel", () => {
  const fighter = (name, standing, extra = {}) => Object.freeze({ name, account: null, life: 0, standing, isViewer: false, ...extra });
  const duel = (result, timeMs, { width = 720, height = 260, avatars } = {}) => {
    const node = new MatchResultNode({ width, height, result, clock: () => timeMs });
    const context = new FakeContext2D();
    node.draw(context, avatars === undefined ? theme : { ...theme, avatars });
    assertBalanced(context);
    assertFinite(context);
    return context;
  };
  const won = Object.freeze({ left: fighter("@alice", Standing.WINNER, { account: "alice", life: 7, isViewer: true }), right: fighter("@bob", Standing.LOSER, { account: "bob" }), verdict: "KNOCKOUT", turn: 9 });

  it("names both players under their portraits, crowns the winner and ribbons who won and who lost", () => {
    const settled = duel(won, 5000);
    for (const text of ["@alice", "@bob", "WINNER", "DEFEATED", "VS", "KNOCKOUT", "Turn 9", "YOU", "7", "0"]) {
      assert.ok(settled.texts.includes(text), `shows ${text}`);
    }
    assert.ok(settled.calls.some((call) => call.method === "clip"), "the portraits are cut round");
  });

  it("plays in: the seats first, then the medallion, then the ribbons and the verdict", () => {
    const start = duel(won, 0);
    assert.ok(start.texts.includes("@alice") && start.texts.includes("@bob"), "the seats from the start");
    assert.ok(!start.texts.includes("VS") && !start.texts.includes("WINNER") && !start.texts.includes("KNOCKOUT"), "nothing else yet");
    assert.ok(duel(won, 400).texts.includes("VS"), "the medallion is stamped down");
    assert.ok(!duel(won, 400).texts.includes("WINNER"), "before the ribbons land");
  });

  it("ribbons a draw alike, with no crown", () => {
    const draw = { left: fighter("You", Standing.DRAW), right: fighter("Ember AI", Standing.DRAW), verdict: "DOUBLE KNOCKOUT", turn: 4 };
    const texts = duel(draw, 5000).texts;
    assert.equal(texts.filter((text) => text === "DRAW").length, 2);
    assert.ok(!texts.includes("WINNER") && !texts.includes("DEFEATED"));
  });

  it("asks for the profile pictures of STEEM accounts only, never for a seat without one", () => {
    const asked = [];
    const avatars = { imageFor: (account) => (asked.push(account), null) };
    duel(won, 5000, { avatars });
    assert.deepEqual([...new Set(asked)].sort(), ["alice", "bob"]);
    asked.length = 0;
    duel({ ...won, left: fighter("You", Standing.WINNER), right: fighter("Ember AI", Standing.LOSER) }, 5000, { avatars });
    assert.deepEqual(asked, [], "the local AI has no picture to fetch");
  });

  it("is drawn smaller, all alike, in a phone's dialog", () => {
    const context = duel(won, 5000, { width: 632, height: 190 });
    const scale = context.calls.find((call) => call.method === "scale");
    assert.ok(scale !== undefined && scale.args[0] < 1 && scale.args[0] === scale.args[1]);
  });
});

describe("CardVisual", () => {
  it("lights up when a blow lands, not before, and fades back to rest", () => {
    const visual = new CardVisual("c1", { x: 0, y: 0, width: 100, height: 140, alpha: 1 });
    visual.hit(200, 400);
    assert.equal(visual.flash, 0, "the blow is still on its way");
    assert.equal(visual.isAnimating, true);
    assert.equal(visual.update(100), false, "nothing to redraw while it waits");
    visual.update(100);
    assert.equal(visual.flash, 1, "full strength as it lands");
    visual.update(200);
    assert.ok(visual.flash > 0 && visual.flash < 1, "fading");
    visual.update(200);
    assert.equal(visual.flash, 0);
    assert.equal(visual.isAnimating, false);
  });

  it("stays in its slot while the blow that kills it is on its way, then leaves", () => {
    const slot = { x: 0, y: 0, width: 100, height: 140 };
    const visual = new CardVisual("c1", { ...slot, alpha: 1 });
    visual.moveTo(slot, 0);
    visual.leaveTo({ x: 500, y: 500, width: 10, height: 10 }, 400, 200);
    visual.update(150);
    assert.deepEqual(visual.state, { ...slot, alpha: 1 }, "held in place");
    visual.update(50);
    visual.update(200);
    assert.ok(visual.state.alpha < 1 && visual.state.x > 0, "on its way out after the delay");
    visual.update(400);
    assert.equal(visual.isGone, true);
  });
});

describe("CardNode lift", () => {
  it("eases a tappable card larger around its centre while hovered or focused, never while leaving", () => {
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
    const rising = new FakeContext2D();
    node.draw(rising, theme);
    assert.equal(node.isLifted, true);
    assert.equal(scaleOf(rising), 1, "not grown yet: the raise eases in over the next frames");
    assert.equal(visual.isAnimating, true);
    assert.equal(visual.update(16), true);
    visual.update(1000);
    assert.equal(visual.isAnimating, false, "and settles");
    const lifted = new FakeContext2D();
    node.draw(lifted, theme);
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
