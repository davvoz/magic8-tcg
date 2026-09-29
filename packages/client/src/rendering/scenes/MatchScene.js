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
 */
import { concede, endPhase, endTurn } from "@magic8/engine/domain/commands/commandFactories.js";
import { ControllerKind } from "../../application/match/PlayerController.contract.js";
import { GameEndReason } from "@magic8/engine/domain/game/GameEventType.js";
import { KeyMap, isKey } from "../../input/KeyMap.js";
import { Highlight, InteractionMode, MatchInteraction } from "../../input/interaction/MatchInteraction.js";
import { BoardNode } from "../board/BoardNode.js";
import { CardNode } from "../board/CardNode.js";
import { ClockNode } from "../board/ClockNode.js";
import { CoinFlip } from "../board/CoinFlip.js";
import { CoinTossNode } from "../board/CoinTossNode.js";
import { EffectsNode } from "../board/EffectsNode.js";
import { GameOverNode } from "../board/GameOverNode.js";
import { GameOverMood, GameOverSequence } from "../board/GameOverSequence.js";
import { computeBoardLayout } from "../board/BoardLayout.js";
import { MatchPresenter } from "../board/MatchPresenter.js";
import { PlayerNode, lifeCrystalCentre } from "../board/PlayerNode.js";
import { splitIntoBeats } from "../board/StepBeats.js";
import { describeEvent } from "../board/eventLog.js";
import { CardDetail } from "../cards/CardDetail.js";
import { drawTableBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { buildConfirmModal } from "../ui/ConfirmModal.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { Panel } from "../ui/Panel.js";
import { TextBlock } from "../ui/TextBlock.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const MAX_LOG_LINES = 12;
/** Updates allowed to wait their turn (however many beats each has); past this the oldest are shown at once, unanimated, so a fast match cannot leave the board far behind. */
const MAX_BACKLOG = 6;
const TOSS_BANNER = "Coin toss · who plays first?";
const LOG_LINE_HEIGHT = 22;
const SIDEBAR = Object.freeze({ inset: 12, buttonHeight: 48, gap: 8, titleHeight: 36, phaseHeight: 26, promptTop: 84, promptHeight: 64, buttonsTop: 156 });
const LOG = Object.freeze({ inset: 8, headerHeight: 30 });
const GAME_OVER = Object.freeze({ width: 720, height: 320 });
const INSPECT = Object.freeze({ width: 440, height: 640, card: Object.freeze({ width: 380, height: 540 }) });
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
  /** @type {string[]} */
  #log = [];
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

  /** @param {import("./Scene.js").SceneServices} services */
  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {{ rarityOf?: (cardId: string) => string | null, now?: () => number }} [cards] how rare a card is, for the inspect view; `now`: for the decision clock
   */
  constructor(services, { rarityOf = () => null, now = () => Date.now() } = {}) {
    super(services);
    this.#rarityOf = rarityOf;
    this.#now = now;
    this.#presenter = new MatchPresenter(services.theme.animation);
  }

  /** @param {Readonly<Record<string, unknown>>} params `{ session: MatchSession | RemoteMatchSession, againScene?: string }` */
  enter(params) {
    this.#againScene = typeof params.againScene === "string" ? params.againScene : SceneId.DECK_SELECTION;
    const session = /** @type {import("../../application/match/MatchSession.js").MatchSession | undefined} */ (params.session);
    if (session === undefined) {
      this.services.logger.error("MatchScene entered without a session");
      this.services.navigate(SceneId.MAIN_MENU);
      return;
    }
    this.#session = session;
    this.#playerId = session.humanPlayerIds[0] ?? "";
    this.#spectating = session.humanPlayerIds.length === 0;
    this.#gameOverShown = false;
    this.#ending = null;
    this.#backlog = [];
    this.#log = [];
    this.#interaction = new MatchInteraction(this.#playerId);
    const toss = session.openingToss;
    this.#coinFlip = toss === null ? null : new CoinFlip({ toss, animation: this.services.theme.animation });
    this.#unsubscribe = session.subscribe((update) => this.#onUpdate(update));
    this.#taken = session.snapshotFor(this.#playerId);
    this.#show({ snapshot: this.#taken, events: [], chained: false }, false);
    if (this.#coinFlip === null) {
      this.#begin();
    }
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#coinFlip = null;
  }

  /** @param {number} dtMs */
  update(dtMs) {
    const inputChanged = super.update(dtMs);
    const tossChanged = this.#advanceCoinFlip(dtMs);
    const presented = this.#presenter.update(dtMs);
    const caughtUp = this.#showNextStep();
    const ending = this.#ending?.update(dtMs) ?? false;
    const changed = presented || caughtUp || ending || inputChanged || tossChanged || this.#tickClock();
    this.#maybeShowGameOver();
    if (this.isBusy !== this.#builtBusy) {
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
    if (this.isTossing) {
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
    if (input.type === "keydown" && isKey(input.key, KeyMap.END_TURN) && this.modal === null && !this.isBusy && this.#snapshot?.legalMoves?.canEndTurn === true) {
      this.#submit(endTurn(this.#playerId));
      return;
    }
    super.onKey(input);
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
    this.#layout = computeBoardLayout(snapshot, this.#playerId, this.services.viewport);
    this.#presenter.apply(snapshot, events, this.#layout, { animate, outcome });
    const lines = events.map((event) => describeEvent(event, snapshot)).filter((line) => line !== null);
    this.#log = [...this.#log, ...lines].slice(-MAX_LOG_LINES);
    this.#interaction.sync(snapshot);
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
      this.#log = [...this.#log, `Rejected: ${result.error.message}`].slice(-MAX_LOG_LINES);
      this.#interaction?.cancel();
      this.#rebuild();
    }
  }

  /** @param {string} id card instance or player id */
  #tap(id) {
    if (this.isBusy) {
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
    const focusedId = this.focusedNode?.id ?? "";
    const reopenGameOver = this.modal?.id === "gameOver";
    this.closeModal();
    this.root.clear();
    this.root.add(this.#boardFor(snapshot, layout));
    this.root.add(new ClockNode({ x: layout.clock.x, y: layout.clock.y, size: layout.clock.width, clock: () => this.#clockView(), now: this.#now }));
    this.#buildPlayers(snapshot, layout, interaction);
    this.#buildCards(snapshot, layout, interaction);
    this.root.add(new EffectsNode({ presenter: this.#presenter, layout, blocks: allBlocks(snapshot, interaction), turnLabel: (playerId) => this.#turnLabel(snapshot, playerId) }));
    this.#buildSidebar(snapshot, layout, interaction);
    this.#buildLog(layout);
    this.#buildCoinToss(snapshot);
    this.#buildEnding(layout);
    if (reopenGameOver) {
      this.#showGameOver(snapshot);
    }
    const scope = this.modal ?? this.root;
    const fallback = this.modal === null ? null : this.modal.focusableNodes()[0] ?? null;
    this.focus(scope.findById(focusedId) ?? fallback);
    this.services.requestRender();
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
    return new BoardNode({ layout, banner: bannerFor(snapshot, this.#viewer()), activePlayerId: activeSeatFor(snapshot) });
  }

  /**
   * @param {Snapshot} snapshot
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   * @param {MatchInteraction} interaction
   */
  #buildPlayers(snapshot, layout, interaction) {
    for (const seat of [layout.opponent, layout.me]) {
      const player = snapshot.players.find((candidate) => candidate.id === seat.id);
      if (player === undefined) {
        continue;
      }
      this.root.add(new PlayerNode({ player, rect: seat.hud, isMe: !this.#spectating && seat === layout.me, isActive: !this.isTossing && snapshot.activePlayerId === player.id, highlight: this.#highlightFor(interaction, player.id), onTap: (id) => this.#tap(id), lifeKick: () => this.#presenter.lifeKickFor(player.id) }));
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
      this.root.add(new CardNode({ card, visual, slot, highlight, enabled: highlight !== null && highlight !== Highlight.ATTACKING, onTap: (id) => this.#tap(id) }));
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
    return this.isBusy && INVITING.has(highlight ?? "") ? null : highlight;
  }

  /**
   * @param {Snapshot} snapshot
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   * @param {MatchInteraction} interaction
   */
  #buildSidebar(snapshot, layout, interaction) {
    const { sidebar } = layout;
    const panel = this.root.add(new Panel({ id: "sidebar", ...sidebar, textured: true }));
    const width = sidebar.width - 2 * SIDEBAR.inset;
    panel.add(new Label({ x: SIDEBAR.inset, y: SIDEBAR.inset, width, height: SIDEBAR.titleHeight, text: snapshot.isOver ? "Match over" : `Turn ${snapshot.turnNumber}`, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    panel.add(new Label({ x: SIDEBAR.inset, y: SIDEBAR.inset + SIDEBAR.titleHeight, width, height: SIDEBAR.phaseHeight, text: phaseName(snapshot.phase), size: "small", colorKey: "textMuted", align: "left", fit: true }));
    const prompt = this.#promptFor(snapshot, interaction);
    panel.add(new TextBlock({ x: SIDEBAR.inset, y: SIDEBAR.promptTop, width, height: SIDEBAR.promptHeight, text: prompt, size: "small", colorKey: "accent" }));
    let y = SIDEBAR.buttonsTop;
    for (const spec of this.#sidebarButtons(snapshot, interaction)) {
      if (!spec.visible) {
        continue;
      }
      const held = spec.plays ? this.isBusy : this.isTossing;
      panel.add(new Button({ id: spec.id, x: SIDEBAR.inset, y, width, height: SIDEBAR.buttonHeight, text: spec.text, enabled: spec.enabled && !held, variant: spec.variant, onActivate: spec.onActivate }));
      y += SIDEBAR.buttonHeight + SIDEBAR.gap;
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
    return this.#spectating ? `Watching ${snapshot.players.map((player) => nameOf(snapshot, player.id)).join(" vs ")}` : interaction.prompt;
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
    this.root.add(new CoinTossNode({ flip, width: viewport.logicalWidth, height: viewport.logicalHeight, viewerId, nameOf: (playerId) => this.#displayName(snapshot, playerId) }));
  }

  /**
   * The end of the match over everything else, once it has begun.
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   */
  #buildEnding(layout) {
    if (this.#ending !== null) {
      this.root.add(new GameOverNode({ sequence: this.#ending, width: layout.width, height: layout.height, centreY: layout.banner.y + layout.banner.height / 2 }));
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
   * @returns {{ id: string, text: string, visible: boolean, enabled: boolean, plays: boolean, variant: import("../ui/Button.js").ButtonVariant, onActivate: () => void }[]}
   *   `plays`: the button makes a move, so it waits while moves are held back
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
      { id: "confirm", text: confirmLabel ?? "", visible: confirmLabel !== null, enabled: true, plays: true, variant: "primary", onActivate: () => this.#confirm() },
      { id: "cancel", text: "Cancel", visible: interaction.canCancel, enabled: true, plays: false, variant: "secondary", onActivate: () => this.onCancel() },
      { id: "endPhase", text: "End phase", visible: playing, enabled: moves?.canEndPhase === true && !busy, plays: true, variant: "secondary", onActivate: () => this.#submit(endPhase(this.#playerId)) },
      { id: "endTurn", text: "End turn (E)", visible: playing, enabled: moves?.canEndTurn === true && !busy, plays: true, variant: "primary", onActivate: () => this.#submit(endTurn(this.#playerId)) },
      { id: "leave", text: snapshot.isOver ? "Back to menu" : "Concede", visible: true, enabled: true, plays: false, variant: snapshot.isOver ? "secondary" : "danger", onActivate: () => (snapshot.isOver ? this.#leave(SceneId.MAIN_MENU) : this.#confirmConcede()) },
    ];
  }

  /** @param {import("../board/BoardLayout.js").BoardLayout} layout */
  #buildLog(layout) {
    const { log } = layout;
    const panel = this.root.add(new Panel({ id: "log", ...log, textured: true }));
    const width = log.width - 2 * LOG.inset;
    panel.add(new Label({ x: LOG.inset, y: LOG.inset, width, height: LOG.headerHeight, text: "Battle log", size: "small", weight: "bold", colorKey: "accent", align: "left" }));
    const top = LOG.inset + LOG.headerHeight;
    const capacity = Math.max(0, Math.floor((log.height - top - LOG.inset) / LOG_LINE_HEIGHT));
    const lines = this.#log.slice(-capacity);
    lines.forEach((line, index) => {
      const latest = index === lines.length - 1;
      panel.add(new Label({ x: LOG.inset, y: top + index * LOG_LINE_HEIGHT, width, height: LOG_LINE_HEIGHT, text: line, size: "small", colorKey: latest ? "text" : "textMuted", align: "left", fit: true }));
    });
  }

  #confirm() {
    if (this.isBusy) {
      return;
    }
    const command = this.#interaction?.confirm() ?? null;
    if (command !== null) {
      this.#submit(command);
    }
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

  /** @param {Snapshot} snapshot */
  #showGameOver(snapshot) {
    const { viewport } = this.services;
    const modal = new Modal({ id: "gameOver", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: GAME_OVER.width, panelHeight: GAME_OVER.height, onDismiss: () => this.closeModal() });
    const { panel } = modal;
    const width = GAME_OVER.width - 40;
    const victory = this.#spectating || snapshot.winnerId === this.#playerId;
    panel.add(new Label({ x: 20, y: 40, width, height: 90, text: outcomeFor(snapshot, this.#viewer()), size: "title", weight: "bold", colorKey: victory ? "accentLight" : "danger", glow: true }));
    panel.add(new Label({ x: 20, y: 140, width, height: 30, text: reasonFor(snapshot), size: "body", colorKey: "textMuted" }));
    const third = (width - 2 * 14) / 3;
    const y = GAME_OVER.height - 20 - 52;
    panel.add(new Button({ id: "gameOver.again", x: 20, y, width: third, height: 52, text: this.#spectating ? "Watch another" : "Play again", variant: "primary", onActivate: () => this.#leave(this.#againScene) }));
    panel.add(new Button({ id: "gameOver.menu", x: 20 + third + 14, y, width: third, height: 52, text: "Back to menu", onActivate: () => this.#leave(SceneId.MAIN_MENU) }));
    panel.add(new Button({ id: "gameOver.board", x: 20 + 2 * (third + 14), y, width: third, height: 52, text: "View board", onActivate: () => this.closeModal() }));
    this.openModal(modal);
  }

  /** @param {import("../cards/CardDetail.js").CardLike} card */
  #showInspect(card) {
    const { viewport } = this.services;
    const modal = new Modal({ id: "inspect", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: INSPECT.width, panelHeight: INSPECT.height, onDismiss: () => this.closeModal() });
    const { panel } = modal;
    panel.add(new CardDetail({ id: "inspect.card", x: (INSPECT.width - INSPECT.card.width) / 2, y: 20, width: INSPECT.card.width, height: INSPECT.card.height, card, rarity: this.#rarityOf(card.definitionId ?? card.id ?? "") }));
    panel.add(new Button({ id: "inspect.close", x: (INSPECT.width - INSPECT.card.width) / 2, y: INSPECT.height - 20 - 48, width: INSPECT.card.width, height: 48, text: "Close", onActivate: () => this.closeModal() }));
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

/** @param {string} phase */
function phaseName(phase) {
  return phase.toLowerCase().replaceAll("_", " ");
}
