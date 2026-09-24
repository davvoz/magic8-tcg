/**
 * Turns snapshots and engine events into presentation state: one
 * CardVisual per card on the board (tweening toward its layout slot,
 * entering from the owner's hand or library, leaving toward the owner's
 * graveyard), short-lived floating texts for damage and healing, and the
 * reveal of a spell the opponent cast (which never reaches the board).
 * What such a spell does — its floating numbers and the life it moves — is
 * held back until the reveal strikes its targets, so the numbers change
 * when the card is seen to hit, not while it is still face-down in a hand.
 *
 * It never inspects state deltas to guess what happened: events say what
 * happened, the layout says where things belong.
 */
import { GameEventType } from "@magic8/engine/domain/game/GameEventType.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";
import { CardVisual } from "../cards/CardVisual.js";
import { CARD_SIZE } from "./BoardLayout.js";
import { CastReveal } from "./CastReveal.js";

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

/**
 * @typedef {Readonly<{ text: string, colorKey: string, x: number, y: number }>} FloatSpec
 * @typedef {{ spec: FloatSpec, ageMs: number, durationMs: number }} Float
 * @typedef {{ cast: CastReveal, floats: FloatSpec[], lives: Map<string, number>, struck: boolean }} PendingReveal
 *   what the cast did — its floats, and each player's life as it stood before — held until `struck`
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 * @typedef {import("./BoardLayout.js").BoardLayout} BoardLayout
 * @typedef {import("@magic8/engine/domain/game/GameSnapshot.js").CardView} CardView
 * @typedef {ReturnType<import("../../application/match/MatchSession.js").MatchSession["snapshotFor"]>} Snapshot
 */

export class MatchPresenter {
  /** @type {Map<string, CardVisual>} */
  #visuals = new Map();
  /** @type {Map<string, CardView>} last known card data, kept for leaving cards */
  #cards = new Map();
  /** @type {Float[]} */
  #floats = [];
  /** Opponent casts waiting to be shown, oldest first; only the first one runs. @type {PendingReveal[]} */
  #reveals = [];
  #animation;

  /** @param {Readonly<Record<string, number>>} animation theme durations (shortMs, mediumMs, longMs) */
  constructor(animation) {
    this.#animation = animation;
  }

  /** @returns {readonly CardVisual[]} visuals still on their way out, drawn above the board */
  get leavingVisuals() {
    return [...this.#visuals.values()].filter((visual) => visual.isLeaving);
  }

  /** @returns {readonly { spec: FloatSpec, progress: number }[]} */
  get floats() {
    return this.#floats.map((float) => ({ spec: float.spec, progress: float.ageMs / float.durationMs }));
  }

  /** @returns {CastReveal | null} the opponent's cast being played out right now, if any */
  get reveal() {
    return this.#reveals[0]?.cast ?? null;
  }

  /**
   * The life to show for a player: what it was before a revealed cast hit
   * them until the reveal strikes, else the snapshot's.
   * @param {Readonly<{ id: string, life: number }>} player
   */
  lifeFor(player) {
    const held = this.#reveals.find((pending) => !pending.struck && pending.lives.has(player.id));
    return held === undefined ? player.life : /** @type {number} */ (held.lives.get(player.id));
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
   * @param {readonly Readonly<Record<string, unknown>>[]} events already redacted for this perspective
   * @param {BoardLayout} layout
   * @param {boolean} animate false on first display: everything snaps into place
   */
  apply(snapshot, events, layout, animate = true) {
    const duration = animate ? this.#animation.mediumMs : 0;
    const present = new Set(Object.keys(layout.cards));
    for (const player of snapshot.players) {
      for (const card of [...player.battlefield, ...(player.hand ?? [])]) {
        this.#cards.set(card.instanceId, card);
        this.#place(card, layout, duration);
      }
    }
    for (const [instanceId, visual] of this.#visuals) {
      if (!present.has(instanceId) && !visual.isLeaving) {
        visual.leaveTo(this.#graveyardFor(instanceId, layout), animate ? this.#animation.longMs : 0);
      }
    }
    if (animate) {
      this.#enqueueEffects(events, snapshot, layout);
    }
  }

  /**
   * Floats, nudges and the opponent's cast; what the cast did waits for its reveal to strike.
   * @param {readonly Readonly<Record<string, unknown>>[]} events
   * @param {Snapshot} snapshot
   * @param {BoardLayout} layout
   */
  #enqueueEffects(events, snapshot, layout) {
    const castAt = this.#enqueueReveal(events, snapshot, layout);
    this.#enqueueFloats(castAt === -1 ? events : events.slice(0, castAt), layout);
    if (castAt !== -1) {
      this.#holdEffects(/** @type {PendingReveal} */ (this.#reveals.at(-1)), events.slice(castAt + 1), layout);
    }
    this.#enqueueNudges(events, layout);
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
    return this.#advanceReveal(dtMs) || changed;
  }

  get isAnimating() {
    return this.#floats.length > 0 || this.#reveals.length > 0 || [...this.#visuals.values()].some((visual) => visual.isAnimating);
  }

  /**
   * Runs the reveal at the head of the queue and drops it once it has played out.
   * @param {number} dtMs
   * @returns {boolean} whether a render is needed
   */
  #advanceReveal(dtMs) {
    const current = this.#reveals[0];
    if (current === undefined) {
      return false;
    }
    let changed = current.cast.update(dtMs);
    if (!current.struck && (current.cast.frame.strike >= 1 || current.cast.isDone)) {
      current.struck = true;
      current.floats.forEach((spec) => this.#pushFloat(spec));
      changed = true;
    }
    if (current.cast.isDone) {
      this.#reveals.shift();
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
   * @param {readonly Readonly<Record<string, unknown>>[]} events
   * @param {Snapshot} snapshot
   * @param {BoardLayout} layout
   * @returns {number} where the revealed cast's CARD_PLAYED sits in `events`; -1 when nothing was revealed
   */
  #enqueueReveal(events, snapshot, layout) {
    const opponent = snapshot.players.find((player) => player.id === layout.opponent.id);
    if (opponent === undefined || this.#reveals.length >= MAX_REVEALS) {
      return -1;
    }
    // One command plays one card, so a batch of events carries at most one cast.
    const castAt = events.findIndex((event) => isOpponentCast(event, opponent.id));
    const card = castAt === -1 ? null : findCard(snapshot, events[castAt].instanceId);
    if (card === null) {
      return -1;
    }
    const holdMs = this.#animation.longMs * (this.#reveals.length === 0 ? HOLD.alone : HOLD.queued);
    const targets = this.#targetsOf(events[castAt], snapshot, layout);
    const cast = new CastReveal({ card, caption: `${opponent.name} casts`, targets, ...revealPathFor(layout), animation: this.#animation, holdMs });
    this.#reveals.push({ cast, floats: [], lives: new Map(), struck: false });
    return castAt;
  }

  /**
   * Holds back what a revealed cast did until it strikes: its floating
   * numbers, and each player's life as it stood before the cast moved it.
   * @param {PendingReveal} pending
   * @param {readonly Readonly<Record<string, unknown>>[]} effects the events that followed the cast
   * @param {BoardLayout} layout
   */
  #holdEffects(pending, effects, layout) {
    for (const event of effects) {
      const spec = this.#floatSpecFor(event, layout);
      if (spec !== null) {
        pending.floats.push(spec);
      }
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
   * @param {Readonly<Record<string, unknown>>} event
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
   * @param {readonly Readonly<Record<string, unknown>>[]} events
   * @param {BoardLayout} layout
   */
  #enqueueFloats(events, layout) {
    for (const event of events) {
      const spec = this.#floatSpecFor(event, layout);
      if (spec !== null) {
        this.#pushFloat(spec);
      }
    }
  }

  /**
   * The floating text an event shows, anchored now: a creature it kills is
   * off the board by the time a held float is released.
   * @param {Readonly<Record<string, unknown>>} event
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

  /** @param {FloatSpec} spec */
  #pushFloat(spec) {
    if (this.#floats.length < MAX_FLOATS) {
      this.#floats.push({ spec, ageMs: 0, durationMs: this.#animation.longMs * 2 });
    }
  }

  /**
   * A creature that dealt damage lunges toward its target.
   * @param {readonly Readonly<Record<string, unknown>>[]} events
   * @param {BoardLayout} layout
   */
  #enqueueNudges(events, layout) {
    for (const event of events) {
      if (event.type !== GameEventType.DAMAGE_DEALT || typeof event.sourceId !== "string" || typeof event.targetId !== "string") {
        continue;
      }
      const source = this.#visuals.get(event.sourceId);
      const target = this.#anchorFor(event.targetId, layout);
      if (source !== undefined && target !== null) {
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

