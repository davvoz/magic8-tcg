/**
 * What a match sounds like, in step with what the board shows.
 *
 * Two kinds of sound. What happened in a beat (`beat`) is heard as the beat
 * is shown, each sound placed where its animation lands: a creature put
 * down thumps as it reaches its slot, a blow struck in combat whooshes with
 * the lunge and hits as it arrives (MatchPresenter.landsAfter), a creature
 * that died crumbles as it falls, a hand drawn is dealt card by card.
 * The moments played over the table — a cast held up, an ability's rune, a
 * turn banner, a random discard's crosshair — and the opening toss and the
 * end of the match are heard as they reach each stage (`follow`), so a
 * spell strikes when its beams arrive however long it was held up to be read.
 *
 * Sounds are placed in the stereo field by where they happen on the board,
 * and the opponent's draws and plays sit a little further back than the
 * player's own. Presentation state only: it reads the presenter and the
 * layout, and asks the game's sound for cues.
 */
import { SoundCue } from "../../application/audio/SoundCue.js";
import { GameEventType } from "@magic8/engine/domain/game/GameEventType.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";
import { CastReveal } from "./CastReveal.js";
import { GameOverMood } from "./GameOverSequence.js";
import { TriggerFlare } from "./TriggerFlare.js";
import { TurnBanner } from "./TurnBanner.js";

/** Cards dealt one after another this far apart; past `max` in one beat the rest are not heard. */
const DEAL = Object.freeze({ gapMs: 70, max: 8 });
/** Cards leaving a pile are heard one after another (each comes up, is held, then goes), at most `max` of them. */
const PILE_LEAVES = Object.freeze({ max: 6 });
/** How far through its move a card put down is heard landing. */
const LANDING = 0.8;
/** How wide the board is in the stereo field: the far left edge of the table is heard this far left. */
const PAN_SPREAD = 0.55;
/** How loud the opponent's draws are next to the player's own, their creatures put down, and a player worn down by an empty deck. */
const THEIRS = 0.6;
const OPPONENT_PLAY = 0.85;
const FATIGUE_GAIN = 0.6;
/** A blow's weight: louder and lower the more damage it does, up to `cap` damage. */
const WEIGHT = Object.freeze({ cap: 8, gain: 0.05, pitch: 0.025, base: 0.75 });
/** The last seconds of the player's own decision clock tick; the very last ones urgently. */
const CLOCK = Object.freeze({ ticksFrom: 10, urgentFrom: 5 });
/** A crosshair locking on a card: the tick of its hops, higher and louder. */
const LOCK = Object.freeze({ pitch: 1.5, gain: 1.4 });
/** What a moment's strike sounds like next to a cast's. */
const ABILITY_STRIKE_GAIN = 0.6;
/** The outcome of a match, by how it feels to the viewer. */
const OUTCOME_CUES = Object.freeze({ [GameOverMood.TRIUMPH]: SoundCue.VICTORY, [GameOverMood.DEFEAT]: SoundCue.DEFEAT, [GameOverMood.NEUTRAL]: SoundCue.DRAW });
/** The fields of a stats change whose sum says whether the creature was made stronger or weaker. */
const STAT_FIELDS = Object.freeze(["attack", "health"]);

/**
 * @typedef {Readonly<Record<string, unknown>>} GameEvent
 * @typedef {import("./BoardLayout.js").BoardLayout} BoardLayout
 * @typedef {import("./MatchPresenter.js").MatchPresenter} MatchPresenter
 * @typedef {{ hops: number, locks: number }} SeekProgress
 * @typedef {{ presenter: MatchPresenter, layout: BoardLayout, counts: { dealt: number, left: number }, lunged: Set<unknown>, pan: (...ids: unknown[]) => number }} Beat
 *   a beat being heard: the board it is shown on, what it has made heard so far (cards dealt and gone, creatures that lunged), and where on it things are
 */

export class MatchSoundscape {
  #sound;
  #animation;
  #viewerId;
  /** The moment last seen at the head of the presenter's queue, and how far it has been heard. @type {{ moment: import("./MatchPresenter.js").Moment | null, announced: boolean, struck: boolean, seek: SeekProgress }} */
  #moment = { moment: null, announced: false, struck: false, seek: { hops: 0, locks: 0 } };
  /** The toss being heard, and its stages heard so far. @type {{ flip: import("./CoinFlip.js").CoinFlip | null, thrown: boolean, landed: boolean, told: boolean }} */
  #toss = { flip: null, thrown: false, landed: false, told: false };
  /** The end being heard, and its stages heard so far. @type {{ sequence: import("./GameOverSequence.js").GameOverSequence | null, cracked: boolean, burst: boolean, told: boolean }} */
  #end = { sequence: null, cracked: false, burst: false, told: false };

  /**
   * @param {{ sound: import("../scenes/Scene.js").SoundPlayer | undefined, animation: Readonly<Record<string, number>>, viewerId: string }} deps
   *   `animation`: the theme's durations; `viewerId`: the player whose side the board is (empty for a spectator)
   */
  constructor({ sound, animation, viewerId }) {
    this.#sound = sound;
    this.#animation = animation;
    this.#viewerId = viewerId;
  }

  /**
   * The sounds of what happened in a beat, as it is shown.
   * @param {readonly GameEvent[]} events
   * @param {{ presenter: MatchPresenter, layout: BoardLayout }} board the presenter that was just given the beat, and the layout it was given
   */
  beat(events, board) {
    if (this.#sound === undefined) {
      return;
    }
    /** @type {Beat} */
    const beat = { ...board, counts: { dealt: 0, left: 0 }, lunged: new Set(), pan: (...ids) => panOf(ids, board.presenter, board.layout) };
    for (const event of events) {
      this.#hearers[/** @type {string} */ (event.type)]?.(event, beat);
    }
  }

  /**
   * Follows the moments over the table, the toss and the end of the match, frame by frame.
   * @param {{ presenter: MatchPresenter, toss: import("./CoinFlip.js").CoinFlip | null, ending: import("./GameOverSequence.js").GameOverSequence | null }} board
   */
  follow({ presenter, toss, ending }) {
    if (this.#sound === undefined) {
      return;
    }
    this.#followMoment(presenter.moment);
    this.#followToss(toss);
    this.#followEnd(ending);
  }

  /**
   * The decision clock showed a new second.
   * @param {number | null} secondsLeft
   * @param {boolean} mine whether the decision is the viewer's own
   */
  tick(secondsLeft, mine) {
    if (!mine || secondsLeft === null || secondsLeft <= 0 || secondsLeft > CLOCK.ticksFrom) {
      return;
    }
    this.#play(secondsLeft <= CLOCK.urgentFrom ? SoundCue.CLOCK_URGENT : SoundCue.CLOCK_TICK);
  }

  /** The server (or the engine) refused a move. */
  rejected() {
    this.#play(SoundCue.UI_ERROR);
  }

  /** The viewer ended their turn. */
  endedTurn() {
    this.#play(SoundCue.TURN_END);
  }

  /**
   * What each kind of event sounds like; events not here make no sound of their own.
   * @type {Readonly<Record<string, (event: GameEvent, beat: Beat) => void>>}
   */
  #hearers = Object.freeze({
    [GameEventType.CARD_DRAWN]: (event, beat) => {
      if (beat.counts.dealt < DEAL.max) {
        this.#play(SoundCue.CARD_DRAW, { delayMs: beat.counts.dealt * DEAL.gapMs, gain: this.#isMine(event) ? 1 : THEIRS, pan: beat.pan(event.instanceId, event.playerId) });
      }
      beat.counts.dealt += 1;
    },
    [GameEventType.CARD_PLAYED]: (event, beat) => {
      if (event.zone === ZoneType.BATTLEFIELD) {
        this.#play(SoundCue.CARD_PLACE, { delayMs: this.#animation.mediumMs * LANDING, gain: this.#isMine(event) ? 1 : OPPONENT_PLAY, pan: beat.pan(event.instanceId) });
      }
    },
    [GameEventType.ATTACKERS_DECLARED]: (event) => this.#playIfAny(SoundCue.ATTACK_DECLARE, event.attackerIds),
    [GameEventType.BLOCKERS_DECLARED]: (event) => this.#playIfAny(SoundCue.BLOCK_DECLARE, event.blocks),
    [GameEventType.DAMAGE_DEALT]: (event, beat) => this.#hearBlow(event, beat),
    [GameEventType.FATIGUE_DAMAGE]: (event, beat) => this.#play(SoundCue.HIT_PLAYER, { gain: FATIGUE_GAIN, pan: beat.pan(event.playerId) }),
    [GameEventType.HEALED]: (event, beat) => this.#play(SoundCue.HEAL, { pan: beat.pan(event.targetId) }),
    [GameEventType.STATS_MODIFIED]: (event, beat) => this.#hearStats(event, beat.pan(event.targetId)),
    [GameEventType.CREATURE_DIED]: (event, beat) => {
      this.#play(SoundCue.CREATURE_DEATH, { delayMs: beat.presenter.landsAfter(String(event.instanceId)) + this.#animation.shortMs, pan: beat.pan(event.instanceId) });
    },
    [GameEventType.CARD_RETURNED]: (event, beat) => this.#play(SoundCue.CARD_RETURN, { pan: beat.pan(event.targetId) }),
    [GameEventType.CARD_DISCARDED]: (event, beat) => this.#hearPileLeave(event, beat),
    [GameEventType.CARD_MILLED]: (event, beat) => this.#hearPileLeave(event, beat),
  });

  /**
   * A card leaving a hand or the deck for the graveyard: one after another, as the board plays them out.
   * @param {GameEvent} event
   * @param {Beat} beat
   */
  #hearPileLeave(event, beat) {
    if (beat.counts.left < PILE_LEAVES.max) {
      this.#play(SoundCue.CARD_DISCARD, { delayMs: beat.counts.left * (this.#animation.mediumMs + this.#animation.longMs), pan: beat.pan(event.playerId) });
    }
    beat.counts.left += 1;
  }

  /** @param {GameEvent} event whether the viewer did it */
  #isMine(event) {
    return event.playerId === this.#viewerId;
  }

  /**
   * @param {string} cue
   * @param {unknown} list played only when it lists something (attackers, blocks)
   */
  #playIfAny(cue, list) {
    if (Array.isArray(list) && list.length > 0) {
      this.#play(cue);
    }
  }

  /**
   * A blow: the lunge of the creature that struck it, then the hit as it lands — heavier the more it did.
   * @param {GameEvent} event a DAMAGE_DEALT
   * @param {Beat} beat
   */
  #hearBlow(event, { presenter, layout, lunged }) {
    const targetId = String(event.targetId);
    const landsMs = presenter.landsAfter(targetId);
    const weight = Math.min(WEIGHT.cap, Math.max(0, Number(event.amount) || 0));
    const pan = panOf([targetId], presenter, layout);
    if (landsMs > 0 && !lunged.has(event.sourceId)) {
      lunged.add(event.sourceId);
      this.#play(SoundCue.LUNGE, { delayMs: Math.max(0, landsMs - this.#animation.shortMs), pan: panOf([event.sourceId], presenter, layout) });
    }
    const atPlayer = targetId === layout.me.id || targetId === layout.opponent.id;
    this.#play(atPlayer ? SoundCue.HIT_PLAYER : SoundCue.HIT_CREATURE, { delayMs: landsMs, gain: WEIGHT.base + weight * WEIGHT.gain, pitch: 1 - weight * WEIGHT.pitch, pan });
  }

  /**
   * @param {GameEvent} event a STATS_MODIFIED
   * @param {number} pan
   */
  #hearStats(event, pan) {
    const change = STAT_FIELDS.reduce((sum, field) => sum + (Number(event[field]) || 0), 0);
    if (change !== 0) {
      this.#play(change > 0 ? SoundCue.BUFF : SoundCue.DEBUFF, { pan });
    }
  }

  /** @param {import("./MatchPresenter.js").Moment | null} moment */
  #followMoment(moment) {
    const heard = this.#moment;
    if (moment !== heard.moment) {
      this.#moment = { moment, announced: false, struck: false, seek: { hops: 0, locks: 0 } };
      this.#followMoment(moment);
      return;
    }
    if (moment === null) {
      return;
    }
    if (!heard.announced && (!(moment instanceof TriggerFlare) || moment.hasStarted)) {
      heard.announced = true;
      this.#announce(moment);
    }
    if (moment instanceof TurnBanner) {
      return;
    }
    this.#followSeek(moment, heard.seek);
    if (!heard.struck && moment.hasStruck) {
      heard.struck = true;
      this.#play(SoundCue.SPELL_STRIKE, { gain: moment instanceof CastReveal ? 1 : ABILITY_STRIKE_GAIN });
    }
  }

  /** @param {CastReveal | TriggerFlare | TurnBanner} moment */
  #announce(moment) {
    if (moment instanceof TurnBanner) {
      this.#play(moment.playerId === this.#viewerId ? SoundCue.TURN_MINE : SoundCue.TURN_THEIRS);
      return;
    }
    if (moment instanceof TriggerFlare) {
      this.#play(SoundCue.ABILITY_TRIGGER);
      return;
    }
    this.#play(SoundCue.SPELL_CAST);
    if (moment.frame.turn < 1) {
      // The opponent's card comes up face-down and turns over once it is held up.
      this.#play(SoundCue.CARD_FLIP, { delayMs: this.#animation.mediumMs * 1.5 });
    }
  }

  /**
   * A random discard's crosshair: a tick for each card it hops to, a higher one as it locks.
   * @param {CastReveal | TriggerFlare} moment
   * @param {SeekProgress} heard
   */
  #followSeek(moment, heard) {
    if (moment.frame.seek <= 0) {
      return;
    }
    const roulettes = moment instanceof CastReveal ? [moment.roulette] : moment.sources.map((source) => source.roulette ?? null);
    const elapsedMs = moment instanceof CastReveal ? moment.frame.seek * (moment.roulette?.durationMs ?? 0) : moment.seekMs;
    const now = roulettes.reduce((sum, roulette) => {
      if (roulette === null) {
        return sum;
      }
      const progress = roulette.progressAt(elapsedMs);
      return { hops: sum.hops + progress.hops, locks: sum.locks + progress.locks };
    }, { hops: 0, locks: 0 });
    if (now.locks > heard.locks) {
      this.#play(SoundCue.TARGET_SEEK, { pitch: LOCK.pitch, gain: LOCK.gain });
    } else if (now.hops > heard.hops) {
      this.#play(SoundCue.TARGET_SEEK);
    }
    heard.hops = now.hops;
    heard.locks = now.locks;
  }

  /** @param {import("./CoinFlip.js").CoinFlip | null} flip */
  #followToss(flip) {
    const heard = this.#toss;
    if (flip !== heard.flip) {
      this.#toss = { flip, thrown: false, landed: false, told: false };
      this.#followToss(flip);
      return;
    }
    if (flip === null) {
      return;
    }
    if (!heard.thrown && flip.frame.flight > 0) {
      heard.thrown = true;
      this.#play(SoundCue.COIN_TOSS, { durationMs: flip.flightMs });
    }
    if (!heard.landed && flip.hasLanded) {
      heard.landed = true;
      this.#play(SoundCue.COIN_LAND);
    }
    if (!heard.told && flip.frame.verdict > 0) {
      heard.told = true;
      this.#play(SoundCue.TOSS_VERDICT);
    }
  }

  /** @param {import("./GameOverSequence.js").GameOverSequence | null} sequence */
  #followEnd(sequence) {
    const heard = this.#end;
    if (sequence !== heard.sequence) {
      this.#end = { sequence, cracked: false, burst: false, told: false };
      this.#followEnd(sequence);
      return;
    }
    if (sequence === null) {
      return;
    }
    const crystals = sequence.crystals.length > 0;
    if (crystals && !heard.cracked && sequence.crack > 0) {
      heard.cracked = true;
      this.#play(SoundCue.CRYSTAL_CRACK, { durationMs: sequence.crackMs });
    }
    if (crystals && !heard.burst && sequence.burst) {
      heard.burst = true;
      this.#play(SoundCue.CRYSTAL_SHATTER);
    }
    if (!heard.told && sequence.titleAlpha > 0) {
      heard.told = true;
      this.#play(OUTCOME_CUES[/** @type {keyof typeof OUTCOME_CUES} */ (sequence.mood)] ?? SoundCue.DRAW);
    }
  }

  /**
   * @param {string} cue
   * @param {import("../../application/ports/AudioOutput.contract.js").PlayOptions} [options]
   */
  #play(cue, options) {
    this.#sound?.play(cue, options);
  }
}

/**
 * Where on the board the first of `ids` that can be found stands, in the stereo field: a card's slot (or where it was last
 * drawn), else a player's seat; the middle when none is on the board.
 * @param {readonly unknown[]} ids
 * @param {MatchPresenter} presenter
 * @param {BoardLayout} layout
 * @returns {number} -PAN_SPREAD (the left edge) to PAN_SPREAD (the right)
 */
function panOf(ids, presenter, layout) {
  for (const id of ids) {
    if (typeof id !== "string") {
      continue;
    }
    const seat = [layout.me, layout.opponent].find((candidate) => candidate.id === id);
    const area = layout.cards[id] ?? presenter.visualFor(id)?.state ?? seat?.hud;
    if (area !== undefined) {
      const half = layout.width / 2;
      return half <= 0 ? 0 : Math.max(-1, Math.min(1, (area.x + area.width / 2 - (layout.x + half)) / half)) * PAN_SPREAD;
    }
  }
  return 0;
}
