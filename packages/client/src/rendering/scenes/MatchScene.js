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
import { computeBoardLayout } from "../board/BoardLayout.js";
import { MatchPresenter } from "../board/MatchPresenter.js";
import { PlayerNode } from "../board/PlayerNode.js";
import { describeEvent } from "../board/eventLog.js";
import { CardDetail } from "../cards/CardDetail.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { buildConfirmModal } from "../ui/ConfirmModal.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { Panel } from "../ui/Panel.js";
import { TextBlock } from "../ui/TextBlock.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

const MAX_LOG_LINES = 12;
const TOSS_BANNER = "Coin toss · who plays first?";
const LOG_LINE_HEIGHT = 22;
const SIDEBAR = Object.freeze({ inset: 12, buttonHeight: 48, gap: 8, titleHeight: 36, phaseHeight: 26, promptTop: 84, promptHeight: 64, buttonsTop: 156 });
const LOG = Object.freeze({ inset: 8, headerHeight: 30 });
const GAME_OVER = Object.freeze({ width: 720, height: 320 });
const INSPECT = Object.freeze({ width: 440, height: 640, card: Object.freeze({ width: 380, height: 540 }) });

/** @typedef {ReturnType<import("../../application/match/MatchSession.js").MatchSession["snapshotFor"]>} Snapshot */

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
    this.#log = [];
    this.#interaction = new MatchInteraction(this.#playerId);
    const toss = session.openingToss;
    this.#coinFlip = toss === null ? null : new CoinFlip({ toss, animation: this.services.theme.animation });
    this.#unsubscribe = session.subscribe((update) => this.#onUpdate(update));
    this.#refresh([], false);
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
    const changed = this.#presenter.update(dtMs) || inputChanged || tossChanged || this.#tickClock();
    this.#maybeShowGameOver();
    return changed;
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
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "match", motes: false });
    super.render(context);
  }

  /** @param {import("../../input/InputManager.js").KeyInput} input */
  onKey(input) {
    if (this.isTossing) {
      return;
    }
    if (input.type === "keydown" && isKey(input.key, KeyMap.END_TURN) && this.modal === null && this.#snapshot?.legalMoves?.canEndTurn === true) {
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

  /** @param {import("../../application/match/MatchSession.js").SessionUpdate} update */
  #onUpdate(update) {
    if (this.#session === null) {
      return;
    }
    this.#refresh(this.#session.eventsFor(update.events, this.#playerId), true);
  }

  /**
   * Pulls a fresh snapshot, re-lays out the board, feeds the presenter and rebuilds the tree.
   * @param {readonly Readonly<Record<string, unknown>>[]} events
   * @param {boolean} animate
   */
  #refresh(events, animate) {
    if (this.#session === null || this.#interaction === null) {
      return;
    }
    const snapshot = this.#session.snapshotFor(this.#playerId);
    this.#snapshot = snapshot;
    this.#layout = computeBoardLayout(snapshot, this.#playerId, this.services.viewport);
    this.#presenter.apply(snapshot, events, this.#layout, animate);
    const lines = events.map((event) => describeEvent(event, snapshot)).filter((line) => line !== null);
    this.#log = [...this.#log, ...lines].slice(-MAX_LOG_LINES);
    this.#interaction.sync(snapshot);
    this.#rebuild();
    this.#maybeShowGameOver();
  }

  /** The result waits for the opponent's last cast to play out: it is what ended the game. */
  #maybeShowGameOver() {
    const snapshot = this.#snapshot;
    if (snapshot !== null && snapshot.isOver && !this.#gameOverShown && this.#presenter.reveal === null) {
      this.#gameOverShown = true;
      this.#showGameOver(snapshot);
    }
  }

  /**
   * A local session answers at once; an online one when the server acknowledges.
   * @param {Readonly<Record<string, unknown>>} command
   */
  #submit(command) {
    const result = this.#session?.submit(command);
    if (result instanceof Promise) {
      result.then((settled) => this.#onSubmitted(settled));
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
    const focusedId = this.focusedNode?.id ?? "";
    const reopenGameOver = this.modal?.id === "gameOver";
    this.closeModal();
    this.root.clear();
    this.root.add(this.#boardFor(snapshot, layout));
    this.root.add(new ClockNode({ x: layout.clock.x, y: layout.clock.y, size: layout.clock.width, clock: () => this.#clockView(), now: this.#now }));
    this.#buildPlayers(snapshot, layout, interaction);
    this.#buildCards(snapshot, layout, interaction);
    this.root.add(new EffectsNode({ presenter: this.#presenter, layout, blocks: allBlocks(snapshot, interaction) }));
    this.#buildSidebar(snapshot, layout, interaction);
    this.#buildLog(layout);
    this.#buildCoinToss(snapshot);
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
      this.root.add(new PlayerNode({ player, rect: seat.hud, isMe: !this.#spectating && seat === layout.me, isActive: !this.isTossing && snapshot.activePlayerId === player.id, highlight: interaction.highlightFor(player.id), onTap: (id) => this.#tap(id), lifeShown: () => this.#presenter.lifeFor(player) }));
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
      const highlight = interaction.highlightFor(card.instanceId);
      this.root.add(new CardNode({ card, visual, slot, highlight, enabled: highlight !== null && highlight !== Highlight.ATTACKING, onTap: (id) => this.#tap(id) }));
    }
  }

  /**
   * @param {Snapshot} snapshot
   * @param {import("../board/BoardLayout.js").BoardLayout} layout
   * @param {MatchInteraction} interaction
   */
  #buildSidebar(snapshot, layout, interaction) {
    const { sidebar } = layout;
    const panel = this.root.add(new Panel({ id: "sidebar", ...sidebar }));
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
      panel.add(new Button({ id: spec.id, x: SIDEBAR.inset, y, width, height: SIDEBAR.buttonHeight, text: spec.text, enabled: spec.enabled && !this.isTossing, variant: spec.variant, onActivate: spec.onActivate }));
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
   * @returns {{ id: string, text: string, visible: boolean, enabled: boolean, variant: import("../ui/Button.js").ButtonVariant, onActivate: () => void }[]}
   */
  #sidebarButtons(snapshot, interaction) {
    const moves = snapshot.legalMoves;
    const busy = interaction.mode === InteractionMode.TARGETING;
    const confirmLabel = interaction.confirmLabel;
    const playing = !snapshot.isOver && !this.#spectating;
    if (this.#spectating) {
      return [{ id: "leave", text: "Leave", visible: true, enabled: true, variant: "secondary", onActivate: () => this.#leave(this.#againScene) }];
    }
    return [
      { id: "confirm", text: confirmLabel ?? "", visible: confirmLabel !== null, enabled: true, variant: "primary", onActivate: () => this.#confirm() },
      { id: "cancel", text: "Cancel", visible: interaction.canCancel, enabled: true, variant: "secondary", onActivate: () => this.onCancel() },
      { id: "endPhase", text: "End phase", visible: playing, enabled: moves?.canEndPhase === true && !busy, variant: "secondary", onActivate: () => this.#submit(endPhase(this.#playerId)) },
      { id: "endTurn", text: "End turn (E)", visible: playing, enabled: moves?.canEndTurn === true && !busy, variant: "primary", onActivate: () => this.#submit(endTurn(this.#playerId)) },
      { id: "leave", text: snapshot.isOver ? "Back to menu" : "Concede", visible: true, enabled: true, variant: snapshot.isOver ? "secondary" : "danger", onActivate: () => (snapshot.isOver ? this.#leave(SceneId.MAIN_MENU) : this.#confirmConcede()) },
    ];
  }

  /** @param {import("../board/BoardLayout.js").BoardLayout} layout */
  #buildLog(layout) {
    const { log } = layout;
    const panel = this.root.add(new Panel({ id: "log", ...log }));
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
