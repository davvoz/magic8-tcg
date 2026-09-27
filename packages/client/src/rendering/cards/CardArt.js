/**
 * Card illustrations. A card with a painted illustration (Theme.illustrations,
 * once its image has loaded) shows it cropped to the art window. Every other
 * card, and every card while its image is still on its way, is drawn
 * procedurally: each faction
 * has a painter that fills the art window with its motif (fire, steel,
 * graveyard, grove, arcane spire, wilderness), and a type emblem (a sigil for creatures, a rune circle for
 * spells) sits on top. Every variable choice (angles, counts, offsets)
 * comes from a hash of the card's identifier, so the same card always
 * looks the same and different cards look different.
 *
 * Painters are a strategy table keyed by faction; unknown factions get the
 * neutral motif, so new content never breaks rendering. Both kinds of art
 * get the same vignette, so painted and procedural cards sit together.
 */
import { hashString, unitSequence } from "@magic8/engine/shared/hash.js";
import { CardType } from "@magic8/engine/domain/cards/CardType.js";
import { mix, shade, withAlpha } from "../theme/color.js";
import { factionTones } from "../theme/Theme.js";
import { radialGradient, roundedRectPath, verticalGradient } from "../ui/drawing.js";
import { polygonPath, starPath } from "../ui/shapes.js";

/** How many seeded values a painter may draw on. */
const VARIATION_COUNT = 16;
/** How dark the vignette gets at the edges: a painting needs less than the procedural motifs. */
const VIGNETTE_EDGE = Object.freeze({ procedural: 0.7, painted: 0.45 });

/**
 * @typedef {Readonly<{ name: string, type: string, faction: string, definitionId?: string, id?: string }>} ArtModel
 * @typedef {{
 *   context: CanvasRenderingContext2D,
 *   area: import("@magic8/engine/shared/geometry.js").Rect,
 *   tones: import("../theme/Theme.js").FactionTones,
 *   variation: readonly number[],
 * }} ArtScope
 */

/**
 * Fills `area` (already clipped by the caller's frame) with the card's art.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {ArtModel} model
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 */
export function paintCardArt(context, theme, model, area) {
  if (area.width <= 0 || area.height <= 0) {
    return;
  }
  const tones = factionTones(theme, model.faction);
  const illustration = illustrationOf(theme, model);
  context.save();
  roundedRectPath(context, area, 3);
  context.clip();
  if (illustration === null) {
    const scope = { context, area, tones, variation: unitSequence(hashString(artSeedOf(model)), VARIATION_COUNT) };
    (MOTIF_PAINTERS[model.faction] ?? paintWildernessMotif)(scope);
    paintEmblem(scope, model.type);
    paintVignette({ context, area, tones }, VIGNETTE_EDGE.procedural);
  } else {
    paintIllustration(context, illustration, area);
    paintVignette({ context, area, tones }, VIGNETTE_EDGE.painted);
  }
  context.restore();
}

/**
 * The card's painted illustration if it has one and it has loaded.
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {ArtModel} model
 */
function illustrationOf(theme, model) {
  const cardId = model.definitionId ?? model.id;
  return cardId === undefined ? null : theme.illustrations?.imageFor(cardId) ?? null;
}

/**
 * The part of an image that covers `area` without distortion: as much of
 * the image as the area's proportions allow, centred on `focus` and slid
 * back inside the image where the focus is near an edge.
 * @param {{ width: number, height: number }} image
 * @param {{ width: number, height: number }} area
 * @param {readonly [number, number]} focus
 * @returns {{ x: number, y: number, width: number, height: number }} in image pixels
 */
export function coverCrop(image, area, [focusX, focusY]) {
  const scale = Math.max(area.width / image.width, area.height / image.height);
  const width = Math.min(image.width, area.width / scale);
  const height = Math.min(image.height, area.height / scale);
  return {
    x: Math.min(Math.max(focusX * image.width - width / 2, 0), image.width - width),
    y: Math.min(Math.max(focusY * image.height - height / 2, 0), image.height - height),
    width,
    height,
  };
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("./CardIllustrations.js").Illustration} illustration
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 */
function paintIllustration(context, { image, focus }, area) {
  const crop = coverCrop(image, area, focus);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, crop.x, crop.y, crop.width, crop.height, area.x, area.y, area.width, area.height);
}

/**
 * The identifier the art varies on: the definition for board cards, the id
 * for catalog cards, the name as a last resort.
 * @param {ArtModel} model
 */
export function artSeedOf(model) {
  return model.definitionId ?? model.id ?? model.name;
}

/** Fire: a hot core low in the frame, flame tongues rising, drifting sparks. */
function paintFlameMotif(scope) {
  const { context, area, tones, variation } = scope;
  const core = { x: area.x + area.width * (0.3 + variation[0] * 0.4), y: area.y + area.height * 0.95 };
  context.fillStyle = verticalGradient(context, area, [[0, tones.dark], [1, shade(tones.base, -0.45)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  context.fillStyle = radialGradient(context, core, area.width * 0.75, [[0, tones.light], [0.35, tones.base], [1, withAlpha(tones.dark, 0)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  const tongues = 4 + Math.floor(variation[1] * 3);
  for (let index = 0; index < tongues; index += 1) {
    const x = area.x + area.width * ((index + 0.5) / tongues) + (variation[2 + index] - 0.5) * area.width * 0.12;
    const height = area.height * (0.45 + variation[8 + (index % 6)] * 0.45);
    paintFlameTongue(context, { x, base: area.y + area.height, width: area.width / tongues * 0.9, height }, index % 2 === 0 ? tones.light : tones.base);
  }
  paintSparks(scope, 6, tones.light);
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, base: number, width: number, height: number }} tongue
 * @param {string} color
 */
function paintFlameTongue(context, { x, base, width, height }, color) {
  const half = width / 2;
  context.beginPath();
  context.moveTo(x - half, base);
  context.bezierCurveTo(x - half, base - height * 0.4, x + half * 0.2, base - height * 0.55, x, base - height);
  context.bezierCurveTo(x - half * 0.2, base - height * 0.55, x + half, base - height * 0.4, x + half, base);
  context.closePath();
  context.fillStyle = withAlpha(color, 0.55);
  context.fill();
}

/** Steel: brushed horizontal bands, a large gear off to one side, rivets in the corners. */
function paintSteelMotif(scope) {
  const { context, area, tones, variation } = scope;
  context.fillStyle = verticalGradient(context, area, [[0, shade(tones.base, -0.2)], [0.5, tones.dark], [1, shade(tones.base, -0.5)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  const bands = 12;
  for (let index = 0; index < bands; index += 1) {
    const y = area.y + (index / bands) * area.height;
    context.fillStyle = withAlpha(index % 2 === 0 ? tones.light : tones.dark, 0.07);
    context.fillRect(area.x, y, area.width, area.height / bands);
  }
  const gear = { x: area.x + area.width * (variation[0] < 0.5 ? 0.24 : 0.76), y: area.y + area.height * (0.35 + variation[1] * 0.3) };
  paintGear(context, gear, area.height * 0.42, { teeth: 8 + Math.floor(variation[2] * 5), color: tones.light });
  for (const [dx, dy] of [[0.06, 0.12], [0.94, 0.12], [0.06, 0.88], [0.94, 0.88]]) {
    context.beginPath();
    context.arc(area.x + area.width * dx, area.y + area.height * dy, Math.max(1.5, area.width * 0.02), 0, Math.PI * 2);
    context.fillStyle = withAlpha(tones.light, 0.7);
    context.fill();
  }
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, y: number }} center
 * @param {number} radius
 * @param {{ teeth: number, color: string }} style
 */
function paintGear(context, center, radius, { teeth, color }) {
  context.save();
  context.strokeStyle = withAlpha(color, 0.5);
  context.lineWidth = Math.max(1.5, radius * 0.16);
  context.beginPath();
  context.arc(center.x, center.y, radius * 0.72, 0, Math.PI * 2);
  context.stroke();
  for (let index = 0; index < teeth; index += 1) {
    const angle = (index / teeth) * Math.PI * 2;
    context.beginPath();
    context.moveTo(center.x + Math.cos(angle) * radius * 0.78, center.y + Math.sin(angle) * radius * 0.78);
    context.lineTo(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius);
    context.stroke();
  }
  context.beginPath();
  context.arc(center.x, center.y, radius * 0.28, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

/** Wilderness: a sky over rolling hills, a low sun or moon, a few stars. */
function paintWildernessMotif(scope) {
  const { context, area, tones, variation } = scope;
  context.fillStyle = verticalGradient(context, area, [[0, tones.dark], [0.6, shade(tones.base, -0.35)], [1, shade(tones.base, -0.55)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  const disc = { x: area.x + area.width * (0.2 + variation[0] * 0.6), y: area.y + area.height * (0.3 + variation[1] * 0.2) };
  context.fillStyle = radialGradient(context, disc, area.height * 0.35, [[0, withAlpha(tones.light, 0.9)], [0.3, withAlpha(tones.light, 0.5)], [1, withAlpha(tones.light, 0)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  for (let layer = 0; layer < 3; layer += 1) {
    const baseline = area.y + area.height * (0.62 + layer * 0.14);
    const bulge = area.height * (0.12 + variation[2 + layer] * 0.12);
    context.beginPath();
    context.moveTo(area.x, area.y + area.height);
    context.lineTo(area.x, baseline);
    context.quadraticCurveTo(area.x + area.width * (0.25 + variation[5 + layer] * 0.5), baseline - bulge, area.x + area.width, baseline + bulge * 0.3);
    context.lineTo(area.x + area.width, area.y + area.height);
    context.closePath();
    context.fillStyle = withAlpha(mix(tones.base, tones.dark, 0.3 + layer * 0.25), 0.85);
    context.fill();
  }
  paintSparks(scope, 5, tones.light);
}

/** Grove: sunlight through a dense canopy, tall trunks against the glow, fireflies low among them. */
function paintGroveMotif(scope) {
  const { context, area, tones, variation } = scope;
  context.fillStyle = verticalGradient(context, area, [[0, shade(tones.dark, -0.3)], [0.5, shade(tones.base, -0.55)], [1, tones.dark]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  const sun = { x: area.x + area.width * (0.25 + variation[0] * 0.5), y: area.y + area.height * (0.28 + variation[1] * 0.2) };
  context.fillStyle = radialGradient(context, sun, area.height * 0.55, [[0, withAlpha(tones.light, 0.85)], [0.25, withAlpha(tones.light, 0.35)], [1, withAlpha(tones.light, 0)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  const trunks = 3 + Math.floor(variation[2] * 3);
  for (let index = 0; index < trunks; index += 1) {
    const x = area.x + area.width * ((index + 0.5) / trunks) + (variation[3 + index] - 0.5) * area.width * 0.14;
    const width = area.width * (0.035 + variation[8 + (index % 6)] * 0.03);
    paintTrunk(context, { x, base: area.y + area.height, width, top: area.y + area.height * (0.05 + variation[9 + (index % 5)] * 0.15) }, mix(tones.dark, tones.base, 0.25));
  }
  paintCanopy(context, area, { color: mix(tones.base, tones.dark, 0.4), count: 5 + Math.floor(variation[4] * 3), variation });
  paintSparks(scope, 6, tones.light);
}

/**
 * A trunk widening toward its foot, with two bare branches near the top.
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, base: number, width: number, top: number }} trunk
 * @param {string} color
 */
function paintTrunk(context, { x, base, width, top }, color) {
  context.beginPath();
  context.moveTo(x - width, base);
  context.lineTo(x - width * 0.5, top);
  context.lineTo(x + width * 0.5, top);
  context.lineTo(x + width, base);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  const reach = (base - top) * 0.3;
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, width * 0.5);
  context.beginPath();
  context.moveTo(x, top + reach);
  context.lineTo(x - reach * 0.9, top + reach * 0.4);
  context.moveTo(x, top + reach * 1.6);
  context.lineTo(x + reach * 0.8, top + reach);
  context.stroke();
}

/**
 * Overlapping leaf clusters hanging from the upper edge of the window.
 * @param {CanvasRenderingContext2D} context
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 * @param {{ color: string, count: number, variation: readonly number[] }} canopy
 */
function paintCanopy(context, area, { color, count, variation }) {
  context.fillStyle = withAlpha(color, 0.9);
  for (let index = 0; index < count; index += 1) {
    const x = area.x + area.width * (index / (count - 1));
    const radius = area.height * (0.12 + variation[(index + 6) % VARIATION_COUNT] * 0.1);
    context.beginPath();
    context.arc(x, area.y + radius * 0.35, radius, 0, Math.PI * 2);
    context.fill();
  }
}

/** Graveyard: a crescent moon over a misty hill of leaning headstones, wisps drifting up. */
function paintGraveMotif(scope) {
  const { context, area, tones, variation } = scope;
  context.fillStyle = verticalGradient(context, area, [[0, shade(tones.dark, -0.4)], [0.55, tones.dark], [1, shade(tones.base, -0.6)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  const moon = { x: area.x + area.width * (0.18 + variation[0] * 0.64), y: area.y + area.height * (0.22 + variation[1] * 0.16) };
  const moonRadius = area.height * 0.16;
  context.fillStyle = radialGradient(context, moon, moonRadius * 3, [[0, withAlpha(tones.light, 0.35)], [1, withAlpha(tones.light, 0)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  paintCrescent(context, moon, moonRadius, tones.light);
  const ground = area.y + area.height * 0.72;
  context.beginPath();
  context.moveTo(area.x, area.y + area.height);
  context.lineTo(area.x, ground + area.height * 0.06);
  context.quadraticCurveTo(area.x + area.width * 0.5, ground - area.height * 0.12, area.x + area.width, ground + area.height * 0.04);
  context.lineTo(area.x + area.width, area.y + area.height);
  context.closePath();
  context.fillStyle = shade(tones.dark, -0.55);
  context.fill();
  const stones = 3 + Math.floor(variation[2] * 3);
  for (let index = 0; index < stones; index += 1) {
    const x = area.x + area.width * ((index + 0.5) / stones) + (variation[3 + index] - 0.5) * area.width * 0.08;
    const height = area.height * (0.12 + variation[8 + (index % 6)] * 0.12);
    paintHeadstone(context, { x, base: ground + area.height * 0.02 - Math.abs(index - stones / 2) * area.height * 0.01, width: area.width * 0.07, height, lean: (variation[9 + (index % 5)] - 0.5) * 0.35 }, mix(tones.base, tones.dark, 0.5));
  }
  context.fillStyle = verticalGradient(context, { ...area, y: ground - area.height * 0.2, height: area.height * 0.3 }, [[0, withAlpha(tones.light, 0)], [0.6, withAlpha(tones.light, 0.16)], [1, withAlpha(tones.light, 0)]]);
  context.fillRect(area.x, ground - area.height * 0.2, area.width, area.height * 0.3);
  paintSparks(scope, 5, tones.light);
}

/** Arcane: a spire against a starlit sky, an orb blazing above its tip inside tilted orbit rings. */
function paintArcaneMotif(scope) {
  const { context, area, tones, variation } = scope;
  context.fillStyle = verticalGradient(context, area, [[0, shade(tones.dark, -0.3)], [0.6, tones.dark], [1, shade(tones.base, -0.5)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  paintSparks(scope, 8, tones.light);
  const spire = { x: area.x + area.width * (0.3 + variation[0] * 0.4), base: area.y + area.height, width: area.width * (0.1 + variation[1] * 0.05), top: area.y + area.height * (0.4 + variation[2] * 0.15) };
  const orb = { x: spire.x, y: spire.top - area.height * (0.12 + variation[3] * 0.06) };
  const orbRadius = area.height * 0.07;
  context.fillStyle = radialGradient(context, orb, orbRadius * 4, [[0, withAlpha(tones.light, 0.7)], [0.3, withAlpha(tones.base, 0.35)], [1, withAlpha(tones.light, 0)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  paintSpire(context, spire, mix(tones.dark, tones.base, 0.35));
  const rings = 2 + Math.floor(variation[4] * 2);
  for (let index = 0; index < rings; index += 1) {
    paintOrbitRing(context, orb, orbRadius * (2 + index * 0.9), { tilt: (variation[5 + index] - 0.5) * Math.PI * 0.8, color: tones.light });
  }
  context.beginPath();
  context.arc(orb.x, orb.y, orbRadius, 0, Math.PI * 2);
  context.fillStyle = withAlpha(tones.light, 0.95);
  context.fill();
}

/**
 * A tapering tower with a pointed roof and a lit window band.
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, base: number, width: number, top: number }} spire
 * @param {string} color
 */
function paintSpire(context, { x, base, width, top }, color) {
  const height = base - top;
  context.beginPath();
  context.moveTo(x - width, base);
  context.lineTo(x - width * 0.6, top + height * 0.2);
  context.lineTo(x, top);
  context.lineTo(x + width * 0.6, top + height * 0.2);
  context.lineTo(x + width, base);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.fillStyle = withAlpha("#ffffff", 0.35);
  context.fillRect(x - width * 0.25, top + height * 0.45, width * 0.5, Math.max(1, height * 0.04));
}

/**
 * A tilted ellipse of light around a point.
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, y: number }} center
 * @param {number} radius
 * @param {{ tilt: number, color: string }} style
 */
function paintOrbitRing(context, center, radius, { tilt, color }) {
  context.save();
  context.translate(center.x, center.y);
  context.rotate(tilt);
  context.beginPath();
  context.ellipse(0, 0, radius, radius * 0.35, 0, 0, Math.PI * 2);
  context.lineWidth = Math.max(1, radius * 0.08);
  context.strokeStyle = withAlpha(color, 0.6);
  context.stroke();
  context.restore();
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, y: number }} center
 * @param {number} radius
 * @param {string} color
 */
function paintCrescent(context, center, radius, color) {
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.arc(center.x + radius * 0.45, center.y - radius * 0.2, radius * 0.85, 0, Math.PI * 2, true);
  context.fillStyle = withAlpha(color, 0.9);
  context.fill("evenodd");
  context.restore();
}

/**
 * A rounded-top slab leaning slightly, sunk into the ground.
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, base: number, width: number, height: number, lean: number }} stone
 * @param {string} color
 */
function paintHeadstone(context, { x, base, width, height, lean }, color) {
  context.save();
  context.translate(x, base);
  context.rotate(lean);
  context.beginPath();
  context.moveTo(-width / 2, 0);
  context.lineTo(-width / 2, -height + width / 2);
  context.arc(0, -height + width / 2, width / 2, Math.PI, 0);
  context.lineTo(width / 2, 0);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.lineWidth = 1;
  context.strokeStyle = withAlpha("#000000", 0.5);
  context.stroke();
  context.restore();
}

/**
 * Small points of light scattered over the upper part of the window.
 * @param {ArtScope} scope
 * @param {number} count
 * @param {string} color
 */
function paintSparks({ context, area, variation }, count, color) {
  for (let index = 0; index < count; index += 1) {
    const u = variation[(index * 3) % VARIATION_COUNT];
    const v = variation[(index * 3 + 1) % VARIATION_COUNT];
    context.beginPath();
    context.arc(area.x + u * area.width, area.y + v * area.height * 0.6, Math.max(0.8, area.width * 0.008), 0, Math.PI * 2);
    context.fillStyle = withAlpha(color, 0.5 + variation[(index * 3 + 2) % VARIATION_COUNT] * 0.5);
    context.fill();
  }
}

/**
 * A creature shows a faceted sigil, a spell a rune circle with rays; both
 * glow faintly so the card reads as an object of power at a glance.
 * @param {ArtScope} scope
 * @param {string} type
 */
function paintEmblem(scope, type) {
  const { context, area, tones, variation } = scope;
  const center = { x: area.x + area.width / 2, y: area.y + area.height * 0.52 };
  const radius = Math.min(area.width, area.height) * 0.36;
  context.save();
  context.shadowColor = withAlpha(tones.light, 0.9);
  context.shadowBlur = radius * 0.6;
  if (type === CardType.CREATURE) {
    const sides = 3 + Math.floor(variation[10] * 5);
    polygonPath(context, center, radius, { sides, rotation: -Math.PI / 2 + variation[11] * Math.PI });
    context.fillStyle = withAlpha(tones.dark, 0.55);
    context.fill();
    context.lineWidth = Math.max(1.2, radius * 0.08);
    context.strokeStyle = withAlpha(tones.light, 0.9);
    context.stroke();
    starPath(context, center, radius * 0.55, { points: sides, innerRatio: 0.4, rotation: -Math.PI / 2 + variation[11] * Math.PI });
    context.fillStyle = withAlpha(tones.light, 0.75);
    context.fill();
  } else {
    paintRuneCircle(context, center, radius, { rays: 6 + Math.floor(variation[12] * 7), color: tones.light });
  }
  context.restore();
}

/**
 * The spell sigil: two concentric circles, rays between them and a four-point
 * star at the centre. Exported because a cast spreads the same rune across
 * the table (EffectsNode), which is what ties the two together.
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, y: number }} center
 * @param {number} radius
 * @param {{ rays: number, color: string }} style
 */
export function paintRuneCircle(context, center, radius, { rays, color }) {
  context.lineWidth = Math.max(1, radius * 0.07);
  context.strokeStyle = withAlpha(color, 0.9);
  context.beginPath();
  context.arc(center.x, center.y, radius * 0.9, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(center.x, center.y, radius * 0.55, 0, Math.PI * 2);
  context.stroke();
  for (let index = 0; index < rays; index += 1) {
    const angle = (index / rays) * Math.PI * 2;
    context.beginPath();
    context.moveTo(center.x + Math.cos(angle) * radius * 0.6, center.y + Math.sin(angle) * radius * 0.6);
    context.lineTo(center.x + Math.cos(angle) * radius * 0.85, center.y + Math.sin(angle) * radius * 0.85);
    context.stroke();
  }
  starPath(context, center, radius * 0.4, { points: 4, innerRatio: 0.3 });
  context.fillStyle = withAlpha(color, 0.85);
  context.fill();
}

/**
 * Darkens the edges so the art sits inside the frame.
 * @param {Pick<ArtScope, "context" | "area" | "tones">} scope
 * @param {number} edgeAlpha
 */
function paintVignette({ context, area, tones }, edgeAlpha) {
  const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  context.fillStyle = radialGradient(context, center, Math.max(area.width, area.height) * 0.7, [[0, withAlpha(tones.dark, 0)], [0.7, withAlpha(tones.dark, 0.15)], [1, withAlpha(tones.dark, edgeAlpha)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
}

/** @type {Readonly<Record<string, (scope: ArtScope) => void>>} */
const MOTIF_PAINTERS = Object.freeze({
  ember: paintFlameMotif,
  iron: paintSteelMotif,
  shadow: paintGraveMotif,
  verdant: paintGroveMotif,
  arcane: paintArcaneMotif,
  neutral: paintWildernessMotif,
});
