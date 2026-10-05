/**
 * The match board. Reads the human's perspective snapshot from the
 * MatchSession, lays it out (BoardLayout), animates it (MatchPresenter),
 * turns taps into commands (MatchInteraction) and submits them through the
 * session. Everything here is presentation state; the engine is never
 * touched directly.
 *
 * The widget tree is rebuilt on every snapshot and on every interaction
 * step; card visuals live in the presenter and survive rebuilds, which is
 * what keeps animations continuous.
 *
 * A session with no human player is a spectator's: the first seat sits at
 * the bottom, no hand is shown (the server never sends one), and nothing
 * can be played.
 *
 * A session that offers an opening toss has it played first (CoinFlip,
 * drawn by CoinTossNode over the board): until the coin has landed and the
 * verdict faded, nothing can be played and the board does not tell whose
 * turn it is. Then the scene asks the session to `begin()`.
 *
 * Moves wait their turn the same way: while the board is still playing out
 * what happened (the presenter is busy) or a move is on its way to the
 * server, nothing can be played — cards and buttons go quiet and come back
 * once it is over. Inspecting cards, cancelling and conceding stay open.
 *
 * The other side is paced too. The AI decides in an instant and a remote
 * opponent's moves arrive whenever they are made, so each update is taken
 * with the state it led to and shown only once the board has finished
 * showing the one before: every move is seen, one after another.
 *
 * Within an update, what a move set off is played link by link (StepBeats):
 * a cast, then — once its beams strike — what it did; a creature dying,
 * then — once the rune of its death ability strikes — what that did. Each
 * beat is laid out from the state as it stood at that point, so nothing is
 * on the board before the card that caused it has been seen to act.
 *
 * When the match ends, the blow that ended it plays out first, then the end
 * itself (GameOverSequence, drawn by GameOverNode over the board): the
 * fallen crystal breaks, the table darkens, the outcome comes down. Only
 * then is the result offered.
 *
 * What the board shows is heard too (MatchSoundscape): each beat's sounds
 * land with its animations, the moments over the table, the toss and the
 * end are heard stage by stage, and the last seconds of the player's clock tick.
 * The sound settings open from the battle log: its panel's header, or on a
 * compact board the log's dialog.
 *
 * On a compact screen (a phone in landscape) the board is the compact one:
 * a slim action column instead of the sidebar, its last row opening the
 * battle log and conceding; and on a phone, or played by touch, a hand card
 * is picked first — held up large to be read — and played with "Play".
 *
 * The tutorial is a match with a coach (TutorialCoach): its lessons are read
 * on a card over the board, which waits (no update is shown) until "Next",
 * the table dimmed round what the lesson is about; its tasks are a line over
 * the middle of the table (and the side panel's prompt), and only what a
 * task names glows and answers a tap. Rings and arrows point at what the
 * coach talks about (CoachCard).
 * Leaving it is not conceding: the player just goes back to the menu.
 */
import { concede, endPhase, endTurn } from "@magic8/engine/domain/commands/commandFactories.js";
import { SoundCue } from "../../application/audio/SoundCue.js";
import { ControllerKind } from "../../application/match/PlayerController.contract.js";
import { TutorialCoach } from "../../application/tutorial/TutorialCoach.js";
import { GameEndReason } from "@magic8/engine/domain/game/GameEventType.js";
import { KeyMap, isKey } from "../../input/KeyMap.js";
import { Highlight, InteractionMode, MatchInteraction } from "../../input/interaction/MatchInteraction.js";
import { BattleLogNode, createLogScroll } from "../board/BattleLogNode.js";
import { BoardNode } from "../board/BoardNode.js";
import { CardNode } from "../board/CardNode.js";
import { ClockNode } from "../board/ClockNode.js";
import { CoachFocus, CoachHint, CoachSpotlight, buildCoachCard } from "../board/CoachCard.js";
import { CoinFlip } from "../board/CoinFlip.js";
import { CoinTossNode } from "../board/CoinTossNode.js";
import { EffectsNode } from "../board/EffectsNode.js";
import { GameOverNode } from "../board/GameOverNode.js";
import { GameOverMood, GameOverSequence } from "../board/GameOverSequence.js";
import { computeBoardLayout } from "../board/BoardLayout.js";
import { MatchPresenter } from "../board/MatchPresenter.js";
import { MatchSoundscape } from "../board/MatchSoundscape.js";
import { PickedCardNode } from "../board/PickedCardNode.js";
import { PlayerNode, lifeCrystalCentre, resourceRects } from "../board/PlayerNode.js";
import { boardFaceProfile } from "../cards/CardRenderer.js";
import { cardFaceLayout } from "../cards/CardFace.js";
import { splitIntoBeats } from "../board/StepBeats.js";
import { LogKind, describeEvent } from "../board/eventLog.js";
import { CardDetail } from "../cards/CardDetail.js";
import { drawTableBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { buildConfirmModal } from "../ui/ConfirmModal.js";
import { buildAudioSettingsModal } from "./audioSettings.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { Panel, PANEL_INSET } from "../ui/Panel.js";
import { RichTextBlock } from "../ui/RichText.js";
import { TextBlock } from "../ui/TextBlock.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

/** The whole match, in practice; the log scrolls. */
const MAX_LOG_ENTRIES = 200;
/** Updates allowed to wait their turn (however many beats each has); past this the oldest are shown at once, unanimated, so a fast match cannot leave the board far behind. */
const MAX_BACKLOG = 6;
const TOSS_BANNER = "Coin toss · who plays first?";
const SIDEBAR = Object.freeze({ inset: 12, buttonHeight: 48, gap: 8, titleHeight: 36, phaseHeight: 26, promptTop: 84, promptHeight: 64, buttonsTop: 156, footerHeight: 0 });
/** The compact board's action column; its footer row holds the log and leave buttons. */
/** How much of the compact footer the log button takes; leaving (Concede) has the rest. */
const COMPACT_LOG_SHARE = 0.36;
const COMPACT_SIDEBAR = Object.freeze({ inset: 8, buttonHeight: 46, gap: 6, titleHeight: 30, phaseHeight: 20, promptTop: 54, promptHeight: 58, buttonsTop: 116, footerHeight: 46 });
const LOG = Object.freeze({ inset: 8, headerHeight: 30 });
/** The Sound button in the log panel's header, and in the log dialog beside Close. */
const SOUND_BUTTON = Object.freeze({ width: 84, height: 26, dialogWidth: 110 });
/** The battle log opened from a compact board's action column, as large as the screen allows. */
const LOG_MODAL = Object.freeze({ width: 600, height: 380, margin: 10 });
const GAME_OVER = Object.freeze({ width: 720, height: 320 });
const COMPACT_GAME_OVER = Object.freeze({ width: 600, height: 280 });
const INSPECT = Object.freeze({ width: 448, height: 640, card: Object.freeze({ width: 380, height: 540 }) });
/** A compact screen's inspect view: the card on the left, Close beside it. */
const COMPACT_INSPECT = Object.freeze({ width: 420, height: 376, card: Object.freeze({ width: 244, height: 342 }), close: Object.freeze({ width: 118, height: 46 }) });
/** Marks that invite a tap, dropped while moves are held back. @type {ReadonlySet<string>} */
const INVITING = new Set([Highlight.PLAYABLE, Highlight.TARGETABLE]);

/**
 * @typedef {ReturnType<import("../../application/match/MatchSession.js").MatchSession["snapshotFor"]>} Snapshot
 * @typedef {Readonly<{ snapshot: Snapshot, events: readonly Readonly<Record<string, unknown>>[], outcome?: readonly Readonly<Record<string, unknown>>[], chained: boolean }>} Step one beat of an update as the board shows it: the state
 *   it led to, and what happened on the way; `outcome`, what it announces is going to do (the next beat's events);
 *   `chained` when it carries on from the beat before, and is shown once what that one announced has struck
 */

export class MatchScene extends Scene {
  /** @type {(cardId: string) => string | null} */
  #rarityOf;
  /** @type {import("../../application/match/MatchSession.js").MatchSession | import("../../application/online/RemoteMatchSession.js").RemoteMatchSession | null} */
  #session = null;
  /** Where "Play again" leads: deck selection for practice, the lobby for online games. */
  /** @type {string} */
  #againScene = SceneId.DECK_SELECTION;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  #playerId = "";
  #spectating = false;
  /** @type {MatchInteraction | null} */
  #interaction = null;
  #presenter;
  /** @type {Snapshot | null} */
  #snapshot = null;
  /** @type {import("../board/BoardLayout.js").BoardLayout | null} */
  #layout = null;
  /** @type {import("../board/eventLog.js").LogEntry[]} */
  #log = [];
  /** Where the log is scrolled to, kept across rebuilds. */
  #logScroll = createLogScroll();
  #gameOverShown = false;
  /** The opening coin toss being played, null once it is over (or when there was none). @type {CoinFlip | null} */
  #coinFlip = null;
  #now;
  /** The clock's last displayed whole second, so ticking asks for a redraw only when the number on screen would change. @type {number | null} */
  #clockSecondShown = null;
  /** A move sent to the server and not yet answered: another one would carry the same game version and be refused. */
  #submitting = false;
  /** Whether the widgets were last built with play held back, so the tree is rebuilt when that changes. */
  #builtBusy = false;
  /** Beats that arrived while the board was still showing an earlier one, oldest first. @type {Step[]} */
  #backlog = [];
  /** The state the latest update led to: the next one is staged from it. @type {Snapshot | null} */
  #taken = null;
  /** The end of the match being played out, before the result is offered; null until the match ends. @type {GameOverSequence | null} */
  #ending = null;
  /** What the board sounds like; null until the scene is entered. @type {MatchSoundscape | null} */
  #soundscape = null;
  /** The game's sound settings, when the game has sound. @type {import("./audioSettings.js").AudioControls & { subscribe: (listener: (settings: import("../../application/audio/AudioSettings.js").AudioSettings) => void) => () => void } | undefined} */
  #audio;
  /** @type {(() => void) | null} */
  #unsubscribeAudio = null;
  /** The tutorial's coach, when this match is the tutorial. @type {TutorialCoach | null} */
  #coach = null;
  /** Whether the widgets were last built with the coach's lesson card on the board. */
  #builtLesson = false;
  /** Time on the board, for the coach's pulsing ring. */
  #elapsedMs = 0;

  /** @param {import("./Scene.js").SceneServices} services */
  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {{ rarityOf?: (cardId: string) => string | null, now?: () => number, audio?: MatchScene["audio"] }} [cards] how rare a card is, for the inspect view; `now`: for the decision clock;
   *   `audio`: the sound settings (AudioService), opened from the battle log
   */
  constructor(services, { rarityOf = () => null, now = () => Date.now(), audio } = {}) {
    super(services);
    this.#rarityOf = rarityOf;
    this.#now = now;
    this.#audio = audio;
    this.#presenter = new MatchPresenter(services.theme.animation);
  }

  /** @param {Readonly<Record<string, unknown>>} params `{ session: MatchSession | RemoteMatchSession, againScene?: string, coach?: TutorialCoach }`: with a coach, the match is the tutorial */
  enter(params) {
    this.#againScene = typeof params.againScene === "string" ? params.againScene : SceneId.DECK_SELECTION;
    const session = /** @type {import("../../application/match/MatchSession.js").MatchSession | undefined} */ (params.session);
    if (session === undefined) {
      this.services.logger.error("MatchScene entered without a session");
      this.services.navigate(SceneId.MAIN_MENU);
      return;
    }
    this.#session = session;
    this.#coach = params.coach instanceof TutorialCoach ? params.coach : null;
    this.#builtLesson = false;
    this.#playerId = session.humanPlayerIds[0] ?? "";
    this.#spectating = session.humanPlayerIds.length === 0;
    this.#gameOverShown = false;
    this.#ending = null;
    this.#backlog = [];
    this.#log = [];
    this.#logScroll = createLogScroll();
    this.#interaction = new MatchInteraction(this.#playerId, { confirmPlays: this.#confirmsPlays() });
    this.#soundscape = new MatchSoundscape({ sound: this.services.sound, animation: this.services.theme.animation, viewerId: this.#spectating ? "" : this.#playerId });
    const toss = session.openingToss;
    this.#coinFlip = toss === null ? null : new CoinFlip({ toss, animation: this.services.theme.animation });
    this.#unsubscribe = session.subscribe((update) => this.#onUpdate(update));
    // Muted from anywhere (M): the Sound buttons say so without a rebuild.
    this.#unsubscribeAudio = this.#audio?.subscribe((settings) => {
      for (const id of ["sound", "logModal.sound"]) {
        const button = (this.modal ?? this.root).findById(id) ?? this.root.findById(id);
        if (button instanceof Button) {
          button.text = soundLabel(settings);
        }
      }
      this.services.requestRender();
    }) ?? null;
    this.#taken = session.snapshotFor(this.#playerId);
    this.#show({ snapshot: this.#taken, events: [], chained: false }, false);
    if (this.#coinFlip === null) {
      this.#begin();
    }
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#unsubscribeAudio?.();
    this.#unsubscribeAudio = null;
    this.#coinFlip = null;
  }

  /** The sound settings this board opens, if the game has sound. */
  get audio() {
    return this.#audio;
  }

  /** @param {number} dtMs */
  update(dtMs) {
    const inputChanged = super.update(dtMs);
    const tossChanged = this.#advanceCoinFlip(dtMs);
    const presented = this.#presenter.update(dtMs);
    // Heard before the next beat is shown: a spell strikes, then what it did lands.
    this.#soundscape?.follow({ presenter: this.#presenter, toss: this.#coinFlip, ending: this.#ending });
    const caughtUp = this.#showNextStep();
    const ending = this.#ending?.update(dtMs) ?? false;
    this.#elapsedMs += dtMs;
    const pulsing = this.root.findById("coach.focus") !== null;
    const changed = presented || caughtUp || ending || inputChanged || tossChanged || pulsing || this.#tickClock();
    this.#maybeShowGameOver();
    if (this.isBusy !== this.#builtBusy || this.#showsLesson !== this.#builtLesson) {
      this.#rebuild();
      return true;
    }
    return changed;
  }

  /** True while moves are held back: the toss, the board playing out what happened, or a move awaiting the server. */
  get isBusy() {
    return this.isTossing || this.#submitting || this.#backlog.length > 0 || this.#presenter.isBusy || this.isEnding;
  }

  /** True while the end of the match is being played out, before the result is offered. */
  get isEnding() {
    return this.#ending !== null && !this.#ending.isDone;
  }

  /**
   * Whether the board may move on to `step`, with no coin in the air: to the
   * next beat of an update once what the last one announced has struck, to
   * the next update once nothing is left to play out from the last one.
   * @param {Step} step
   */
  #readyFor(step) {
    if (this.isTossing || this.#coach?.holdsBoard === true) {
      return false;
    }
    return step.chained ? this.#presenter.hasStruck : !this.#presenter.isBusy;
  }

  /**
   * Shows the oldest waiting beat once the board is ready for it.
   * @returns {boolean} whether one was shown
   */
  #showNextStep() {
    const next = this.#backlog[0];
    if (next === undefined || !this.#readyFor(next)) {
      return false;
    }
    this.#backlog.shift();
    this.#show(next, true);
    return true;
  }

  /** True while the opening coin toss is being played. */
  get isTossing() {
    return this.#coinFlip !== null;
  }

  /**
   * Moves the toss on; once it is over, lifts it off the board and lets the match begin.
   * @param {number} dtMs
   * @returns {boolean} whether a render is needed
   */
  #advanceCoinFlip(dtMs) {
    const flip = this.#coinFlip;
    if (flip === null) {
      return false;
    }
    const changed = flip.update(dtMs);
    if (!flip.isDone) {
      return changed;
    }
    this.#coinFlip = null;
    this.#rebuild();
    this.#begin();
    return true;
  }

  /** Starts a local match that waited for its toss; online games are already running. */
  #begin() {
    const begun = this.#session?.begin();
    if (begun !== undefined && !begun.ok) {
      this.services.logger.error("match start failed", begun.error);
    }
  }

  /**
   * Whether the clock's displayed second changed since the last frame, so
   * the ticking dial redraws roughly once a second instead of every frame.
   */
  #tickClock() {
    const deadline = this.#clockView()?.deadline ?? null;
    const second = deadline === null ? null : Math.ceil(Math.max(0, deadline - this.#now()) / 1000);
    const changed = second !== this.#clockSecondShown;
    this.#clockSecondShown = second;
    if (changed) {
      this.#soundscape?.tick(second, !this.#spectating && this.#clockView()?.activeSeat === this.#playerId);
    }
    return changed;
  }

  /** The decision clock to show, or null when there is none (offline play, or the match is over). */
  #clockView() {
    if (this.#snapshot === null || this.#snapshot.isOver) {
      return null;
    }
    return this.#session?.clock ?? null;
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    const { theme, viewport } = this.services;
    drawTableBackdrop(context, theme, viewport.bounds);
    const shake = this.#ending?.shake ?? { x: 0, y: 0 };
    if (shake.x === 0 && shake.y === 0) {
      super.render(context);
      return;
    }
    context.save();
    context.translate(shake.x, shake.y);
    super.render(context);
    context.restore();
  }

  /** @param {import("../../input/InputManager.js").KeyInput} input */
  onKey(input) {
    if (this.isTossing) {
      return;
    }
    if (input.type === "keydown" && isKey(input.key, KeyMap.END_TURN) && this.modal === null && !this.isBusy && this.#snapshot?.legalMoves?.canEndTurn === true && this.#coachAllows("endTurn")) {
      this.#soundscape?.endedTurn();
      this.#submit(endTurn(this.#playerId));
      return;
    }
    super.onKey(input);
  }

  /** The board re-fits to the new screen: cards snap to their new places, an open modal stays open. */
  onResize() {
    const snapshot = this.#snapshot;
    if (this.#interaction !== null) {
      this.#interaction.confirmPlays = this.#confirmsPlays();
    }
    if (snapshot !== null && this.#layout !== null) {
      const modal = this.modal;
      this.#layout = this.#layoutFor(snapshot);
      this.#presenter.apply(snapshot, [], this.#layout, { animate: false });
      this.#rebuild();
      if (modal !== null && this.modal === null) {
        this.openModal(modal);
      }
    }
    super.onResize();
  }

  /** Escape drops the current multi-step intent when no modal is open. */
  onCancel() {
    if (this.modal !== null) {
      super.onCancel();
      return;
    }
    if (this.#interaction?.canCancel === true) {
      this.#interaction.cancel();
      this.#rebuild();
    }
  }

  /**
   * Right-click, long-press or `I` on a card shows it at full size, whether or not it is tappable.
   * @param {import("../ui/UiNode.js").UiNode} node
   */
  onSecondary(node) {
    if (node instanceof CardNode && this.modal === null) {
      this.#showInspect(node.card);
    }
  }

  get interaction() {
    return this.#interaction;
  }

  get presenter() {
    return this.#presenter;
  }

  /** @returns {GameOverSequence | null} the end of the match, once it has begun to play out */
  get ending() {
    return this.#ending;
  }

  /**
   * The board for the screen: the whole of it, clear of a notch; the compact board on a phone.
   * @param {Snapshot} snapshot
   */
  #layoutFor(snapshot) {
    const { viewport } = this.services;
    return computeBoardLayout(snapshot, this.#playerId, viewport.safeBounds, { compact: viewport.compact });
  }

  /** Whether a hand card is picked before it is played: on a phone, or whenever played by touch. */
  #confirmsPlays() {
    return this.services.viewport.compact || this.services.usingTouch?.() === true;
  }

  /** @param {import("../../application/match/MatchSession.js").SessionUpdate} update */
  #onUpdate(update) {
    if (this.#session === null) {
      return;
    }
    // Taken now: the session tells its listeners straight after each move, while its state is still the one that move led to.
    const snapshot = this.#session.snapshotFor(this.#playerId);
    const beats = splitIntoBeats(this.#taken, snapshot, this.#session.eventsFor(update.events, this.#playerId));
    this.#taken = snapshot;
    const steps = beats.map((beat, index) => Object.freeze({ ...beat, chained: index > 0 }));
    if (this.#backlog.length === 0 && this.#readyFor(steps[0])) {
      this.#show(/** @type {Step} */ (steps.shift()), true);
    }
    this.#backlog.push(...steps);
    while (this.#backlog.filter((step) => !step.chained).length > MAX_BACKLOG) {
      do {
        this.#show(/** @type {Step} */ (this.#backlog.shift()), false);
      } while (this.#backlog[0]?.chained === true);
    }
  }

  /**
   * Shows one step: re-lays out the board, feeds the presenter and rebuilds the tree.
   * @param {Step} step
   * @param {boolean} animate
   */
  #show({ snapshot, events, outcome = [] }, animate) {
    if (this.#session === null || this.#interaction === null) {
      return;
    }
    this.#snapshot = snapshot;
    this.#layout = this.#layoutFor(snapshot);
    this.#presenter.apply(snapshot, events, this.#layout, { animate, outcome });
    if (animate) {
      this.#soundscape?.beat(events, { presenter: this.#presenter, layout: this.#layout });
    }
    const entries = events.map((event) => describeEvent(event, snapshot)).filter((entry) => entry !== null);
    this.#log = [...this.#log, ...entries].slice(-MAX_LOG_ENTRIES);
    this.#interaction.sync(snapshot);
    this.#coach?.sync(snapshot);
    this.#rebuild();
    this.#maybeShowGameOver();
  }

  /**
   * Once the blow that ended the match has played out (the opponent's last
   * cast, the killing attack), the end itself is played; the result is offered after it.
   */
  #maybeShowGameOver() {
    const snapshot = this.#snapshot;
    if (snapshot === null || !snapshot.isOver || this.#gameOverShown || this.#backlog.length > 0 || this.#presenter.isBusy) {
      return;
    }
    if (this.#ending === null) {
      this.#ending = this.#endingFor(snapshot);
      this.#rebuild();
      return;
    }
    if (this.#ending.isDone) {
      this.#gameOverShown = true;
      this.#showGameOver(snapshot);
    }
  }

  /**
   * How this match ends on screen: whose crystal breaks (nobody's when it was
   * conceded), and the outcome as the viewer sees it.
   * @param {Snapshot} snapshot
   */
  #endingFor(snapshot) {
    const layout = /** @type {import("../board/BoardLayout.js").BoardLayout} */ (this.#layout);
    const conceded = snapshot.endReason === GameEndReason.CONCEDE;
    const crystals = conceded
      ? []
      : snapshot.players.filter((player) => player.life <= 0).flatMap((player) => {
          const seat = [layout.me, layout.opponent].find((candidate) => candidate.id === player.id);
          return seat === undefined ? [] : [lifeCrystalCentre(seat.hud)];
        });
    return new GameOverSequence({ mood: moodFor(snapshot, this.#viewer()), title: outcomeFor(snapshot, this.#viewer()), subtitle: reasonFor(snapshot), crystals, animation: this.services.theme.animation });
  }

  /**
   * A local session answers at once; an online one when the server acknowledges.
   * @param {Readonly<Record<string, unknown>>} command
   */
  #submit(command) {
    const result = this.#session?.submit(command);
    if (result instanceof Promise) {
      this.#submitting = true;
      this.#rebuild();
      result.then((settled) => {
        this.#submitting = false;
        this.#onSubmitted(settled);
        this.#rebuild();
      });
    } else if (result !== undefined) {
      this.#onSubmitted(result);
    }
  }

  /** @param {import("@magic8/engine/shared/Result.js").Result<unknown>} result */
  #onSubmitted(result) {
    if (!result.ok) {
      this.#soundscape?.rejected();
      this.#log = [...this.#log, { text: `Rejected: ${result.error.message}`, kind: LogKind.REJECTED }].slice(-MAX_LOG_ENTRIES);
      this.#interaction?.cancel();
      this.#rebuild();
    }
  }

  /** @param {string} id card instance or player id */
  #tap(id) {
    if (this.isBusy || this.#coach?.allowsTap(id) === false) {
      return;
    }
    const command = this.#interaction?.tap(id) ?? null;
    if (command !== null) {
      this.#submit(command);
      return;
    }
    this.#rebuild();
  }

  #rebuild() {
    const snapshot = this.#snapshot;
    const layout = this.#layout;
    const interaction = this.#interaction;
    if (snapshot === null || layout === null || interaction === null) {
      return;
    }
    this.#builtBusy = this.isBusy;
    this.#builtLesson = this.#showsLesson;
    const focusedId = this.focusedNode?.id ?? "";
    const reopen = this.modal?.id ?? null;
    this.closeModal();
    this.root.clear();
    this.root.add(this.#boardFor(snapshot, layout));
    this.root.add(new ClockNode({ x: layout.clock.x, y: layout.clock.y, size: layout.clock.width, clock: () => this.#clockView(), now: this.#now }));
    this.#buildPlayers(snapshot, layout, interaction);
    this.#buildCards(snapshot, layout, interaction);
    this.#buildPicked(snapshot, layout, interaction);
    this.root.add(new EffectsNode({ presenter: this.#presenter, layout, blocks: allBlocks(snapshot, interaction), turnLabel: (playerId) => this.#turnLabel(snapshot, playerId) }));
    this.#buildSidebar(snapshot, layout, interaction);
    this.#buildLog(layout);
    this.#buildCoach(snapshot, layout, interaction);
    this.#buildCoinToss(snapshot);
    this.#buildEnding(layout);
    this.#reopen(reopen, snapshot);
    const scope = this.modal ?? this.root;
    const fallback = this.modal === null ? this.root.findById("coach.next") : this.modal.focusableNodes()[0] ?? null;
    this.focus(scope.findById(focusedId) ?? fallback);
    this.services.requestRender();
  }

  /**
   * Opens again, over the rebuilt board, the dialogs that outlive a rebuild:
   * the result, and the sound settings (they stay open while the opponent plays on).
   * @param {string | null} modalId the dialog open before the rebuild
   * @param {Snapshot} snapshot
   */
  #reopen(modalId, snapshot) {
    if (modalId === "gameOver") {
      this.#showGameOver(snapshot);
    } else if (modalId === "audio") {
      this.#showAudioSettings();
    }
  }

  /**
   * The table itself; while the coin is tossed its banner and lit seat keep the result to themselves.
   * @param {Snapshot} snapshot
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   */
  #boardFor(snapshot, layout) {
    if (this.isTossing) {
      return new BoardNode({ layout, banner: TOSS_BANNER, activePlayerId: null });
    }
    // The tutorial's line takes the banner's place (turn and phase stay in the side panel).
    const banner = this.#coachLine() === null ? bannerFor(snapshot, this.#viewer()) : "";
    return new BoardNode({ layout, banner, activePlayerId: activeSeatFor(snapshot) });
  }

  /**
   * The tutorial task's line over the middle of the table, if one is shown
   * there: not while a card is held up to be read (it covers the middle of
   * the table; the line stays in the side panel).
   */
  #coachLine() {
    const interaction = this.#interaction;
    if (this.#coach === null || interaction === null || interaction.pickedCardId !== null || this.isTossing || this.isEnding) {
      return null;
    }
    return this.#coach.hintFor(coachIntent(interaction));
  }

  /**
   * @param {Snapshot} snapshot
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   * @param {MatchInteraction} interaction
   */
  #buildPlayers(snapshot, layout, interaction) {
    const online = this.#isOnline(snapshot);
    for (const seat of [layout.opponent, layout.me]) {
      const player = snapshot.players.find((candidate) => candidate.id === seat.id);
      if (player === undefined) {
        continue;
      }
      this.root.add(new PlayerNode({ player, rect: seat.hud, isMe: !this.#spectating && seat === layout.me, isActive: !this.isTossing && snapshot.activePlayerId === player.id, highlight: this.#highlightFor(interaction, player.id), onTap: (id) => this.#tap(id), lifeKick: () => this.#presenter.lifeKickFor(player.id), avatar: online ? player.name : null }));
    }
  }

  /**
   * Opponent battlefield, my battlefield, then my hand, so hand cards draw on top when they overlap.
   * @param {Snapshot} snapshot
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   * @param {MatchInteraction} interaction
   */
  #buildCards(snapshot, layout, interaction) {
    const opponent = snapshot.players.find((player) => player.id === layout.opponent.id);
    const me = snapshot.players.find((player) => player.id === layout.me.id);
    const cards = [...(opponent?.battlefield ?? []), ...(me?.battlefield ?? []), ...(me?.hand ?? [])];
    for (const card of cards) {
      const visual = this.#presenter.visualFor(card.instanceId);
      const slot = layout.cards[card.instanceId];
      if (visual === null || slot === undefined) {
        continue;
      }
      const highlight = this.#highlightFor(interaction, card.instanceId);
      this.root.add(new CardNode({ card, visual, slot, highlight, enabled: highlight !== null && highlight !== Highlight.ATTACKING, onTap: (id) => this.#tap(id), profile: boardFaceProfile(layout.face) }));
    }
  }

  /**
   * The hand card picked to be played, held up to be read until it is confirmed or put back.
   * @param {Snapshot} snapshot
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   * @param {MatchInteraction} interaction
   */
  #buildPicked(snapshot, layout, interaction) {
    const pickedId = interaction.pickedCardId;
    const card = pickedId === null ? undefined : snapshot.players.find((player) => player.id === layout.me.id)?.hand?.find((candidate) => candidate.instanceId === pickedId);
    if (card !== undefined && !this.isBusy) {
      this.root.add(new PickedCardNode({ card, layout }));
    }
  }

  /**
   * How a card or seat is marked. While moves are held back, the marks that
   * invite a tap (playable, targetable) are dropped — the table goes quiet
   * until it can be played again; those that describe the board stay.
   * @param {MatchInteraction} interaction
   * @param {string} id
   */
  #highlightFor(interaction, id) {
    const highlight = interaction.highlightFor(id);
    const quiet = this.isBusy || this.#coach?.allowsTap(id) === false;
    return quiet && INVITING.has(highlight ?? "") ? null : highlight;
  }

  /**
   * @param {Snapshot} snapshot
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   * @param {MatchInteraction} interaction
   */
  #buildSidebar(snapshot, layout, interaction) {
    const { sidebar } = layout;
    const metrics = layout.compact ? COMPACT_SIDEBAR : SIDEBAR;
    const panel = this.root.add(new Panel({ id: "sidebar", ...sidebar, textured: true }));
    const width = sidebar.width - 2 * metrics.inset;
    panel.add(new Label({ x: metrics.inset, y: metrics.inset, width, height: metrics.titleHeight, text: snapshot.isOver ? "Match over" : `Turn ${snapshot.turnNumber}`, size: layout.compact && snapshot.isOver ? "body" : "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    panel.add(new Label({ x: metrics.inset, y: metrics.inset + metrics.titleHeight, width, height: metrics.phaseHeight, text: phaseName(snapshot.phase), size: "small", colorKey: "textMuted", align: "left", fit: true }));
    const prompt = this.#promptFor(snapshot, interaction);
    const promptArea = { id: "prompt", x: metrics.inset, y: metrics.promptTop, width, height: metrics.promptHeight, text: prompt, size: /** @type {const} */ ("small"), colorKey: "accent" };
    // The tutorial's lines name cards and buttons in colour.
    panel.add(this.#coach === null ? new TextBlock(promptArea) : new RichTextBlock({ ...promptArea, colorKey: "text" }));
    const specs = this.#sidebarButtons(snapshot, interaction).filter((spec) => spec.visible);
    // The compact column keeps leaving for its footer, beside the log.
    const footer = layout.compact ? specs.filter((spec) => spec.id === "leave") : [];
    let y = metrics.buttonsTop;
    for (const spec of specs.filter((candidate) => !footer.includes(candidate))) {
      const held = spec.plays ? this.isBusy : this.isTossing;
      panel.add(new Button({ id: spec.id, x: metrics.inset, y, width, height: metrics.buttonHeight, text: spec.text, enabled: spec.enabled && !held, variant: spec.variant, keepPlate: true, onActivate: spec.onActivate, ...(spec.cue === undefined ? {} : { cue: spec.cue }) }));
      y += metrics.buttonHeight + metrics.gap;
    }
    if (layout.compact) {
      this.#buildFooter(panel, footer, { width, height: sidebar.height, metrics });
    }
  }

  /**
   * The compact column's last row: the battle log, and leaving the match.
   * @param {Panel} panel
   * @param {{ id: string, text: string, shortText?: string, enabled: boolean, variant: import("../ui/Button.js").ButtonVariant, onActivate: () => void }[]} leave the leave button's spec, when shown
   * @param {{ width: number, height: number, metrics: { inset: number, gap: number, footerHeight: number } }} column its inner width, its height, and its metrics
   */
  #buildFooter(panel, leave, { width, height, metrics }) {
    const footerY = height - metrics.inset - metrics.footerHeight;
    const logWidth = Math.round(width * COMPACT_LOG_SHARE);
    panel.add(new Button({ id: "log.open", x: metrics.inset, y: footerY, width: logWidth, height: metrics.footerHeight, text: "Log", textSize: "small", keepPlate: true, onActivate: () => this.#showLog() }));
    for (const spec of leave) {
      panel.add(new Button({ id: spec.id, x: metrics.inset + logWidth + metrics.gap, y: footerY, width: width - logWidth - metrics.gap, height: metrics.footerHeight, text: spec.shortText ?? spec.text, enabled: spec.enabled && !this.isTossing, variant: spec.variant, textSize: "small", keepPlate: true, onActivate: spec.onActivate }));
    }
  }

  /**
   * @param {Snapshot} snapshot
   * @param {MatchInteraction} interaction
   */
  #promptFor(snapshot, interaction) {
    if (this.isTossing) {
      return "Tossing a coin for the first turn…";
    }
    if (this.#spectating) {
      return `Watching ${snapshot.players.map((player) => nameOf(snapshot, player.id)).join(" vs ")}`;
    }
    const coach = this.#coach;
    if ((coach?.lesson ?? null) !== null) {
      return "Read the tip, then press [Next].";
    }
    return coach?.hintFor(coachIntent(interaction)) ?? interaction.prompt;
  }

  /** True while the coach's lesson is on the board: it waits for the board to finish what it was showing. */
  get #showsLesson() {
    return (this.#coach?.lesson ?? null) !== null && !this.#presenter.isBusy && !this.isTossing && !this.isEnding;
  }

  /** @param {string} buttonId a side panel button that makes a move */
  #coachAllows(buttonId) {
    return this.#coach?.allowsButton(buttonId) ?? true;
  }

  /**
   * What the confirm button would send, as the coach checks it.
   * @param {MatchInteraction} interaction
   */
  #coachAllowsConfirm(interaction) {
    return this.#coach?.allowsConfirm(coachIntent(interaction)) ?? true;
  }

  /**
   * The tutorial on the board. A lesson: the table dimmed round what it is
   * about, its card clear of it, and arrows from the card to it. A task: its
   * line over the middle of the table, and arrows from there to what to tap
   * or press (once the board has played out what happened).
   * @param {Snapshot} snapshot
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   * @param {MatchInteraction} interaction
   */
  #buildCoach(snapshot, layout, interaction) {
    const coach = this.#coach;
    if (coach === null || this.isTossing || this.isEnding) {
      return;
    }
    const intent = coachIntent(interaction);
    const focus = coach.focusFor(intent);
    const targets = focus.map((target) => this.#focusRects(snapshot, layout, target));
    const rects = targets.flat();
    const lesson = coach.lesson;
    const clock = () => this.#elapsedMs;
    if (lesson !== null) {
      if (!this.#showsLesson) {
        return;
      }
      this.root.add(new CoachSpotlight({ area: this.services.viewport.bounds, holes: rects }));
      // A gem is kept in sight with the whole card it is on.
      const avoid = focus.flatMap((target, index) => (GEMS.has(target.split(":")[0]) ? BOARD_FOCUS.card(snapshot, layout, target.split(":")[1]) : targets[index]));
      const card = this.root.add(buildCoachCard({ lesson, layout, avoid, onNext: () => this.#nextLesson() }));
      this.root.add(new CoachFocus({ targets, origin: centreOf(card.bounds), clock, compact: layout.compact }));
      return;
    }
    // The arrows start under the line, so it is drawn over them.
    if (!this.isBusy && rects.length > 0) {
      const { banner } = layout;
      const keepClear = { x: banner.x, y: banner.y + banner.height / 2 - HINT_ROOM / 2, width: banner.width, height: HINT_ROOM };
      this.root.add(new CoachFocus({ targets, room: { column: banner, bounds: layout, keepClear }, clock, compact: layout.compact }));
    }
    const line = this.#coachLine();
    if (line !== null) {
      this.root.add(new CoachHint({ text: line, layout }));
    }
  }

  /**
   * Where a coach's focus target is on the board (see TutorialCoach's
   * FocusTarget): none when it is not there.
   * @param {Snapshot} snapshot
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   * @param {string} target
   * @returns {import("@magic8/engine/shared/geometry.js").Rect[]}
   */
  #focusRects(snapshot, layout, target) {
    const [kind, id] = target.split(":");
    if (kind === "button") {
      const button = this.root.findById(id);
      return button === null ? [] : [button.bounds];
    }
    return BOARD_FOCUS[kind]?.(snapshot, layout, id) ?? [];
  }

  /** The lesson is read: the board takes up what it held back. */
  #nextLesson() {
    const coach = this.#coach;
    if (coach === null || !coach.next()) {
      return;
    }
    if (this.#snapshot !== null) {
      coach.sync(this.#snapshot);
    }
    this.#rebuild();
  }

  /**
   * The toss over everything else, while it lasts.
   * @param {Snapshot} snapshot
   */
  #buildCoinToss(snapshot) {
    const flip = this.#coinFlip;
    if (flip === null) {
      return;
    }
    const { viewport } = this.services;
    const viewerId = this.#spectating ? null : this.#playerId;
    const online = this.#isOnline(snapshot);
    const accountOf = (playerId) => (online ? snapshot.players.find((player) => player.id === playerId)?.name ?? null : null);
    this.root.add(new CoinTossNode({ flip, ...viewport.bounds, stage: viewport.safeBounds, viewerId, nameOf: (playerId) => this.#displayName(snapshot, playerId), accountOf }));
  }

  /**
   * Online, every seat is a STEEM account (its name): the HUD and the toss show their profile pictures.
   * @param {Snapshot} snapshot
   */
  #isOnline(snapshot) {
    return snapshot.players.some((player) => this.#session?.controllerKindOf(player.id) === "remote");
  }

  /**
   * The end of the match over everything else, once it has begun.
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   */
  #buildEnding(layout) {
    if (this.#ending !== null) {
      this.root.add(new GameOverNode({ sequence: this.#ending, x: layout.x, y: layout.y, width: layout.width, height: layout.height, centreY: layout.banner.y + layout.banner.height / 2 }));
    }
  }

  /**
   * What the banner of a new turn says: the viewer's own turn, or whose it is.
   * @param {Snapshot} snapshot
   * @param {string} playerId
   * @returns {import("../board/EffectsNode.js").TurnLabel}
   */
  #turnLabel(snapshot, playerId) {
    const mine = !this.#spectating && playerId === this.#playerId;
    return Object.freeze({ text: mine ? "Your turn" : `${this.#displayName(snapshot, playerId)}'s turn`, mine });
  }

  /**
   * A player as the toss names them: @account for someone playing online, the seat name for the local AI.
   * @param {Snapshot} snapshot
   * @param {string} playerId
   */
  #displayName(snapshot, playerId) {
    if (this.#session?.controllerKindOf(playerId) === ControllerKind.AI) {
      return snapshot.players.find((player) => player.id === playerId)?.name ?? "?";
    }
    return nameOf(snapshot, playerId);
  }

  /**
   * @param {Snapshot} snapshot
   * @param {MatchInteraction} interaction
   * @returns {{ id: string, text: string, shortText?: string, visible: boolean, enabled: boolean, plays: boolean, variant: import("../ui/Button.js").ButtonVariant, onActivate: () => void, cue?: string }[]}
   *   `plays`: the button makes a move, so it waits while moves are held back; `shortText`: its label in a compact column's footer; `cue`: its sound, when not its variant's
   */
  #sidebarButtons(snapshot, interaction) {
    const moves = snapshot.legalMoves;
    const busy = interaction.mode === InteractionMode.TARGETING;
    const confirmLabel = interaction.confirmLabel;
    const playing = !snapshot.isOver && !this.#spectating;
    if (this.#spectating) {
      return [{ id: "leave", text: "Leave", visible: true, enabled: true, plays: false, variant: "secondary", onActivate: () => this.#leave(this.#againScene) }];
    }
    return [
      { id: "confirm", text: confirmLabel ?? "", visible: confirmLabel !== null, enabled: this.#coachAllowsConfirm(interaction), plays: true, variant: "primary", onActivate: () => this.#confirm() },
      { id: "cancel", text: "Cancel", visible: interaction.canCancel, enabled: true, plays: false, variant: "secondary", onActivate: () => this.onCancel() },
      { id: "endPhase", text: "End phase", visible: playing, enabled: moves?.canEndPhase === true && !busy && this.#coachAllows("endPhase"), plays: true, variant: "secondary", onActivate: () => this.#submit(endPhase(this.#playerId)) },
      { id: "endTurn", text: this.#keyHints() ? "End turn (E)" : "End turn", visible: playing, enabled: moves?.canEndTurn === true && !busy && this.#coachAllows("endTurn"), plays: true, variant: "primary", cue: SoundCue.TURN_END, onActivate: () => this.#submit(endTurn(this.#playerId)) },
      this.#leaveButton(snapshot),
    ];
  }

  /**
   * Conceding, or once the match is over going back to the menu; the tutorial is simply left.
   * @param {Snapshot} snapshot
   */
  #leaveButton(snapshot) {
    const base = { id: "leave", visible: true, enabled: true, plays: false };
    if (snapshot.isOver) {
      return { ...base, text: "Back to menu", shortText: "Menu", variant: /** @type {const} */ ("secondary"), onActivate: () => this.#leave(SceneId.MAIN_MENU) };
    }
    if (this.#coach !== null) {
      return { ...base, text: "Leave tutorial", shortText: "Leave", variant: /** @type {const} */ ("secondary"), onActivate: () => this.#confirmLeaveTutorial() };
    }
    return { ...base, text: "Concede", shortText: "Concede", variant: /** @type {const} */ ("danger"), onActivate: () => this.#confirmConcede() };
  }

  /** Keyboard shortcuts are worth naming only to someone with a keyboard at hand. */
  #keyHints() {
    return !this.services.viewport.compact && this.services.usingTouch?.() !== true;
  }

  /** @param {import("../board/BoardLayout.js").BoardLayout} layout */
  #buildLog(layout) {
    const { log } = layout;
    if (log === null) {
      return;
    }
    const panel = this.root.add(new Panel({ id: "log", ...log, textured: true }));
    const width = log.width - 2 * LOG.inset;
    const audio = this.#audio;
    const soundWidth = audio === undefined ? 0 : SOUND_BUTTON.width;
    panel.add(new Label({ x: LOG.inset, y: LOG.inset, width: width - soundWidth, height: LOG.headerHeight, text: "Battle log", size: "small", weight: "bold", colorKey: "accent", align: "left" }));
    if (audio !== undefined) {
      const y = LOG.inset + (LOG.headerHeight - SOUND_BUTTON.height) / 2;
      panel.add(new Button({ id: "sound", x: LOG.inset + width - soundWidth, y, width: soundWidth, height: SOUND_BUTTON.height, text: soundLabel(audio.settings), textSize: "small", onActivate: () => this.#showAudioSettings() }));
    }
    const top = LOG.inset + LOG.headerHeight;
    panel.add(new BattleLogNode({ id: "log.entries", x: LOG.inset, y: top, width, height: Math.max(0, log.height - top - LOG.inset), entries: this.#log, view: this.#logScroll }));
  }

  #confirm() {
    if (this.isBusy || (this.#interaction !== null && !this.#coachAllowsConfirm(this.#interaction))) {
      return;
    }
    const command = this.#interaction?.confirm() ?? null;
    if (command !== null) {
      this.#submit(command);
      return;
    }
    // A picked card that needs a target goes on to targeting.
    this.#rebuild();
  }

  /** The battle log over the board (a compact board has no panel for it). */
  #showLog() {
    const { viewport } = this.services;
    const panelWidth = Math.min(LOG_MODAL.width, viewport.logicalWidth - 2 * LOG_MODAL.margin);
    const panelHeight = Math.min(LOG_MODAL.height, viewport.logicalHeight - 2 * LOG_MODAL.margin);
    const modal = new Modal({ id: "logModal", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth, panelHeight, onDismiss: () => this.closeModal() });
    const { panel } = modal;
    const inset = LOG.inset + 8;
    const closeWidth = 110;
    const audio = this.#audio;
    const soundWidth = audio === undefined ? 0 : SOUND_BUTTON.dialogWidth + LOG.inset;
    panel.add(new Label({ x: inset, y: inset, width: panelWidth - 2 * inset - closeWidth - soundWidth, height: 36, text: "Battle log", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    if (audio !== undefined) {
      panel.add(new Button({ id: "logModal.sound", x: panelWidth - inset - closeWidth - soundWidth, y: inset, width: SOUND_BUTTON.dialogWidth, height: 40, text: soundLabel(audio.settings), textSize: "small", onActivate: () => this.#showAudioSettings() }));
    }
    panel.add(new Button({ id: "logModal.close", x: panelWidth - inset - closeWidth, y: inset, width: closeWidth, height: 40, text: "Close", textSize: "small", onActivate: () => this.closeModal() }));
    const top = inset + 48;
    panel.add(new BattleLogNode({ id: "logModal.entries", x: inset, y: top, width: panelWidth - 2 * inset, height: panelHeight - top - inset, entries: this.#log, view: this.#logScroll }));
    this.openModal(modal);
  }

  /** The sound settings over the board; the match plays on underneath. */
  #showAudioSettings() {
    const audio = this.#audio;
    if (audio === undefined) {
      return;
    }
    this.openModal(buildAudioSettingsModal({ viewport: this.services.viewport, audio, onClose: () => this.#closeAudioSettings(), requestRender: this.services.requestRender }));
  }

  /** Back to the board, its Sound buttons saying how the game now sounds. */
  #closeAudioSettings() {
    this.closeModal();
    this.#rebuild();
  }

  #confirmConcede() {
    this.openModal(
      buildConfirmModal({
        viewport: this.services.viewport,
        title: "Concede the match?",
        message: "The opponent wins immediately.",
        confirmText: "Concede",
        destructive: true,
        onConfirm: () => {
          this.closeModal();
          this.#submit(concede(this.#playerId));
        },
        onCancel: () => this.closeModal(),
      }),
    );
  }

  #confirmLeaveTutorial() {
    this.openModal(
      buildConfirmModal({
        viewport: this.services.viewport,
        title: "Leave the tutorial?",
        message: "You can play it again from the main menu.",
        confirmText: "Leave",
        onConfirm: () => this.#leave(SceneId.MAIN_MENU),
        onCancel: () => this.closeModal(),
      }),
    );
  }

  /** @param {Snapshot} snapshot */
  #showGameOver(snapshot) {
    const { viewport } = this.services;
    const size = viewport.compact ? COMPACT_GAME_OVER : GAME_OVER;
    const modal = new Modal({ id: "gameOver", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: size.width, panelHeight: size.height, onDismiss: () => this.closeModal() });
    const { panel } = modal;
    const width = size.width - 2 * PANEL_INSET;
    const victory = this.#spectating || snapshot.winnerId === this.#playerId;
    const top = viewport.compact ? 24 : 40;
    panel.add(new Label({ x: PANEL_INSET, y: top, width, height: 90, text: outcomeFor(snapshot, this.#viewer()), size: "title", weight: "bold", colorKey: victory ? "accentLight" : "danger", glow: true }));
    const tutorial = this.#coach !== null;
    const subtitle = tutorial && snapshot.winnerId === this.#playerId ? "Tutorial complete: you know the basics!" : reasonFor(snapshot);
    panel.add(new Label({ x: PANEL_INSET, y: top + 100, width, height: 30, text: subtitle, size: "body", colorKey: "textMuted", fit: true }));
    const third = (width - 2 * 14) / 3;
    const y = size.height - 20 - 52;
    const again = this.#spectating ? "Watch another" : "Play again";
    panel.add(new Button({ id: "gameOver.again", x: PANEL_INSET, y, width: third, height: 52, text: tutorial ? "Practice vs AI" : again, variant: "primary", onActivate: () => this.#leave(this.#againScene) }));
    panel.add(new Button({ id: "gameOver.menu", x: PANEL_INSET + third + 14, y, width: third, height: 52, text: "Back to menu", onActivate: () => this.#leave(SceneId.MAIN_MENU) }));
    panel.add(new Button({ id: "gameOver.board", x: PANEL_INSET + 2 * (third + 14), y, width: third, height: 52, text: "View board", onActivate: () => this.closeModal() }));
    this.openModal(modal);
  }

  /** @param {import("../cards/CardDetail.js").CardLike} card */
  #showInspect(card) {
    const { viewport } = this.services;
    if (viewport.compact) {
      this.#showCompactInspect(card);
      return;
    }
    const modal = new Modal({ id: "inspect", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: INSPECT.width, panelHeight: INSPECT.height, onDismiss: () => this.closeModal() });
    const { panel } = modal;
    panel.add(new CardDetail({ id: "inspect.card", x: (INSPECT.width - INSPECT.card.width) / 2, y: 20, width: INSPECT.card.width, height: INSPECT.card.height, card, rarity: this.#rarityOf(card.definitionId ?? card.id ?? "") }));
    panel.add(new Button({ id: "inspect.close", x: (INSPECT.width - INSPECT.card.width) / 2, y: INSPECT.height - 20 - 48, width: INSPECT.card.width, height: 48, text: "Close", onActivate: () => this.closeModal() }));
    this.openModal(modal);
  }

  /**
   * The inspect view on a phone: the card as tall as the screen allows, Close beside it.
   * @param {import("../cards/CardDetail.js").CardLike} card
   */
  #showCompactInspect(card) {
    const { viewport } = this.services;
    const size = COMPACT_INSPECT;
    const modal = new Modal({ id: "inspect", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: size.width, panelHeight: size.height, onDismiss: () => this.closeModal() });
    const { panel } = modal;
    const margin = (size.height - size.card.height) / 2;
    panel.add(new CardDetail({ id: "inspect.card", x: margin, y: margin, width: size.card.width, height: size.card.height, card, rarity: this.#rarityOf(card.definitionId ?? card.id ?? "") }));
    panel.add(new Button({ id: "inspect.close", x: size.width - margin - size.close.width, y: margin, width: size.close.width, height: size.close.height, text: "Close", onActivate: () => this.closeModal() }));
    this.openModal(modal);
  }

  /** Who is looking at the board. */
  #viewer() {
    return Object.freeze({ playerId: this.#playerId, spectating: this.#spectating });
  }

  /** @param {string} sceneId */
  #leave(sceneId) {
    this.#session?.stop();
    this.services.navigate(sceneId);
  }
}

/**
 * @typedef {(snapshot: Snapshot, layout: import("../board/BoardLayout.js").BoardLayout, id: string) => import("@magic8/engine/shared/geometry.js").Rect[]} FocusResolver
 */

/**
 * Where the coach's focus targets lie on the board, by kind (see TutorialCoach's FocusTarget).
 * @type {Readonly<Record<string, FocusResolver>>}
 */
const BOARD_FOCUS = Object.freeze({
  card: (snapshot, layout, id) => (layout.cards[id] === undefined ? [] : [layout.cards[id]]),
  cost: (snapshot, layout, id) => gemRect(snapshot, layout, id, "cost"),
  attack: (snapshot, layout, id) => gemRect(snapshot, layout, id, "attack"),
  health: (snapshot, layout, id) => gemRect(snapshot, layout, id, "health"),
  hud: (snapshot, layout, side) => [seatOn(layout, side).hud],
  life: (snapshot, layout, side) => {
    const crystal = lifeCrystalCentre(seatOn(layout, side).hud);
    return [{ x: crystal.x - crystal.radius, y: crystal.y - crystal.radius, width: 2 * crystal.radius, height: 2 * crystal.radius }];
  },
  mana: (snapshot, layout, side) => resourceRects(seatOn(layout, side).hud, playerOn(snapshot, layout, side)?.resources.max ?? 0),
  hand: (snapshot, layout, side) => handRect(layout, playerOn(snapshot, layout, side)?.hand ?? []),
});

/** How tall the tutorial's line over the table may be: arrows keep clear of it. */
const HINT_ROOM = 56;

/** The focus kinds that are a gem on a card. */
const GEMS = new Set(["cost", "attack", "health"]);

/**
 * @param {import("../board/BoardLayout.js").BoardLayout} layout
 * @param {string} side "mine" or "theirs"
 */
function seatOn(layout, side) {
  return side === "mine" ? layout.me : layout.opponent;
}

/**
 * @param {Snapshot} snapshot
 * @param {import("../board/BoardLayout.js").BoardLayout} layout
 * @param {string} side "mine" or "theirs"
 */
function playerOn(snapshot, layout, side) {
  const seat = seatOn(layout, side);
  return snapshot.players.find((player) => player.id === seat.id);
}

/**
 * What the player has chosen so far, as the coach reads it.
 * @param {MatchInteraction} interaction
 * @returns {import("../../application/tutorial/TutorialCoach.js").Intent}
 */
function coachIntent(interaction) {
  return { pickedCardId: interaction.pickedCardId, targetingCardId: interaction.targetingCardId, attackerIds: interaction.selectedAttackerIds, pendingBlockerId: interaction.pendingBlockerId, blocks: interaction.pendingBlocks };
}

/** @param {import("@magic8/engine/shared/geometry.js").Rect} area */
function centreOf(area) {
  return { x: area.x + area.width / 2, y: area.y + area.height / 2 };
}

/**
 * One gem of a card on the board (its cost, attack or health), as a square round it.
 * @param {Snapshot} snapshot
 * @param {import("../board/BoardLayout.js").BoardLayout} layout
 * @param {string} instanceId
 * @param {"cost" | "attack" | "health"} gem
 * @returns {import("@magic8/engine/shared/geometry.js").Rect[]}
 */
function gemRect(snapshot, layout, instanceId, gem) {
  const slot = layout.cards[instanceId];
  const card = snapshot.players.flatMap((player) => [...(player.hand ?? []), ...player.battlefield]).find((candidate) => candidate.instanceId === instanceId);
  if (slot === undefined || card === undefined) {
    return [];
  }
  const { x, y, radius } = cardFaceLayout(slot, boardFaceProfile(layout.face), card.type)[gem];
  return [{ x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius }];
}

/**
 * The player's hand on the board: the cards' slots, as one area.
 * @param {import("../board/BoardLayout.js").BoardLayout} layout
 * @param {readonly { instanceId: string }[]} hand
 * @returns {import("@magic8/engine/shared/geometry.js").Rect[]}
 */
function handRect(layout, hand) {
  const slots = hand.map((card) => layout.cards[card.instanceId]).filter((slot) => slot !== undefined);
  if (slots.length === 0) {
    return [];
  }
  const left = Math.min(...slots.map((slot) => slot.x));
  const top = Math.min(...slots.map((slot) => slot.y));
  const right = Math.max(...slots.map((slot) => slot.x + slot.width));
  const bottom = Math.max(...slots.map((slot) => slot.y + slot.height));
  return [{ x: left, y: top, width: right - left, height: bottom - top }];
}

/**
 * Blocks to draw: the ones being assigned plus the ones already declared in the snapshot.
 * @param {Snapshot} snapshot
 * @param {MatchInteraction} interaction
 */
function allBlocks(snapshot, interaction) {
  const declared = snapshot.combat.blocks.flatMap((entry) => entry.blockerIds.map((blockerId) => ({ attackerId: entry.attackerId, blockerId })));
  return [...interaction.pendingBlocks, ...declared];
}

/**
 * Whose battlefield is lit: the active player's, nobody's once the match is over.
 * @param {Snapshot} snapshot
 */
function activeSeatFor(snapshot) {
  return snapshot.isOver ? null : snapshot.activePlayerId;
}

/** @typedef {Readonly<{ playerId: string, spectating: boolean }>} Viewer */

/**
 * @param {Snapshot} snapshot
 * @param {string | null} playerId
 */
const nameOf = (snapshot, playerId) => `@${snapshot.players.find((player) => player.id === playerId)?.name ?? "?"}`;

/**
 * @param {Snapshot} snapshot
 * @param {Viewer} viewer
 */
function bannerFor(snapshot, viewer) {
  if (snapshot.isOver) {
    return outcomeFor(snapshot, viewer);
  }
  let whose = snapshot.activePlayerId === viewer.playerId ? "Your turn" : "Opponent's turn";
  if (viewer.spectating) {
    whose = `${nameOf(snapshot, snapshot.activePlayerId)}'s turn`;
  }
  return `Turn ${snapshot.turnNumber} · ${whose} · ${phaseName(snapshot.phase)}`;
}

/**
 * @param {Snapshot} snapshot
 * @param {Viewer} viewer
 */
function outcomeFor(snapshot, viewer) {
  if (snapshot.winnerId === null) {
    return "Draw";
  }
  if (viewer.spectating) {
    return `${nameOf(snapshot, snapshot.winnerId)} wins`;
  }
  return snapshot.winnerId === viewer.playerId ? "Victory" : "Defeat";
}

/**
 * How the end feels to the viewer: a triumph for the winner (and for a
 * spectator, who watches someone win), a defeat for the loser, neither for a draw.
 * @param {Snapshot} snapshot
 * @param {Viewer} viewer
 */
function moodFor(snapshot, viewer) {
  if (snapshot.winnerId === null) {
    return GameOverMood.NEUTRAL;
  }
  return viewer.spectating || snapshot.winnerId === viewer.playerId ? GameOverMood.TRIUMPH : GameOverMood.DEFEAT;
}

/** @param {Snapshot} snapshot */
function reasonFor(snapshot) {
  const reasons = {
    [GameEndReason.LIFE_DEPLETED]: "Life reached zero.",
    [GameEndReason.CONCEDE]: "A player conceded.",
    [GameEndReason.DRAW]: "Both players fell at once.",
  };
  return reasons[snapshot.endReason ?? ""] ?? "The match ended.";
}

/** @param {import("../../application/audio/AudioSettings.js").AudioSettings} settings */
function soundLabel(settings) {
  return settings.muted ? "Muted" : "Sound";
}

/** @param {string} phase */
function phaseName(phase) {
  return phase.toLowerCase().replaceAll("_", " ");
}
