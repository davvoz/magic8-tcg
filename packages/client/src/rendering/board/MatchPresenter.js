/**
 * Turns snapshots and engine events into presentation state: one
 * CardVisual per card on the board (tweening toward its layout slot,
 * entering from the owner's hand or library, leaving toward the owner's
 * graveyard), short-lived floating texts for damage and healing, and the
 * reveal of a spell the opponent cast (which never reaches the board).
 * What such a spell does — its floating numbers and the life it moves — is
 * held back until the reveal strikes its targets, so the numbers change
 * when the card is seen to hit, not while it is still face-down in a hand.
 * In the same way a blow struck in combat shows where it lands once the
 * attacker's lunge arrives. A banner marks each new turn; banners and casts
 * play one after another, never over each other.
 *
 * It never inspects state deltas to guess what happened: events say what
 * happened, the layout says where things belong.
 */
import { GameEventType } from "@magic8/engine/domain/game/GameEventType.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";
import { CardVisual, blowLandsAfter } from "../cards/CardVisual.js";
import { CARD_SIZE } from "./BoardLayout.js";
import { CastReveal } from "./CastReveal.js";
import { TurnBanner } from "./TurnBanner.js";

const MAX_FLOATS = 32;
const FLOAT_RISE = 40;
/**
 * How many casts may be shown at once: the one playing out plus one waiting.
 * The AI can empty its hand in a turn, and a queue of full-length reveals
 * would run long after the board had moved on; the rest stay in the log.
 */
const MAX_REVEALS = 2;
/** How long a cast is held still to be read, as a multiple of the long duration; shorter when it is queued behind another. */
const HOLD = Object.freeze({ alone: 3, queued: 1.2 });
/** Size a revealed card is held at: the board card's proportions, 1.6 times over. */
const REVEAL_SIZE = Object.freeze({ width: 210, height: 294 });
/** How far down a card an anchor sits: floating numbers hang near the top, a target is marked through the middle. */
const FLOAT_DEPTH = 1 / 3;
const CENTRE = 1 / 2;
/** How long a struck card stays lit, and a life crystal keeps pulsing, as multiples of the long duration. */
const FLASH_LONG = 0.8;
const KICK_LONG = 1.2;

/**
 * @typedef {Readonly<{ text: string, colorKey: string, x: number, y: number }>} FloatSpec
 * @typedef {{ spec: FloatSpec, ageMs: number, durationMs: number }} Float `ageMs` starts below 0 while the blow it marks is still on its way
 * @typedef {{ delta: number, ageMs: number, durationMs: number }} Kick a life total that just moved, pulsing; `ageMs` as for a Float
 * @typedef {{ cast: CastReveal, release: (() => void)[], lives: Map<string, number>, struck: boolean }} PendingReveal
 *   what the cast did — its effects on the board, and each player's life as it stood before — held until `struck`
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 * @typedef {import("./BoardLayout.js").BoardLayout} BoardLayout
 * @typedef {import("@magic8/engine/domain/game/GameSnapshot.js").CardView} CardView
 * @typedef {ReturnType<import("../../application/match/MatchSession.js").MatchSession["snapshotFor"]>} Snapshot
 * @typedef {Readonly<Record<string, unknown>>} GameEvent
 */

export class MatchPresenter {
  /** @type {Map<string, CardVisual>} */
  #visuals = new Map();
  /** @type {Map<string, CardView>} last known card data, kept for leaving cards */
  #cards = new Map();
  /** @type {Float[]} */
  #floats = [];
  /** Life totals that just moved, by player id. @type {Map<string, Kick>} */
  #kicks = new Map();
  /**
   * The moments played one after another over the middle of the table —
   * the opponent's casts and the turn banners — oldest first; only the first runs.
   * @type {(PendingReveal | TurnBanner)[]}
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

  /** @returns {CastReveal | null} the next of the opponent's casts to be played out — running, or waiting behind a turn banner */
  get reveal() {
    return this.#pendingReveals()[0]?.cast ?? null;
  }

  /** @returns {CastReveal | TurnBanner | null} the moment playing over the table right now */
  get moment() {
    const head = this.#moments[0];
    if (head === undefined) {
      return null;
    }
    return head instanceof TurnBanner ? head : head.cast;
  }

  /**
   * The life to show for a player: what it was before a revealed cast hit
   * them until the reveal strikes, else the snapshot's.
   * @param {Readonly<{ id: string, life: number }>} player
   */
  lifeFor(player) {
    const held = this.#pendingReveals().find((pending) => !pending.struck && pending.lives.has(player.id));
    return held === undefined ? player.life : /** @type {number} */ (held.lives.get(player.id));
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
   * @param {boolean} animate false on first display: everything snaps into place
   */
  apply(snapshot, events, layout, animate = true) {
    const duration = animate ? this.#animation.mediumMs : 0;
    const impacts = animate ? this.#impactsOf(events) : new Map();
    for (const player of snapshot.players) {
      for (const card of [...player.battlefield, ...(player.hand ?? [])]) {
        this.#cards.set(card.instanceId, card);
        this.#place(card, layout, duration);
      }
    }
    this.#sendOff(layout, animate ? this.#animation.longMs : 0, impacts);
    if (animate) {
      this.#enqueueEffects(events, snapshot, layout, impacts);
    }
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
    /** @type {Map<string, number>} */
    const impacts = new Map();
    for (const event of events) {
      if (event.type === GameEventType.DAMAGE_DEALT && typeof event.targetId === "string" && this.#canStrike(event.sourceId)) {
        impacts.set(event.targetId, landsAfter);
      }
    }
    return impacts;
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
   * Floats, flashes, lunges, turn banners and the opponent's cast; what the
   * cast did waits for its reveal to strike.
   * @param {readonly GameEvent[]} events
   * @param {Snapshot} snapshot
   * @param {BoardLayout} layout
   * @param {Map<string, number>} impacts
   */
  #enqueueEffects(events, snapshot, layout, impacts) {
    const castAt = this.#enqueueReveal(events, snapshot, layout);
    for (const event of castAt === -1 ? events : events.slice(0, castAt)) {
      this.#effectsOf(event, layout, impacts).forEach((show) => show());
    }
    if (castAt !== -1) {
      this.#holdEffects(/** @type {PendingReveal} */ (this.#pendingReveals().at(-1)), events.slice(castAt + 1), layout);
    }
    this.#enqueueNudges(events, layout);
    this.#enqueueTurnBanners(events);
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
    return this.#floats.length > 0 || this.#kicks.size > 0 || this.#moments.length > 0 || [...this.#visuals.values()].some((visual) => visual.isAnimating);
  }

  /**
   * Whether the board is still playing out what happened — a cast or a turn
   * banner over the table, a card on its way somewhere — so the next move
   * should wait for it. Numbers, flashes and pulses fading out are not waited for.
   */
  get isBusy() {
    return this.#moments.length > 0 || [...this.#visuals.values()].some((visual) => visual.isMoving);
  }

  /** @returns {PendingReveal[]} the casts among the queued moments, oldest first */
  #pendingReveals() {
    return /** @type {PendingReveal[]} */ (this.#moments.filter((moment) => !(moment instanceof TurnBanner)));
  }

  /**
   * Runs the moment at the head of the queue and drops it once it has
   * played out; a cast lets loose what it did as it strikes.
   * @param {number} dtMs
   * @returns {boolean} whether a render is needed
   */
  #advanceMoment(dtMs) {
    const current = this.#moments[0];
    if (current === undefined) {
      return false;
    }
    if (current instanceof TurnBanner) {
      const changed = current.update(dtMs);
      if (current.isDone) {
        this.#moments.shift();
      }
      return changed;
    }
    let changed = current.cast.update(dtMs);
    if (!current.struck && (current.cast.frame.strike >= 1 || current.cast.isDone)) {
      current.struck = true;
      current.release.forEach((show) => show());
      changed = true;
    }
    if (current.cast.isDone) {
      this.#moments.shift();
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
   * A spell the opponent casts is played from a hidden hand straight to the
   * graveyard: nothing of it ever appears on the table, so without this the
   * only trace is a log line. The card is held up, large, over the middle of
   * the board. Our own casts need no reveal: we chose them.
   * @param {readonly GameEvent[]} events
   * @param {Snapshot} snapshot
   * @param {BoardLayout} layout
   * @returns {number} where the revealed cast's CARD_PLAYED sits in `events`; -1 when nothing was revealed
   */
  #enqueueReveal(events, snapshot, layout) {
    const opponent = snapshot.players.find((player) => player.id === layout.opponent.id);
    const queued = this.#pendingReveals().length;
    if (opponent === undefined || queued >= MAX_REVEALS) {
      return -1;
    }
    // One command plays one card, so a batch of events carries at most one cast.
    const castAt = events.findIndex((event) => isOpponentCast(event, opponent.id));
    const card = castAt === -1 ? null : findCard(snapshot, events[castAt].instanceId);
    if (card === null) {
      return -1;
    }
    const holdMs = this.#animation.longMs * (queued === 0 ? HOLD.alone : HOLD.queued);
    const targets = this.#targetsOf(events[castAt], snapshot, layout);
    const cast = new CastReveal({ card, caption: `${opponent.name} casts`, targets, ...revealPathFor(layout), animation: this.#animation, holdMs });
    this.#moments.push({ cast, release: [], lives: new Map(), struck: false });
    return castAt;
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
   * Holds back what a revealed cast did until it strikes: its effects on the
   * board, and each player's life as it stood before the cast moved it.
   * @param {PendingReveal} pending
   * @param {readonly GameEvent[]} effects the events that followed the cast
   * @param {BoardLayout} layout
   */
  #holdEffects(pending, effects, layout) {
    for (const event of effects) {
      pending.release.push(...this.#effectsOf(event, layout, new Map()));
      const playerId = /** @type {string} */ (event.playerId);
      if (event.type === GameEventType.LIFE_CHANGED && !pending.lives.has(playerId)) {
        pending.lives.set(playerId, /** @type {number} */ (event.life) - /** @type {number} */ (event.delta));
      }
    }
  }

  /**
   * Where the spell's targets stand and what they are called, fixed now
   * rather than read later: a creature it kills is already on its way off
   * the board, and gone from the layout within the second.
   * @param {GameEvent} event
   * @param {Snapshot} snapshot
   * @param {BoardLayout} layout
   * @returns {readonly import("./CastReveal.js").CastTarget[]}
   */
  #targetsOf(event, snapshot, layout) {
    const ids = /** @type {readonly string[]} */ (event.targetIds ?? []);
    return Object.freeze(
      ids.flatMap((id) => {
        const anchor = this.#anchorFor(id, layout, CENTRE);
        const name = nameOf(id, snapshot);
        return anchor === null || name === null ? [] : [Object.freeze({ ...anchor, name })];
      }),
    );
  }

  /**
   * What an event shows on the board — its floating number, the flash of a
   * struck card, the pulse of a life total — each ready to be let loose now
   * or when a cast strikes. Anchored now: a creature it kills is off the
   * board by the time a held effect is released.
   * @param {GameEvent} event
   * @param {BoardLayout} layout
   * @param {Map<string, number>} impacts when blows struck in combat land, by what they struck
   * @returns {(() => void)[]}
   */
  #effectsOf(event, layout, impacts) {
    /** @type {(() => void)[]} */
    const shows = [];
    const subject = typeof event.targetId === "string" ? event.targetId : event.playerId;
    const delayMs = typeof subject === "string" ? impacts.get(subject) ?? 0 : 0;
    const spec = this.#floatSpecFor(event, layout);
    if (spec !== null) {
      shows.push(() => this.#pushFloat(spec, delayMs));
    }
    const struck = event.type === GameEventType.DAMAGE_DEALT && typeof event.targetId === "string" ? this.#visuals.get(event.targetId) : undefined;
    if (struck !== undefined) {
      shows.push(() => struck.hit(delayMs, this.#animation.longMs * FLASH_LONG));
    }
    if (event.type === GameEventType.LIFE_CHANGED && typeof event.playerId === "string" && event.delta !== 0) {
      const playerId = event.playerId;
      const delta = Number(event.delta);
      shows.push(() => this.#kicks.set(playerId, { delta, ageMs: -delayMs, durationMs: this.#animation.longMs * KICK_LONG }));
    }
    return shows;
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
   * A creature that dealt damage attacks its target: draws back, lunges and returns.
   * @param {readonly GameEvent[]} events
   * @param {BoardLayout} layout
   */
  #enqueueNudges(events, layout) {
    for (const event of events) {
      if (event.type !== GameEventType.DAMAGE_DEALT || typeof event.targetId !== "string" || !this.#canStrike(event.sourceId)) {
        continue;
      }
      const source = /** @type {CardVisual} */ (this.#visuals.get(/** @type {string} */ (event.sourceId)));
      const target = this.#anchorFor(event.targetId, layout);
      if (target !== null) {
        source.nudgeToward(target, this.#animation.shortMs);
      }
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
 * A card played by `opponentId` that did not land on the battlefield: a spell.
 * @param {Readonly<Record<string, unknown>>} event
 * @param {string} opponentId
 */
function isOpponentCast(event, opponentId) {
  return event.type === GameEventType.CARD_PLAYED && event.playerId === opponentId && event.zone !== ZoneType.BATTLEFIELD;
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
 * The path a cast travels: out of the opponent's hand, up to the banner
 * strip — the free band between the two battlefields — and down into their
 * graveyard, which the HUD stands for, as it does for every card that leaves.
 * @param {BoardLayout} layout
 * @returns {{ from: Rect, at: Rect, to: Rect }}
 */
function revealPathFor(layout) {
  return {
    from: centredOn(layout.opponent.hand, CARD_SIZE.back),
    at: centredOn(layout.banner, REVEAL_SIZE),
    to: layout.opponent.hud,
  };
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

