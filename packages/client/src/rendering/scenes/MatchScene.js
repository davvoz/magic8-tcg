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
 */
import { concede, endPhase, endTurn } from "@magic8/engine/domain/commands/commandFactories.js";
import { GameEndReason } from "@magic8/engine/domain/game/GameEventType.js";
import { KeyMap, isKey } from "../../input/KeyMap.js";
import { Highlight, InteractionMode, MatchInteraction } from "../../input/interaction/MatchInteraction.js";
import { BoardNode } from "../board/BoardNode.js";
import { CardNode } from "../board/CardNode.js";
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
const LOG_LINE_HEIGHT = 22;
const SIDEBAR = Object.freeze({ inset: 12, buttonHeight: 48, gap: 8, titleHeight: 36, phaseHeight: 26, promptTop: 84, promptHeight: 64, buttonsTop: 156 });
const LOG = Object.freeze({ inset: 8, headerHeight: 30 });
const GAME_OVER = Object.freeze({ width: 720, height: 320 });
const INSPECT = Object.freeze({ width: 440, height: 640, card: Object.freeze({ width: 380, height: 540 }) });

/** @typedef {ReturnType<import("../../application/match/MatchSession.js").MatchSession["snapshotFor"]>} Snapshot */

export class MatchScene extends Scene {
  /** @type {import("../../application/match/MatchSession.js").MatchSession | null} */
  #session = null;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  #playerId = "";
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

  /** @param {import("./Scene.js").SceneServices} services */
  constructor(services) {
    super(services);
    this.#presenter = new MatchPresenter(services.theme.animation);
  }

  /** @param {Readonly<Record<string, unknown>>} params `{ session: MatchSession }` */
  enter(params) {
    const session = /** @type {import("../../application/match/MatchSession.js").MatchSession | undefined} */ (params.session);
    if (session === undefined) {
      this.services.logger.error("MatchScene entered without a session");
      this.services.navigate(SceneId.MAIN_MENU);
      return;
    }
    this.#session = session;
    this.#playerId = session.humanPlayerIds[0] ?? "";
    this.#interaction = new MatchInteraction(this.#playerId);
    this.#unsubscribe = session.subscribe((update) => this.#onUpdate(update));
    this.#refresh([], false);
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  /** @param {number} dtMs */
  update(dtMs) {
    const inputChanged = super.update(dtMs);
    const changed = this.#presenter.update(dtMs) || inputChanged;
    this.#maybeShowGameOver();
    return changed;
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    const { theme, viewport } = this.services;
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "match", motes: false });
    super.render(context);
  }

  /** @param {import("../../input/InputManager.js").KeyInput} input */
  onKey(input) {
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

  /** @param {Readonly<Record<string, unknown>>} command */
  #submit(command) {
    const result = this.#session?.submit(command);
    if (result !== undefined && !result.ok) {
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
    this.root.add(new BoardNode({ layout, banner: bannerFor(snapshot, this.#playerId), activePlayerId: activeSeatFor(snapshot) }));
    this.#buildPlayers(snapshot, layout, interaction);
    this.#buildCards(snapshot, layout, interaction);
    this.root.add(new EffectsNode({ presenter: this.#presenter, layout, blocks: allBlocks(snapshot, interaction) }));
    this.#buildSidebar(snapshot, layout, interaction);
    this.#buildLog(layout);
    if (reopenGameOver) {
      this.#showGameOver(snapshot);
    }
    const scope = this.modal ?? this.root;
    const fallback = this.modal === null ? null : this.modal.focusableNodes()[0] ?? null;
    this.focus(scope.findById(focusedId) ?? fallback);
    this.services.requestRender();
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
      this.root.add(new PlayerNode({ player, rect: seat.hud, isMe: seat === layout.me, isActive: snapshot.activePlayerId === player.id, highlight: interaction.highlightFor(player.id), onTap: (id) => this.#tap(id), lifeShown: () => this.#presenter.lifeFor(player) }));
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
    panel.add(new TextBlock({ x: SIDEBAR.inset, y: SIDEBAR.promptTop, width, height: SIDEBAR.promptHeight, text: interaction.prompt, size: "small", colorKey: "accent" }));
    let y = SIDEBAR.buttonsTop;
    for (const spec of this.#sidebarButtons(snapshot, interaction)) {
      if (!spec.visible) {
        continue;
      }
      panel.add(new Button({ id: spec.id, x: SIDEBAR.inset, y, width, height: SIDEBAR.buttonHeight, text: spec.text, enabled: spec.enabled, variant: spec.variant, onActivate: spec.onActivate }));
      y += SIDEBAR.buttonHeight + SIDEBAR.gap;
    }
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
    return [
      { id: "confirm", text: confirmLabel ?? "", visible: confirmLabel !== null, enabled: true, variant: "primary", onActivate: () => this.#confirm() },
      { id: "cancel", text: "Cancel", visible: interaction.canCancel, enabled: true, variant: "secondary", onActivate: () => this.onCancel() },
      { id: "endPhase", text: "End phase", visible: !snapshot.isOver, enabled: moves?.canEndPhase === true && !busy, variant: "secondary", onActivate: () => this.#submit(endPhase(this.#playerId)) },
      { id: "endTurn", text: "End turn (E)", visible: !snapshot.isOver, enabled: moves?.canEndTurn === true && !busy, variant: "primary", onActivate: () => this.#submit(endTurn(this.#playerId)) },
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
    const victory = snapshot.winnerId === this.#playerId;
    panel.add(new Label({ x: 20, y: 40, width, height: 90, text: outcomeFor(snapshot, this.#playerId), size: "title", weight: "bold", colorKey: victory ? "accentLight" : "danger", glow: true }));
    panel.add(new Label({ x: 20, y: 140, width, height: 30, text: reasonFor(snapshot), size: "body", colorKey: "textMuted" }));
    const third = (width - 2 * 14) / 3;
    const y = GAME_OVER.height - 20 - 52;
    panel.add(new Button({ id: "gameOver.again", x: 20, y, width: third, height: 52, text: "Play again", variant: "primary", onActivate: () => this.#leave(SceneId.DECK_SELECTION) }));
    panel.add(new Button({ id: "gameOver.menu", x: 20 + third + 14, y, width: third, height: 52, text: "Back to menu", onActivate: () => this.#leave(SceneId.MAIN_MENU) }));
    panel.add(new Button({ id: "gameOver.board", x: 20 + 2 * (third + 14), y, width: third, height: 52, text: "View board", onActivate: () => this.closeModal() }));
    this.openModal(modal);
  }

  /** @param {import("@magic8/engine/domain/game/GameSnapshot.js").CardView} card */
  #showInspect(card) {
    const { viewport } = this.services;
    const modal = new Modal({ id: "inspect", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: INSPECT.width, panelHeight: INSPECT.height, onDismiss: () => this.closeModal() });
    const { panel } = modal;
    panel.add(new CardDetail({ id: "inspect.card", x: (INSPECT.width - INSPECT.card.width) / 2, y: 20, width: INSPECT.card.width, height: INSPECT.card.height, card }));
    panel.add(new Button({ id: "inspect.close", x: (INSPECT.width - INSPECT.card.width) / 2, y: INSPECT.height - 20 - 48, width: INSPECT.card.width, height: 48, text: "Close", onActivate: () => this.closeModal() }));
    this.openModal(modal);
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

/**
 * @param {Snapshot} snapshot
 * @param {string} playerId
 */
function bannerFor(snapshot, playerId) {
  if (snapshot.isOver) {
    return outcomeFor(snapshot, playerId);
  }
  const whose = snapshot.activePlayerId === playerId ? "Your turn" : "Opponent's turn";
  return `Turn ${snapshot.turnNumber} · ${whose} · ${phaseName(snapshot.phase)}`;
}

/**
 * @param {Snapshot} snapshot
 * @param {string} playerId
 */
function outcomeFor(snapshot, playerId) {
  if (snapshot.winnerId === null) {
    return "Draw";
  }
  return snapshot.winnerId === playerId ? "Victory" : "Defeat";
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
