/**
 * The challenges of the day (docs/tcg/24-sfide.md): today's three opponents
 * side by side, two characters and the boss, each with its words and, for
 * the boss, the rules it brings; under them what the player does next. The
 * screen speaks to the player: who they face and what they win, never how
 * the game is made.
 *
 * - First the day's track: Normal (a Core Mini Booster) or Hard (a Core
 *   Booster). It holds until tomorrow, so the screen asks first.
 * - Then, challenge after challenge: one of the player's decks (its row
 *   striped with its factions, as everywhere a deck is chosen; a click
 *   moves on to the next), and Fight.
 *   The game is an online game the server plays the character in; the
 *   screen hands over to the match as soon as it starts, and the match comes
 *   back here when it ends ("Play again"). A lost challenge is fought again.
 * - All three beaten: the pack won is in the collection, its cards marked
 *   first, as for a pack bought in the shop; the button stays for the day.
 *
 * The opponent's last words (the one the player just played) and the boss's
 * entrance line are told in the line at the top, in place of what the
 * challenges are. How the challenges work (the
 * Info screen) is in the bar. On a compact screen (a phone in landscape) the
 * three cards are narrower and keep only what matters.
 */
import { lineFor } from "../../application/daily/characters.js";
import { InfoTopicId } from "../../application/info/infoTopics.js";
import { DailyBusy } from "../../application/daily/DailyService.js";
import { packName } from "../../application/notifications/describeNotification.js";
import { OnlineStatus } from "../../application/online/OnlineService.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { deckSummary, mixBands } from "../cards/deckStripe.js";
import { buildConfirmModal } from "../ui/ConfirmModal.js";
import { Icon } from "../ui/icons.js";
import { Label } from "../ui/Label.js";
import { OptionRow } from "../ui/OptionRow.js";
import { COMPACT_CARD, OpponentCard, WIDE_CARD } from "./daily/OpponentCard.js";
import { deckKey } from "./lobby/LobbyScene.js";
import { SceneId } from "./sceneIds.js";
import { SectionScene } from "./SectionScene.js";

/**
 * @typedef {import("../../application/ports/DailyApi.contract.js").DailyDay} DailyDay
 * @typedef {import("../../application/ports/DailyApi.contract.js").DailyOpponent} DailyOpponent
 * @typedef {Readonly<{
 *   side: number, subtitle: { y: number, height: number }, cards: { top: number, height: number, gap: number },
 *   info: { y: number, height: number }, row: { y: number, height: number, gap: number },
 *   card: import("./daily/OpponentCard.js").OpponentCardMetrics,
 * }>} DailyLayout laid out in the content area the shell leaves (its title is the shell's)
 */

/** @type {DailyLayout} */
const WIDE = Object.freeze({
  side: 40,
  subtitle: Object.freeze({ y: 12, height: 30 }),
  cards: Object.freeze({ top: 52, height: 638, gap: 30 }),
  info: Object.freeze({ y: 698, height: 30 }),
  row: Object.freeze({ y: 736, height: 64, gap: 24 }),
  card: Object.freeze({ ...WIDE_CARD, portrait: 380 }),
});
/** @type {DailyLayout} */
const COMPACT = Object.freeze({
  side: 8,
  subtitle: Object.freeze({ y: 2, height: 20 }),
  cards: Object.freeze({ top: 24, height: 250, gap: 6 }),
  info: Object.freeze({ y: 276, height: 20 }),
  row: Object.freeze({ y: 298, height: 46, gap: 8 }),
  card: Object.freeze({ ...COMPACT_CARD, portrait: 140 }),
});
const MINUTE = 60_000;

export class DailyScene extends SectionScene {
  #app;
  #now;
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** The deck to fight with (the server's id), kept while the game runs. @type {string | null} */
  #deckId = null;
  /** The game this screen started and waits to hand over to the match. @type {string | null} */
  #awaiting = null;
  /** The minute the countdown last showed (it is redrawn when it changes). */
  #minute = -1;
  /** The time the opponents' portraits are drawn at, in ms: while they are on screen, every frame moves them. */
  #animationMs = 0;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {{ now?: () => number }} [clock]
   */
  constructor(services, app, { now = () => Date.now() } = {}) {
    super(services, app, { scene: SceneId.DAILY, title: "Challenges" });
    this.#app = app;
    this.#now = now;
  }

  /** @param {Readonly<Record<string, unknown>>} [params] `{ back?: string }`: where Back leads (Play by default) */
  enter(params = {}) {
    this.routeBack(params);
    const daily = this.#daily();
    this.#unsubscribes = [daily.subscribe(() => this.#rebuild())];
    if (this.#app.online !== undefined) {
      this.#unsubscribes.push(this.#app.online.subscribe((state) => this.#onOnline(state)));
    }
    void daily.refresh();
    this.setBarActions([{ id: "daily.help", icon: Icon.BOOK, caption: "How it works", enabled: this.services.hasScene(SceneId.INFO), onActivate: () => this.services.navigate(SceneId.INFO, { topic: InfoTopicId.CHALLENGES, ...this.backHere() }) }]);
    this.#rebuild();
  }

  exit() {
    this.#unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#unsubscribes = [];
    super.exit();
  }

  relayout() {
    this.#rebuild();
  }

  /** @param {number} dtMs */
  update(dtMs) {
    const minute = Math.floor(this.#now() / MINUTE);
    if (minute !== this.#minute && this.#daily().state.day !== null) {
      this.#rebuild();
    }
    this.#animationMs += dtMs;
    const animated = this.#daily().state.day !== null;
    return super.update(dtMs) || animated;
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "daily" });
    super.render(context);
  }

  /** @returns {DailyLayout} */
  get #m() {
    return this.services.viewport.compact ? COMPACT : WIDE;
  }

  #daily() {
    const daily = this.#app.daily;
    if (daily === undefined) {
      throw new Error("DailyScene needs the daily challenges service");
    }
    return daily;
  }

  /**
   * The game this screen asked for has started: the match takes over.
   * @param {import("../../application/online/OnlineService.js").OnlineState} state
   */
  #onOnline(state) {
    const session = state.session;
    if (this.#awaiting === null || session === null || session.gameId !== this.#awaiting) {
      return;
    }
    if (state.status === OnlineStatus.PLAYING && session.hasSnapshot && !session.isStopped) {
      this.#awaiting = null;
      this.services.navigate(SceneId.MATCH, { session, againScene: SceneId.DAILY });
    } else if (state.status === OnlineStatus.CANCELLED) {
      this.#awaiting = null;
      this.#rebuild();
    }
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.closeModal();
    this.root.clear();
    this.#minute = Math.floor(this.#now() / MINUTE);
    const { viewport } = this.services;
    const m = this.#m;
    const width = viewport.logicalWidth;
    const { day } = this.#daily().state;
    // The top line: what just happened (a game's last words, the boss's entrance, an error), else what the challenges are.
    const status = this.#status(day);
    const top = status.text === "" ? { id: "daily.subtitle", text: this.#subtitle(day), colorKey: "textMuted" } : { id: "daily.status", ...status };
    this.root.add(new Label({ ...top, x: m.side, y: m.subtitle.y, width: width - 2 * m.side, height: m.subtitle.height, size: viewport.compact ? "tiny" : "small", fit: true }));
    if (day !== null) {
      this.#buildCards(day);
    }
    const primary = this.#buildActions(day);
    this.focus(this.findNode(focusedId) ?? primary ?? this.backButton);
    this.services.requestRender();
  }

  /** @param {DailyDay | null} day */
  #subtitle(day) {
    if (day === null) {
      return "Three opponents, new every day. Beat them all to win a pack.";
    }
    const left = Math.max(0, day.endsAt - this.#now());
    const hours = Math.floor(left / (60 * MINUTE));
    const minutes = Math.floor((left % (60 * MINUTE)) / MINUTE);
    return `Three opponents, new every day. Beat them all to win a pack. New opponents in ${hours}h ${minutes}m.`;
  }

  /** @param {DailyDay} day */
  #buildCards(day) {
    const { viewport } = this.services;
    const m = this.#m;
    const count = day.opponents.length;
    const width = (viewport.logicalWidth - 2 * m.side - (count - 1) * m.cards.gap) / count;
    day.opponents.forEach((opponent, stage) => {
      // Before the fight they taunt; once beaten, they concede.
      const lines = opponent.state === "beaten" ? opponent.lines.lose : opponent.lines.intro;
      const quote = lineFor(lines, `${day.day}|${opponent.id}|${opponent.state}`);
      this.root.add(new OpponentCard({ id: `daily.opponent.${stage}`, x: m.side + stage * (width + m.cards.gap), y: m.cards.top, width, height: m.cards.height, opponent, stage, quote, metrics: m.card, compact: viewport.compact, clock: () => this.#animationMs }));
    });
  }

  /**
   * What the player does next: pick the track, fight the next opponent, or see the pack won.
   * @param {DailyDay | null} day
   * @returns {Button | null} the button to focus
   */
  #buildActions(day) {
    if (day === null) {
      return this.#buildRetry();
    }
    if (day.run === null) {
      return this.#buildTracks(day);
    }
    return day.run.rewarded ? this.#buildReward(day) : this.#buildFight(day);
  }

  /** Nothing read yet (or the server failed): a way to try again. */
  #buildRetry() {
    const { loading } = this.#daily().state;
    const m = this.#m;
    const width = Math.min(360, this.services.viewport.logicalWidth - 2 * m.side);
    return this.root.add(new Button({ id: "daily.retry", x: (this.services.viewport.logicalWidth - width) / 2, y: m.row.y, width, height: m.row.height, text: loading ? "Loading…" : "Try again", enabled: !loading, onActivate: () => void this.#daily().refresh() }));
  }

  /**
   * The two tracks, Normal first; choosing one asks first (it holds until tomorrow).
   * @param {DailyDay} day
   */
  #buildTracks(day) {
    const m = this.#m;
    const { viewport } = this.services;
    const busy = this.#daily().state.busy !== null;
    this.#info("Choose today's track: it holds until tomorrow.");
    const width = (viewport.logicalWidth - 2 * m.side - (day.tracks.length - 1) * m.row.gap) / day.tracks.length;
    /** @type {Button | null} */
    let first = null;
    day.tracks.forEach((track, index) => {
      const x = m.side + index * (width + m.row.gap);
      const button = this.root.add(new Button({ id: `daily.track.${track.id}`, x, y: m.row.y, width, height: m.row.height, text: `${track.name} · win a ${packName(track.reward)}`, variant: index === 0 ? "primary" : "secondary", enabled: !busy, onActivate: () => this.#confirmTrack(track) }));
      first ??= button;
    });
    return first;
  }

  /** @param {import("../../application/ports/DailyApi.contract.js").DailyTrack} track */
  #confirmTrack(track) {
    this.openModal(
      buildConfirmModal({
        viewport: this.services.viewport,
        title: `Play the ${track.name} track today?`,
        message: `Win all three challenges for a ${packName(track.reward)}. The track cannot be changed until tomorrow.`,
        confirmText: `Play ${track.name}`,
        onConfirm: () => {
          this.closeModal();
          void this.#daily().chooseTrack(track.id);
        },
        onCancel: () => this.closeModal(),
      }),
    );
  }

  /**
   * The next challenge: the deck to fight with and Fight (or back into the game in play).
   * @param {DailyDay} day
   */
  #buildFight(day) {
    const run = /** @type {NonNullable<DailyDay["run"]>} */ (day.run);
    const m = this.#m;
    const { viewport } = this.services;
    const next = day.opponents.find((opponent) => opponent.state === "next") ?? null;
    const track = day.tracks.find((candidate) => candidate.id === run.track);
    this.#info(`${track?.name ?? run.track} · beat all three to win a ${packName(track?.reward)}`);
    const decks = this.#decks();
    const deck = this.#chosenDeck(decks);
    const half = (viewport.logicalWidth - 2 * m.side - m.row.gap) / 2;
    this.#buildDeck(decks, deck, { x: m.side, width: half });
    const fight = this.#fightButton(run, { next, deck });
    return this.root.add(new Button({ id: "daily.fight", x: m.side + half + m.row.gap, y: m.row.y, width: half, height: m.row.height, ...fight, variant: "primary", onActivate: () => void this.#fight() }));
  }

  /**
   * The deck to fight with, as a deck row: its name, its size and factions, striped with them; a click moves on to the
   * next deck.
   * @param {readonly import("../../application/online/OnlineService.js").OnlineDeck[]} decks
   * @param {import("../../application/online/OnlineService.js").OnlineDeck | null} deck
   * @param {{ x: number, width: number }} place
   */
  #buildDeck(decks, deck, { x, width }) {
    const { row } = this.#m;
    if (deck === null) {
      this.root.add(new Button({ id: "daily.deck", x, y: row.y, width, height: row.height, text: "No playable deck", enabled: false, onActivate: () => undefined }));
      return;
    }
    const more = decks.length > 1 ? " · click to change" : "";
    this.root.add(new OptionRow({ id: "daily.deck", x, y: row.y, width, height: row.height, text: deck.name, subtitle: `${deckSummary(deck.totalCards, deck.mix)}${more}`, stripe: mixBands(this.services.theme, deck.mix), onActivate: () => this.#nextDeck(decks) }));
  }

  /**
   * The deck to fight with: the one chosen, while it can still be played, else the first that can.
   * @param {readonly import("../../application/online/OnlineService.js").OnlineDeck[]} decks the playable ones
   */
  #chosenDeck(decks) {
    // The one chosen here, else the deck the player plays with (wherever they chose it), else the first.
    const deck = decks.find((candidate) => candidate.id === this.#deckId) ?? this.#app.selectedDeck?.pick(decks, { idOf: deckKey }) ?? decks[0] ?? null;
    this.#deckId = deck?.id ?? null;
    return deck;
  }

  /**
   * What the Fight button says, and whether it can be pressed.
   * @param {NonNullable<DailyDay["run"]>} run
   * @param {{ next: DailyOpponent | null, deck: unknown }} choice
   * @returns {{ text: string, enabled: boolean }}
   */
  #fightButton(run, { next, deck }) {
    if (this.#daily().state.busy === DailyBusy.PLAY || this.#awaiting !== null) {
      return { text: "Starting…", enabled: false };
    }
    if (run.gameId !== null) {
      return { text: "Back to your game", enabled: true };
    }
    return { text: `Fight ${next?.name ?? ""}`, enabled: deck !== null && next !== null };
  }

  /**
   * All three beaten: the pack won, seen in the collection with its cards first.
   * @param {DailyDay} day
   */
  #buildReward(day) {
    const m = this.#m;
    const { viewport } = this.services;
    const reward = day.run?.reward ?? null;
    this.#info(`All three beaten: your ${packName(reward?.pack)} is in your collection. New challenges tomorrow.`);
    const width = (viewport.logicalWidth - 2 * m.side - m.row.gap) / 2;
    return this.root.add(new Button({ id: "daily.pack", x: (viewport.logicalWidth - width) / 2, y: m.row.y, width, height: m.row.height, text: "See the cards you won", variant: "primary", enabled: reward !== null && this.services.hasScene(SceneId.COLLECTION), onActivate: () => this.#showWon(reward) }));
  }

  /**
   * The collection, the cards just won marked at its top (as when a pack bought in the shop arrives).
   * @param {DailyDay["run"] extends infer R ? (R extends { reward: infer W } ? W : never) : never} reward
   */
  #showWon(reward) {
    if (reward === null) {
      return;
    }
    const fresh = reward.cards.map((card) => Object.freeze({ definitionId: card.definitionId, count: 1, serial: card.serial }));
    this.services.navigate(SceneId.COLLECTION, { fresh, ...this.backHere() });
  }

  /** @param {string} text the line above the actions */
  #info(text) {
    const m = this.#m;
    this.root.add(new Label({ id: "daily.info", x: m.side, y: m.info.y, width: this.services.viewport.logicalWidth - 2 * m.side, height: m.info.height, text, size: this.services.viewport.compact ? "tiny" : "small", weight: "bold", colorKey: "accent", fit: true }));
  }

  /** The account's decks the server would accept for a game. */
  #decks() {
    return (this.#app.online?.decks() ?? []).filter((deck) => deck.playable);
  }

  /** @param {readonly import("../../application/online/OnlineService.js").OnlineDeck[]} decks */
  #nextDeck(decks) {
    const index = decks.findIndex((deck) => deck.id === this.#deckId);
    const next = decks[(index + 1) % decks.length] ?? null;
    this.#deckId = next?.id ?? null;
    if (next !== null) {
      this.#app.selectedDeck?.choose(deckKey(next));
    }
    this.#rebuild();
  }

  /** Starts the next challenge (or goes back into the one in play): the match takes over once the game starts. */
  async #fight() {
    const online = this.#app.online;
    const run = this.#daily().state.day?.run ?? null;
    if (online === undefined || run === null || this.#resumed(online, run)) {
      return;
    }
    if (this.#deckId === null && run.gameId === null) {
      return;
    }
    const started = await this.#daily().play(this.#deckId ?? "");
    if (!started.ok) {
      this.#rebuild();
      return;
    }
    this.#awaiting = started.value;
    this.#onOnline(online.state);
    this.#rebuild();
  }

  /**
   * Back into the challenge in play, when this page already plays it.
   * @param {import("../../application/online/OnlineService.js").OnlineService} online
   * @param {NonNullable<DailyDay["run"]>} run
   * @returns {boolean} whether the match took over
   */
  #resumed(online, run) {
    const playing = online.state.session;
    if (run.gameId === null || playing === null || playing.gameId !== run.gameId || online.state.status !== OnlineStatus.PLAYING) {
      return false;
    }
    this.services.navigate(SceneId.MATCH, { session: online.resume(), againScene: SceneId.DAILY });
    return true;
  }

  /**
   * What the status line says: the server's work, a failure, the opponent's last words, the boss's entrance.
   * @param {DailyDay | null} day
   * @returns {{ text: string, colorKey: string }}
   */
  #status(day) {
    const { busy, error, loading } = this.#daily().state;
    if (busy === DailyBusy.PLAY || this.#awaiting !== null) {
      return { text: "Starting the game…", colorKey: "accent" };
    }
    if (error !== null) {
      return { text: error, colorKey: "danger" };
    }
    if (day === null) {
      return { text: loading ? "Loading today's challenges…" : "", colorKey: "textMuted" };
    }
    if (day.run !== null && !day.run.rewarded && this.#decks().length === 0) {
      return { text: "Build a playable deck in your collection to fight.", colorKey: "danger" };
    }
    return lastWords(day) ?? bossEntrance(day) ?? { text: "", colorKey: "textMuted" };
  }
}

/**
 * What the opponent of the last game said when it ended, until the next game.
 * @param {DailyDay} day
 * @returns {{ text: string, colorKey: string } | null}
 */
function lastWords(day) {
  const last = day.run?.last ?? null;
  const opponent = last === null ? undefined : day.opponents.find((candidate) => candidate.id === last.opponent);
  if (last === null || opponent === undefined || day.run?.gameId !== null) {
    return null;
  }
  const won = last.result === "win";
  const line = lineFor(won ? opponent.lines.lose : opponent.lines.win, `${last.gameId}|${won ? "lose" : "win"}`);
  const quote = line === null ? "" : ` “${line}”`;
  if (won) {
    return { text: `You beat ${opponent.name}.${quote}`, colorKey: "success" };
  }
  return { text: `${opponent.name} won this time.${quote} Fight again whenever you like.`, colorKey: "danger" };
}

/**
 * The boss's entrance, once it is the next challenge.
 * @param {DailyDay} day
 * @returns {{ text: string, colorKey: string } | null}
 */
function bossEntrance(day) {
  const boss = day.opponents.find((opponent) => opponent.boss && opponent.state === "next");
  const line = boss === undefined ? null : lineFor(boss.lines.unlock, `${day.day}|${boss.id}|unlock`);
  return line === null ? null : { text: line, colorKey: "danger" };
}
