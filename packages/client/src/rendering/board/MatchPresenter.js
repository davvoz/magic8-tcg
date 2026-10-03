/**
 * Turns snapshots and engine events into presentation state: one
 * CardVisual per card on the board (tweening toward its layout slot,
 * entering from the owner's hand or library, leaving toward the owner's
 * graveyard), short-lived floating texts for damage and healing, the
 * reveal of a spell the opponent cast (which never reaches the board) and
 * the flare of every other ability that goes off. A blow struck in combat
 * shows where it lands once the attacker's lunge arrives; damage that
 * tramples over a blocker is aimed at the defending player by a crosshair
 * and lands on them once it locks (a breakthrough). A banner marks
 * each new turn; banners, casts and flares play one after another, never
 * over each other.
 *
 * What a cast or an ability does is not held back here: the scene hands
 * each update over in beats (StepBeats), and shows the beat with what it
 * did once the announcement before it `hasStruck`.
 *
 * It never inspects state deltas to guess what happened: events say what
 * happened, the layout says where things belong.
 */
import { CardType } from "@magic8/engine/domain/cards/CardType.js";
import { hashString, unitSequence } from "@magic8/engine/shared/hash.js";
import { GameEventType } from "@magic8/engine/domain/game/GameEventType.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";
import { CardVisual, blowLandsAfter } from "../cards/CardVisual.js";
import { slotsFor } from "./BoardLayout.js";
import { CastReveal } from "./CastReveal.js";
import { HudStack, hudStackCentre, lifeCrystalCentre } from "./PlayerNode.js";
import { TargetRoulette } from "./TargetRoulette.js";
import { TriggerFlare } from "./TriggerFlare.js";
import { TurnBanner } from "./TurnBanner.js";

const MAX_FLOATS = 32;
const FLOAT_RISE = 40;
/**
 * How many casts may be shown at once: the one playing out plus one waiting.
 * The AI can empty its hand in a turn, and a queue of full-length reveals
 * would run long after the board had moved on; the rest stay in the log.
 */
const MAX_REVEALS = 2;
/**
 * How long a cast is held still to be read before it strikes, as a multiple
 * of the long duration; shorter when it is queued behind another, and
 * shortest for our own, which we know already.
 */
const HOLD = Object.freeze({ alone: 3, queued: 1.2, own: 0.5 });
/** How far down a card an anchor sits: floating numbers hang near the top, a target is marked through the middle. */
const FLOAT_DEPTH = 1 / 3;
const CENTRE = 1 / 2;
/** How long a struck card stays lit, and a life crystal keeps pulsing, as multiples of the long duration. */
const FLASH_LONG = 0.8;
const KICK_LONG = 1.2;
/**
 * Damage trampling over a blocker, once the blow on the blocker lands: the
 * crosshair closing on the defending player's life crystal until it locks
 * (`aim`, long durations), the beam crossing from the blocker (`strike`,
 * short durations) — the blow lands on the player as it arrives — and the
 * lock lingering as it fades (`fade`, long durations).
 */
const BREAKTHROUGH = Object.freeze({ aim: 0.7, strike: 1, fade: 0.6 });
/** How long a discarded or milled card is held up, as a multiple of the long duration: long enough to read a face, shorter for a back. */
const SURFACE_HOLD = Object.freeze({ face: 1.2, back: 0.6 });
/** How far a discarded card is pulled out of the hand, toward the table, before it comes up. */
const PULL_OUT = 56;
/**
 * Abilities whose target player is hit in one of their piles rather than in
 * their life: the beam goes to the pile — each card in the hand, the deck.
 * @type {Readonly<Record<string, string>>}
 */
const PILE_EFFECTS = Object.freeze({ discard: HudStack.HAND, mill: HudStack.DECK });
/** Events that take a card from a pile the board may not show — a hand, the library — to the graveyard. @type {ReadonlySet<string>} */
const PILE_LEAVES = new Set([GameEventType.CARD_DISCARDED, GameEventType.CARD_MILLED]);

/**
 * @typedef {Readonly<{ text: string, colorKey: string, x: number, y: number }>} FloatSpec
 * @typedef {{ spec: FloatSpec, ageMs: number, durationMs: number }} Float `ageMs` starts below 0 while the blow it marks is still on its way
 * @typedef {{ delta: number, ageMs: number, durationMs: number }} Kick a life total that just moved, pulsing; `ageMs` as for a Float
 * @typedef {Readonly<{ x: number, y: number }>} Point
 * @typedef {{ from: Point, to: Point, radius: number, ageMs: number, aimMs: number, strikeMs: number, fadeMs: number }} Breakthrough
 *   trample damage on its way from a blocker to the player behind it; `ageMs` as for a Float, 0 when the blow on the blocker lands
 * @typedef {Readonly<{ from: Point, to: Point, radius: number, aim: number, strike: number, alpha: number, elapsedMs: number }>} BreakthroughFrame
 *   `aim` and `strike` run 0 → 1 (the crosshair closing and locking, then the beam crossing), `alpha` fades it out
 * @typedef {CastReveal | TriggerFlare | TurnBanner} Moment
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 * @typedef {import("./BoardLayout.js").BoardLayout} BoardLayout
 * @typedef {import("@magic8/engine/domain/game/GameSnapshot.js").CardView} CardView
 * @typedef {ReturnType<import("../../application/match/MatchSession.js").MatchSession["snapshotFor"]>} Snapshot
 * @typedef {Readonly<Record<string, unknown>>} GameEvent
 */

export class MatchPresenter {
  /** @type {Map<string, CardVisual>} */
  #visuals = new Map();
  /** The layout the board was last shown with: where the hidden hands' backs stood before this update. @type {BoardLayout | null} */
  #layout = null;
  /**
   * Where each card a random discard is about to take from a hidden hand
   * sits among the backs: the crosshair lands there, and the card comes up
   * out of that very back. @type {Map<string, Rect>}
   */
  #doomedBacks = new Map();
  /** @type {Map<string, CardView>} last known card data, kept for leaving cards */
  #cards = new Map();
  /** @type {Float[]} */
  #floats = [];
  /** Life totals that just moved, by player id. @type {Map<string, Kick>} */
  #kicks = new Map();
  /** @type {Breakthrough[]} */
  #breakthroughs = [];
  /** When the blows struck in the last update land, by what they struck. @type {Map<string, number>} */
  #impacts = new Map();
  /**
   * The moments played one after another over the table — the opponent's
   * casts, abilities going off and the turn banners — oldest first; only the first runs.
   * @type {Moment[]}
   */
  #moments = [];
  #animation;

  /** @param {Readonly<Record<string, number>>} animation theme durations (shortMs, mediumMs, longMs) */
  constructor(animation) {
    this.#animation = animation;
  }

  /** @returns {readonly CardVisual[]} visuals still on their way out, drawn above the board */
  get leavingVisuals() {
    return [...this.#visuals.values()].filter((visual) => visual.isLeaving);
  }

  /**
   * @returns {readonly { spec: FloatSpec, progress: number }[]} progress runs 0 → 1 over the float's life; below 0 it is not shown yet
   */
  get floats() {
    return this.#floats.map((float) => ({ spec: float.spec, progress: float.ageMs / float.durationMs }));
  }

  /** @returns {readonly BreakthroughFrame[]} trample damage crossing to the player behind a blocker, once the blow on the blocker has landed */
  get breakthroughs() {
    return this.#breakthroughs
      .filter((breakthrough) => breakthrough.ageMs >= 0)
      .map(({ from, to, radius, ageMs, aimMs, strikeMs, fadeMs }) => {
        const fading = ageMs - aimMs - strikeMs;
        return Object.freeze({
          from,
          to,
          radius,
          aim: Math.min(1, ageMs / aimMs),
          strike: Math.min(1, Math.max(0, (ageMs - aimMs) / strikeMs)),
          alpha: fading <= 0 ? 1 : Math.max(0, 1 - fading / fadeMs),
          elapsedMs: ageMs,
        });
      });
  }

  /** @returns {CastReveal | null} the next of the opponent's casts to be played out — running, or waiting behind a turn banner */
  get reveal() {
    return this.#pendingReveals()[0] ?? null;
  }

  /** @returns {Moment | null} the moment playing over the table right now */
  get moment() {
    return this.#moments[0] ?? null;
  }

  /**
   * How a player's life total is pulsing, if it just moved.
   * @param {string} playerId
   * @returns {{ progress: number, delta: number } | null} progress 0 → 1; null when nothing is showing
   */
  lifeKickFor(playerId) {
    const kick = this.#kicks.get(playerId);
    return kick === undefined || kick.ageMs < 0 ? null : { progress: Math.min(1, kick.ageMs / kick.durationMs), delta: kick.delta };
  }

  /**
   * How long after the last update was shown a blow struck in it lands on
   * `id` (a card or a player): 0 for what was not struck in combat.
   * @param {string} id
   */
  landsAfter(id) {
    return this.#impacts.get(id) ?? 0;
  }

  /** @param {string} instanceId */
  visualFor(instanceId) {
    return this.#visuals.get(instanceId) ?? null;
  }

  /** @param {string} instanceId */
  cardFor(instanceId) {
    return this.#cards.get(instanceId) ?? null;
  }

  /**
   * Reconciles visuals with a new snapshot and its events.
   * @param {Snapshot} snapshot
   * @param {readonly GameEvent[]} events already redacted for this perspective
   * @param {BoardLayout} layout
   * @param {{ animate?: boolean, outcome?: readonly GameEvent[] }} [options] `animate`: false on first display,
   *   where everything snaps into place; `outcome`: what the abilities announced in `events` are going to do (the next beat's events)
   */
  apply(snapshot, events, layout, { animate = true, outcome = [] } = {}) {
    const duration = animate ? this.#animation.mediumMs : 0;
    const impacts = animate ? this.#impactsOf(events) : new Map();
    this.#impacts = impacts;
    for (const player of snapshot.players) {
      for (const card of [...player.battlefield, ...(player.hand ?? [])]) {
        this.#cards.set(card.instanceId, card);
        this.#place(card, layout, duration);
      }
    }
    this.#sendOff(layout, animate ? this.#animation.longMs : 0, impacts);
    if (animate) {
      this.#playOutPileLeaves(events, snapshot, layout, this.#layout ?? layout);
      this.#enqueueEffects(events, snapshot, layout, { impacts, outcome });
    }
    this.#layout = layout;
  }

  /**
   * Cards discarded from a hand or milled from a library would otherwise
   * just be gone — from a hidden hand or the deck, a back fewer or a count
   * lower. Instead they are played out in plain sight: discarded ones are
   * pulled out of the hand together, then one after another each comes up,
   * is held a moment and goes to the graveyard as the next comes up. What
   * left a pile nobody may look into (a hidden hand, the deck) stays a back
   * all the way: the board shows that cards went, not which.
   * @param {readonly GameEvent[]} events
   * @param {Snapshot} snapshot
   * @param {BoardLayout} layout
   * @param {BoardLayout} before the layout the board showed until now
   */
  #playOutPileLeaves(events, snapshot, layout, before) {
    const leaving = events.filter((event) => PILE_LEAVES.has(/** @type {string} */ (event.type)) && typeof event.instanceId === "string");
    for (const playerId of new Set(leaving.map((event) => event.playerId))) {
      const seat = seatOf(layout, playerId);
      if (seat !== null) {
        this.#playOutSeatLeaves(leaving.filter((event) => event.playerId === playerId), snapshot, { seat, backs: seatOf(before, playerId)?.handSlots ?? [], banner: layout.banner, sizes: layout.sizes });
      }
    }
  }

  /**
   * One seat's cards leaving its piles, one after another.
   * @param {readonly GameEvent[]} leaving the seat's CARD_DISCARDED and CARD_MILLED events, in order
   * @param {Snapshot} snapshot
   * @param {{ seat: import("./BoardLayout.js").SeatLayout, backs: readonly Rect[], banner: Rect, sizes: BoardLayout["sizes"] }} where `backs`: the seat's hidden hand as it stood; `sizes`: the board's cards
   */
  #playOutSeatLeaves(leaving, snapshot, { seat, backs, banner, sizes }) {
    const { mediumMs, longMs } = this.#animation;
    const shown = slotsFor(leaving.length, { ...seat.hand, height: Math.max(seat.hand.height, sizes.battlefield.height) }, sizes.battlefield);
    let backsLeft = backs.length;
    let waitMs = 0;
    leaving.forEach((event, index) => {
      const card = findCard(snapshot, event.instanceId);
      if (card === null) {
        return;
      }
      const discarded = event.type === GameEventType.CARD_DISCARDED;
      const seen = this.#visuals.get(card.instanceId);
      backsLeft -= discarded && seen === undefined ? 1 : 0;
      const back = this.#doomedBacks.get(card.instanceId) ?? backs[backsLeft] ?? centredOn(seat.hand, sizes.back);
      this.#doomedBacks.delete(card.instanceId);
      const deck = centredOn(pointAt(hudStackCentre(seat.hud, HudStack.DECK)), sizes.back);
      const hidden = discarded ? back : deck;
      const from = seen === undefined ? hidden : { ...seen.state };
      const visual = seen ?? new CardVisual(card.instanceId, { ...from, alpha: 1 });
      const faceDown = seen === undefined;
      const timing = { pullMs: mediumMs, waitMs, riseMs: mediumMs, holdMs: longMs * (faceDown ? SURFACE_HOLD.back : SURFACE_HOLD.face), leaveMs: longMs, faceDown };
      visual.surfaceThenLeave({ pulled: discarded ? pulledOut(from, banner) : from, shown: shown[index], target: seat.hud }, timing);
      this.#visuals.set(card.instanceId, visual);
      this.#cards.set(card.instanceId, card);
      // The next comes up as this one starts for the graveyard.
      waitMs += timing.riseMs + timing.holdMs;
    });
  }

  /**
   * Cards no longer on the table head for their owner's graveyard — once
   * the blow that sent them there has landed.
   * @param {BoardLayout} layout
   * @param {number} durationMs
   * @param {Map<string, number>} impacts
   */
  #sendOff(layout, durationMs, impacts) {
    for (const [instanceId, visual] of this.#visuals) {
      if (layout.cards[instanceId] === undefined && !visual.isLeaving) {
        visual.leaveTo(this.#graveyardFor(instanceId, layout), durationMs, impacts.get(instanceId) ?? 0);
      }
    }
  }

  /**
   * When each blow struck in combat lands, by the id of what it struck: a
   * creature dealing damage is seen to lunge first, and what it hits reacts
   * when the lunge arrives rather than as it begins. Read before the board
   * is reconciled, while the creatures that dealt the blows still have their slots.
   * @param {readonly GameEvent[]} events
   * @returns {Map<string, number>}
   */
  #impactsOf(events) {
    const landsAfter = blowLandsAfter(this.#animation.shortMs);
    const trampled = this.#trampledIn(events);
    /** @type {Map<string, number>} */
    const impacts = new Map();
    for (const event of events) {
      if (event.type === GameEventType.DAMAGE_DEALT && typeof event.targetId === "string" && this.#canStrike(event.sourceId)) {
        const breaksThrough = trampled.get(/** @type {string} */ (event.sourceId))?.playerId === event.targetId;
        impacts.set(event.targetId, landsAfter + (breaksThrough ? this.#breakthroughMs().aimMs + this.#breakthroughMs().strikeMs : 0));
      }
    }
    return impacts;
  }

  /**
   * The attackers whose damage trampled over their blockers: a creature that
   * struck a creature and then a player in the same blow. By the attacker's
   * id: the last creature it struck, and the player behind it.
   * @param {readonly GameEvent[]} events
   * @returns {Map<string, { blockerId: string, playerId: string }>}
   */
  #trampledIn(events) {
    /** @type {Map<string, string>} */
    const lastStruck = new Map();
    /** @type {Map<string, { blockerId: string, playerId: string }>} */
    const trampled = new Map();
    for (const event of events) {
      if (event.type !== GameEventType.DAMAGE_DEALT || typeof event.sourceId !== "string" || typeof event.targetId !== "string" || !this.#canStrike(event.sourceId)) {
        continue;
      }
      const struck = lastStruck.get(event.sourceId);
      if (this.#cards.has(event.targetId)) {
        lastStruck.set(event.sourceId, event.targetId);
      } else if (struck !== undefined) {
        trampled.set(event.sourceId, { blockerId: struck, playerId: event.targetId });
      }
    }
    return trampled;
  }

  /** How long each part of a breakthrough takes. */
  #breakthroughMs() {
    const { shortMs, longMs } = this.#animation;
    return { aimMs: longMs * BREAKTHROUGH.aim, strikeMs: shortMs * BREAKTHROUGH.strike, fadeMs: longMs * BREAKTHROUGH.fade };
  }

  /**
   * Whether `sourceId` is a creature that can be seen to strike: one the
   * board last showed on the battlefield, in its slot. A spell's damage
   * names the spell as its source, but a spell does not lunge.
   * @param {unknown} sourceId
   */
  #canStrike(sourceId) {
    return typeof sourceId === "string" && this.#cards.get(sourceId)?.zone === ZoneType.BATTLEFIELD && this.#visuals.get(sourceId)?.hasHome === true;
  }

  /**
   * Floats, flashes, lunges, turn banners, the opponent's cast and the
   * flare of the abilities announced.
   * @param {readonly GameEvent[]} events
   * @param {Snapshot} snapshot
   * @param {BoardLayout} layout
   * @param {{ impacts: Map<string, number>, outcome: readonly GameEvent[] }} context
   *   `impacts`: when blows struck in combat land; `outcome`: what the abilities announced are going to do
   */
  #enqueueEffects(events, snapshot, layout, { impacts, outcome }) {
    const revealedId = this.#enqueueReveal(events, snapshot, layout, outcome);
    for (const event of events) {
      this.#showEffectsOf(event, layout, impacts);
    }
    this.#enqueueNudges(events, layout);
    this.#enqueueBreakthroughs(events, layout);
    this.#enqueueTurnBanners(events);
    this.#enqueueFlare(events.filter((event) => event.type === GameEventType.ABILITY_TRIGGERED && event.sourceId !== revealedId), snapshot, layout, outcome);
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether anything moved (a render is needed)
   */
  update(dtMs) {
    let changed = false;
    for (const [instanceId, visual] of this.#visuals) {
      changed = visual.update(dtMs) || changed;
      if (visual.isGone) {
        this.#visuals.delete(instanceId);
        this.#cards.delete(instanceId);
        changed = true;
      }
    }
    if (this.#floats.length > 0) {
      for (const float of this.#floats) {
        float.ageMs += dtMs;
      }
      this.#floats = this.#floats.filter((float) => float.ageMs < float.durationMs);
      changed = true;
    }
    if (this.#breakthroughs.length > 0) {
      for (const breakthrough of this.#breakthroughs) {
        breakthrough.ageMs += dtMs;
      }
      this.#breakthroughs = this.#breakthroughs.filter((breakthrough) => breakthrough.ageMs < breakthrough.aimMs + breakthrough.strikeMs + breakthrough.fadeMs);
      changed = true;
    }
    if (this.#kicks.size > 0) {
      for (const [playerId, kick] of this.#kicks) {
        kick.ageMs += dtMs;
        if (kick.ageMs >= kick.durationMs) {
          this.#kicks.delete(playerId);
        }
      }
      changed = true;
    }
    return this.#advanceMoment(dtMs) || changed;
  }

  get isAnimating() {
    return this.#floats.length > 0 || this.#kicks.size > 0 || this.#breakthroughs.length > 0 || this.#moments.length > 0 || [...this.#visuals.values()].some((visual) => visual.isAnimating);
  }

  /**
   * Whether the board is still playing out what happened — a cast or a turn
   * banner over the table, a card on its way somewhere — so the next move
   * should wait for it. Numbers, flashes and pulses fading out are not waited for.
   */
  get isBusy() {
    return this.#moments.length > 0 || this.#isMoving;
  }

  /**
   * Whether everything announced so far has struck: each moment still
   * queued is a cast or an ability whose beams have reached their targets.
   * The next beat of an update — what they did — can then be shown, while
   * the cast is still held up to be read.
   */
  get hasStruck() {
    return this.#moments.every((moment) => !(moment instanceof TurnBanner) && moment.hasStruck);
  }

  /** Whether a card is on its way somewhere. */
  get #isMoving() {
    return [...this.#visuals.values()].some((visual) => visual.isMoving);
  }

  /** @returns {CastReveal[]} the casts among the queued moments, oldest first */
  #pendingReveals() {
    return /** @type {CastReveal[]} */ (this.#moments.filter((moment) => moment instanceof CastReveal));
  }

  /**
   * Runs the moment at the head of the queue and drops it once it has
   * played out. An ability waits for the board to settle before it goes
   * off — the creature it comes from landed, the blows of combat struck,
   * the fallen gone — so it is not lost among what the last link did.
   * @param {number} dtMs
   * @returns {boolean} whether a render is needed
   */
  #advanceMoment(dtMs) {
    const current = this.#moments[0];
    if (current === undefined || (current instanceof TriggerFlare && !current.hasStarted && this.#isMoving)) {
      return false;
    }
    const changed = current.update(dtMs);
    if (current.isDone) {
      this.#moments.shift();
      return true;
    }
    return changed;
  }

  /**
   * @param {CardView} card
   * @param {BoardLayout} layout
   * @param {number} duration
   */
  #place(card, layout, duration) {
    const target = layout.cards[card.instanceId];
    const existing = this.#visuals.get(card.instanceId);
    if (existing !== undefined) {
      existing.moveTo(target, duration);
      return;
    }
    const origin = this.#originFor(card, layout);
    const visual = new CardVisual(card.instanceId, { ...origin, alpha: duration === 0 ? 1 : 0.2 });
    visual.moveTo(target, duration);
    this.#visuals.set(card.instanceId, visual);
  }

  /**
   * New cards come from the controller's hand (opponent plays) or from the
   * owner's HUD, which stands for the library (draws).
   * @param {CardView} card
   * @param {BoardLayout} layout
   */
  #originFor(card, layout) {
    const seat = card.controllerId === layout.me.id ? layout.me : layout.opponent;
    const fromHand = card.zone === ZoneType.BATTLEFIELD && seat === layout.opponent;
    const area = fromHand ? seat.hand : seat.hud;
    const size = layout.cards[card.instanceId];
    return { x: area.x + (area.width - size.width) / 2, y: area.y + (area.height - size.height) / 2, width: size.width, height: size.height };
  }

  /**
   * @param {string} instanceId
   * @param {BoardLayout} layout
   */
  #graveyardFor(instanceId, layout) {
    const card = this.#cards.get(instanceId);
    return card !== undefined && card.controllerId === layout.opponent.id ? layout.opponent.hud : layout.me.hud;
  }

  /**
   * A spell is played from a hand straight to the graveyard: nothing of it
   * ever stands on the table. So it is given a moment of its own: held up,
   * large, over the middle of the board, where its beams leave from, and
   * sunk into its caster's graveyard only once they have struck. The
   * opponent's comes out of a hidden hand face-down and is held to be read
   * before it aims; our own leaves our hand face-up — we chose it — and
   * aims almost at once.
   * @param {readonly GameEvent[]} events
   * @param {Snapshot} snapshot
   * @param {BoardLayout} layout
   * @param {readonly GameEvent[]} outcome what the spell is going to do
   * @returns {string | null} the instance id of the revealed spell; null when nothing was revealed
   */
  #enqueueReveal(events, snapshot, layout, outcome) {
    const queued = this.#pendingReveals().length;
    // One command plays one card, so a batch of events carries at most one cast.
    const played = queued >= MAX_REVEALS ? undefined : events.find(isSpellCast);
    const card = played === undefined ? null : findCard(snapshot, played.instanceId);
    const caster = snapshot.players.find((player) => player.id === played?.playerId);
    const seat = seatOf(layout, played?.playerId);
    if (card === null || caster === undefined || seat === null) {
      return null;
    }
    const inHand = this.#visuals.get(card.instanceId);
    const from = inHand === undefined ? centredOn(seat.hand, layout.sizes.back) : { ...inHand.state };
    // The card now travels as the cast: it does not also fade from the hand.
    this.#visuals.delete(card.instanceId);
    this.#cards.delete(card.instanceId);
    const faceUp = inHand !== undefined;
    /** @type {number} */
    let hold = queued === 0 ? HOLD.alone : HOLD.queued;
    hold = faceUp ? HOLD.own : hold;
    const { targets, roulette } = this.#aimedAt(card.instanceId, aimOf(card.instanceId, events), { snapshot, layout, outcome });
    const caption = faceUp ? "You cast" : `${caster.name} casts`;
    this.#moments.push(new CastReveal({ card, caption, targets, roulette, from, at: centredOn(layout.banner, layout.sizes.reveal), to: seat.hud, faceUp, animation: this.#animation, holdMs: this.#animation.longMs * hold }));
    return card.instanceId;
  }

  /**
   * One flare for the abilities announced together, a rune for each card
   * they come from: over the card where it stands or where it fell, over
   * the middle of the table for a spell. Nothing is flared for a card the
   * board never showed.
   * @param {readonly GameEvent[]} triggered the ABILITY_TRIGGERED events, in order
   * @param {Snapshot} snapshot
   * @param {BoardLayout} layout
   * @param {readonly GameEvent[]} outcome what the abilities are going to do
   */
  #enqueueFlare(triggered, snapshot, layout, outcome) {
    const sourceIds = new Set(triggered.map((event) => event.sourceId).filter((id) => typeof id === "string"));
    const sources = [...sourceIds].flatMap((sourceId) => {
      const card = findCard(snapshot, sourceId) ?? this.#cards.get(/** @type {string} */ (sourceId)) ?? null;
      const origin = card === null ? null : this.#flareOriginFor(card, layout);
      return card === null || origin === null ? [] : [Object.freeze({ card, origin: Object.freeze(origin), ...this.#aimedAt(card.instanceId, aimOf(card.instanceId, triggered), { snapshot, layout, outcome }) })];
    });
    if (sources.length > 0) {
      this.#moments.push(new TriggerFlare({ sources, animation: this.#animation }));
    }
  }

  /**
   * Where an ability's rune kindles: a spell over the middle of the table,
   * a creature where it stands (or where it last stood), else over its
   * controller's seat.
   * @param {CardView} card
   * @param {BoardLayout} layout
   */
  #flareOriginFor(card, layout) {
    if (card.type === CardType.SPELL) {
      return centreOf(layout.banner);
    }
    return this.#anchorFor(card.instanceId, layout, CENTRE) ?? this.#anchorFor(card.controllerId, layout, CENTRE);
  }

  /**
   * A banner for each turn that starts. Only the newest waits its turn: one
   * still queued behind a cast is stale by the time the next turn begins.
   * @param {readonly GameEvent[]} events
   */
  #enqueueTurnBanners(events) {
    for (const event of events) {
      if (event.type !== GameEventType.TURN_STARTED || typeof event.playerId !== "string") {
        continue;
      }
      this.#moments = this.#moments.filter((moment, index) => index === 0 || !(moment instanceof TurnBanner));
      this.#moments.push(new TurnBanner({ playerId: event.playerId, turnNumber: Number(event.turnNumber), animation: this.#animation }));
    }
  }

  /**
   * Where a cast's or an ability's targets stand and what they are called,
   * fixed now rather than read later: a creature it kills is on its way off
   * the board by the time the beams strike.
   * @param {readonly string[]} targetIds
   * @param {Snapshot} snapshot
   * @param {BoardLayout} layout
   * @returns {readonly import("./CastReveal.js").CastTarget[]}
   */
  #targetsOf(targetIds, snapshot, layout) {
    return targetIds.flatMap((id) => {
      const anchor = this.#anchorFor(id, layout, CENTRE);
      const name = nameOf(id, snapshot);
      return anchor === null || name === null ? [] : [Object.freeze({ ...anchor, name })];
    });
  }

  /**
   * Where the beams of a cast or an ability go: to what it was aimed at,
   * but for a player hit in one of their piles, to the pile — and for a
   * random discard, to the very cards it takes, drawn by a crosshair.
   * @param {string} sourceId the card whose cast or ability it is
   * @param {Aim} aim
   * @param {{ snapshot: Snapshot, layout: BoardLayout, outcome: readonly GameEvent[] }} context
   * @returns {{ targets: readonly import("./CastReveal.js").CastTarget[], roulette: TargetRoulette | null }}
   */
  #aimedAt(sourceId, aim, { snapshot, layout, outcome }) {
    const piles = [...aim.piles].map(([playerId, pile]) => this.#pileAim({ sourceId, playerId, pile }, { snapshot, layout, outcome }));
    return Object.freeze({
      targets: Object.freeze([...this.#targetsOf(aim.ids, snapshot, layout), ...piles.flatMap((entry) => entry.targets)]),
      roulette: piles.find((entry) => entry.roulette !== null)?.roulette ?? null,
    });
  }

  /**
   * A player's pile as a target. A discard whose cards are known goes to
   * those cards, through a crosshair that draws them from the whole hand;
   * one that takes nothing, to every card in the hand, named once under the
   * middle one; a mill, to the deck.
   * @param {{ sourceId: string, playerId: string, pile: string }} aim `pile`: a HudStack
   * @param {{ snapshot: Snapshot, layout: BoardLayout, outcome: readonly GameEvent[] }} context
   * @returns {{ targets: import("./CastReveal.js").CastTarget[], roulette: TargetRoulette | null }}
   */
  #pileAim({ sourceId, playerId, pile }, { snapshot, layout, outcome }) {
    const seat = seatOf(layout, playerId);
    const player = snapshot.players.find((candidate) => candidate.id === playerId);
    if (seat === null || player === undefined) {
      return { targets: [], roulette: null };
    }
    const label = `${player.name}'s ${pile}`;
    const hidden = seat.handSlots.length > 0;
    const hand = hidden ? [] : (player.hand ?? []).filter((card) => layout.cards[card.instanceId] !== undefined);
    const slots = hidden ? seat.handSlots : hand.map((card) => layout.cards[card.instanceId]);
    if (pile !== HudStack.HAND || slots.length === 0) {
      return { targets: [Object.freeze({ ...hudStackCentre(seat.hud, pile), name: label })], roulette: null };
    }
    const candidates = slots.map((slot) => Object.freeze(centreOf(slot)));
    const doomed = outcome.filter((event) => event.type === GameEventType.CARD_DISCARDED && event.playerId === playerId).map((event) => /** @type {string} */ (event.instanceId));
    const picks = hidden ? drawBacks(doomed, slots.length) : doomed.map((id) => hand.findIndex((card) => card.instanceId === id)).filter((index) => index !== -1);
    if (picks.length === 0) {
      const named = Math.floor((candidates.length - 1) / 2);
      return { targets: candidates.map((point, index) => Object.freeze({ ...point, name: index === named ? label : "" })), roulette: null };
    }
    if (hidden) {
      doomed.forEach((id, index) => this.#doomedBacks.set(id, slots[picks[index]]));
    }
    /** A card of my own hand by its name; a hidden hand's have none yet, so the hand is named, once. */
    const targetName = (/** @type {number} */ index, /** @type {number} */ order) => {
      if (!hidden) {
        return hand[index].name;
      }
      return order === 0 ? label : "";
    };
    const targets = picks.map((index, order) => Object.freeze({ ...candidates[index], name: targetName(index, order) }));
    return { targets, roulette: new TargetRoulette({ candidates, picks, seed: `${sourceId}:${doomed.join(",")}`, animation: this.#animation }) };
  }

  /**
   * What an event shows on the board: its floating number, the flash of a
   * struck card, the pulse of a life total.
   * @param {GameEvent} event
   * @param {BoardLayout} layout
   * @param {Map<string, number>} impacts when blows struck in combat land, by what they struck
   */
  #showEffectsOf(event, layout, impacts) {
    const subject = typeof event.targetId === "string" ? event.targetId : event.playerId;
    const delayMs = typeof subject === "string" ? impacts.get(subject) ?? 0 : 0;
    const spec = this.#floatSpecFor(event, layout);
    if (spec !== null) {
      this.#pushFloat(spec, delayMs);
    }
    const struck = event.type === GameEventType.DAMAGE_DEALT && typeof event.targetId === "string" ? this.#visuals.get(event.targetId) : undefined;
    struck?.hit(delayMs, this.#animation.longMs * FLASH_LONG);
    if (event.type === GameEventType.LIFE_CHANGED && typeof event.playerId === "string" && event.delta !== 0) {
      this.#kicks.set(event.playerId, { delta: Number(event.delta), ageMs: -delayMs, durationMs: this.#animation.longMs * KICK_LONG });
    }
  }

  /**
   * The floating text an event shows.
   * @param {GameEvent} event
   * @param {BoardLayout} layout
   * @returns {FloatSpec | null}
   */
  #floatSpecFor(event, layout) {
    const build = FLOAT_BUILDERS[/** @type {string} */ (event.type)];
    if (build === undefined) {
      return null;
    }
    const { id, text, colorKey } = build(event);
    const anchor = typeof id === "string" ? this.#anchorFor(id, layout) : null;
    return anchor === null ? null : Object.freeze({ text, colorKey, x: anchor.x, y: anchor.y });
  }

  /**
   * @param {FloatSpec} spec
   * @param {number} [delayMs] how long until it appears
   */
  #pushFloat(spec, delayMs = 0) {
    if (this.#floats.length < MAX_FLOATS) {
      this.#floats.push({ spec, ageMs: -delayMs, durationMs: this.#animation.longMs * 2 });
    }
  }

  /**
   * A creature that dealt damage attacks its target: draws back, lunges and
   * returns. One lunge per blow, at the first thing it strikes: what
   * tramples on to the player behind a blocker goes as a breakthrough.
   * @param {readonly GameEvent[]} events
   * @param {BoardLayout} layout
   */
  #enqueueNudges(events, layout) {
    /** @type {Set<string>} */
    const lunged = new Set();
    for (const event of events) {
      if (event.type !== GameEventType.DAMAGE_DEALT || typeof event.targetId !== "string" || !this.#canStrike(event.sourceId)) {
        continue;
      }
      const sourceId = /** @type {string} */ (event.sourceId);
      const target = this.#anchorFor(event.targetId, layout);
      if (target !== null && !lunged.has(sourceId)) {
        lunged.add(sourceId);
        /** @type {CardVisual} */ (this.#visuals.get(sourceId)).nudgeToward(target, this.#animation.shortMs);
      }
    }
  }

  /**
   * Trample damage: as the blow on the blocker lands, a crosshair closes on
   * the life crystal of the player behind it and locks, then a beam crosses
   * from the blocker and the damage lands on the player.
   * @param {readonly GameEvent[]} events
   * @param {BoardLayout} layout
   */
  #enqueueBreakthroughs(events, layout) {
    const landsAfter = blowLandsAfter(this.#animation.shortMs);
    for (const { blockerId, playerId } of this.#trampledIn(events).values()) {
      const from = this.#anchorFor(blockerId, layout, CENTRE);
      const seat = seatOf(layout, playerId);
      if (from === null || seat === null) {
        continue;
      }
      const crystal = lifeCrystalCentre(seat.hud);
      this.#breakthroughs.push({ from, to: { x: crystal.x, y: crystal.y }, radius: crystal.radius, ageMs: -landsAfter, ...this.#breakthroughMs() });
    }
  }

  /**
   * Where something that happened to `id` is marked: the card's slot, else
   * the card's last drawn position (it may have just died), else the
   * player's HUD. `depth` is how far down the card the point sits — floats
   * hang near the top, a target is marked through the middle.
   * @param {string} id
   * @param {BoardLayout} layout
   * @param {number} [depth]
   */
  #anchorFor(id, layout, depth = FLOAT_DEPTH) {
    const slot = layout.cards[id] ?? this.#visuals.get(id)?.state;
    if (slot !== undefined) {
      return { x: slot.x + slot.width / 2, y: slot.y + slot.height * depth };
    }
    const seat = [layout.me, layout.opponent].find((candidate) => candidate.id === id);
    return seat === undefined ? null : { x: seat.hud.x + seat.hud.width / 2, y: seat.hud.y + seat.hud.height / 2 };
  }
}

/** @type {Readonly<Record<string, (event: Readonly<Record<string, unknown>>) => { id: unknown, text: string, colorKey: string }>>} */
const FLOAT_BUILDERS = Object.freeze({
  [GameEventType.DAMAGE_DEALT]: (event) => ({ id: event.targetId, text: `-${event.amount}`, colorKey: "danger" }),
  [GameEventType.HEALED]: (event) => ({ id: event.targetId, text: `+${event.amount}`, colorKey: "success" }),
  [GameEventType.FATIGUE_DAMAGE]: (event) => ({ id: event.playerId, text: `-${event.amount} fatigue`, colorKey: "danger" }),
});

/**
 * A card played that did not land on the battlefield: a spell.
 * @param {Readonly<Record<string, unknown>>} event
 */
function isSpellCast(event) {
  return event.type === GameEventType.CARD_PLAYED && event.zone !== ZoneType.BATTLEFIELD;
}

/**
 * @typedef {{ ids: string[], piles: Map<string, string> }} Aim what a card was aimed at, each once:
 *   `piles` the players hit in one of their piles (by id, the HudStack), `ids` everything else
 */

/**
 * What a card was aimed at as it was played and as its abilities were announced.
 * @param {string} instanceId
 * @param {readonly Readonly<Record<string, unknown>>[]} events
 * @returns {Aim}
 */
function aimOf(instanceId, events) {
  const aiming = events.filter((event) => (event.type === GameEventType.CARD_PLAYED && event.instanceId === instanceId) || (event.type === GameEventType.ABILITY_TRIGGERED && event.sourceId === instanceId));
  /** @type {Map<string, string>} */
  const piles = new Map();
  for (const event of aiming) {
    const pile = event.type === GameEventType.ABILITY_TRIGGERED ? PILE_EFFECTS[/** @type {string} */ (event.effect)] : undefined;
    if (pile !== undefined) {
      /** @type {readonly string[]} */ (event.targetIds ?? []).forEach((id) => piles.set(id, pile));
    }
  }
  const ids = new Set(aiming.flatMap((event) => /** @type {readonly string[]} */ (event.targetIds ?? [])));
  return { ids: [...ids].filter((id) => !piles.has(id)), piles };
}

/**
 * Which backs of a hidden hand the cards a random discard takes are shown to
 * come out of: distinct, spread as chance would have it, and the same every
 * time for the same cards.
 * @param {readonly string[]} doomed the discarded cards' ids, in order
 * @param {number} backs how many backs the hand shows
 * @returns {number[]} one index into the backs per card, while there are backs left
 */
function drawBacks(doomed, backs) {
  const free = Array.from({ length: backs }, (_, index) => index);
  const draws = unitSequence(hashString(doomed.join(",")), doomed.length);
  return doomed.slice(0, backs).map((_, index) => free.splice(Math.floor(draws[index] * free.length), 1)[0]);
}

/**
 * @param {BoardLayout} layout
 * @param {unknown} playerId
 * @returns {import("./BoardLayout.js").SeatLayout | null}
 */
function seatOf(layout, playerId) {
  return [layout.me, layout.opponent].find((seat) => seat.id === playerId) ?? null;
}

/**
 * `card` drawn a little way out of its hand, toward the middle of the table.
 * @param {Rect} card
 * @param {Rect} banner the strip between the battlefields
 * @returns {Rect}
 */
function pulledOut(card, banner) {
  const towardTable = Math.sign(banner.y + banner.height / 2 - (card.y + card.height / 2));
  return { ...card, y: card.y + towardTable * PULL_OUT };
}

/**
 * @param {{ x: number, y: number }} point
 * @returns {Rect} an empty rectangle at `point`
 */
function pointAt(point) {
  return { ...point, width: 0, height: 0 };
}

/**
 * What to call a target: a player by name, a card by its printed name.
 * @param {string} id
 * @param {Snapshot} snapshot
 * @returns {string | null}
 */
function nameOf(id, snapshot) {
  const player = snapshot.players.find((candidate) => candidate.id === id);
  return player?.name ?? findCard(snapshot, id)?.name ?? null;
}

/**
 * Looks a card up wherever it now sits; a spell has already reached the graveyard.
 * @param {Snapshot} snapshot
 * @param {unknown} instanceId
 * @returns {CardView | null}
 */
function findCard(snapshot, instanceId) {
  for (const player of snapshot.players) {
    const card = [...player.battlefield, ...player.graveyard, ...(player.hand ?? [])].find((candidate) => candidate.instanceId === instanceId);
    if (card !== undefined) {
      return card;
    }
  }
  return null;
}

/**
 * @param {Rect} area
 * @returns {{ x: number, y: number }}
 */
function centreOf(area) {
  return { x: area.x + area.width / 2, y: area.y + area.height / 2 };
}

/**
 * @param {Rect} area
 * @param {{ width: number, height: number }} size
 * @returns {Rect}
 */
function centredOn(area, size) {
  return { x: area.x + (area.width - size.width) / 2, y: area.y + (area.height - size.height) / 2, width: size.width, height: size.height };
}

/** Vertical offset of a float at `progress` in [0, 1]. */
export function floatOffset(progress) {
  return -FLOAT_RISE * progress;
}

