/**
 * Play: every way to play, in one place. Across the top, the deck the
 * player plays with (SelectedDeck), and Change. Then four tiles, each with
 * what it is for and where the player stands with it: the daily challenges
 * (today's opponent in their portrait), online play (Casual, and Ranked
 * locked until the player may play it), practice against the AI (offline
 * too) and the tutorial. At the foot, the games being played now to watch,
 * and the player's own games and replays. What needs an account or the
 * game server stays in its place, locked, saying why.
 *
 * One gold button: the challenge's while one is to fight, else Casual, else Practice.
 */
import { deckMix } from "../../application/decks/deckMix.js";
import { deckSummary, mixBands } from "../cards/deckStripe.js";
import { SectionId } from "../shell/sections.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Icon } from "../ui/icons.js";
import { IconButton } from "../ui/IconButton.js";
import { PlayViews } from "./home/PlayViews.js";
import { DeckBar } from "./play/DeckBar.js";
import { buildDeckPicker } from "./play/DeckPicker.js";
import { PlayTile } from "./play/PlayTile.js";
import { SceneId } from "./sceneIds.js";
import { SectionScene } from "./SectionScene.js";
import { startTutorial } from "./startTutorial.js";

/** The frame: margins, gaps, the deck's bar and the links at the foot (a phone puts the links beside the bar). */
const FRAME = Object.freeze({
  wide: Object.freeze({ margin: 20, gap: 20, bar: 64, links: 56, link: 300 }),
  compact: Object.freeze({ margin: 8, gap: 8, bar: 46, links: 0, link: 46 }),
});
const MINUTE = 60_000;

/**
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 * @typedef {Readonly<{ bar: Rect, tiles: readonly Rect[], links: readonly Rect[] }>} PlayLayout
 */

export class PlayScene extends SectionScene {
  #app;
  #now;
  #views;
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** The animation time of the challenge's portrait. */
  #animationMs = 0;
  /** The minute the screen was last built for (when new opponents come). */
  #minute = -1;
  /** Whether the account was ready when last looked at: becoming ready reads what the tiles show of it. */
  #ready = false;
  /** Whether the deck picker is open: it stays open while the screen is built again (a service changed). */
  #picking = false;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {{ now?: () => number }} [clock]
   */
  constructor(services, app, { now = () => Date.now() } = {}) {
    super(services, app, { section: SectionId.PLAY, title: "Play" });
    this.#app = app;
    this.#now = now;
    this.#views = new PlayViews({ app, hasScene: services.hasScene, now });
  }

  enter() {
    const app = this.#app;
    const rebuild = () => this.#rebuild();
    for (const service of [app.daily, app.ranking, app.online, app.onboarding, app.selectedDeck]) {
      if (typeof service?.subscribe === "function") {
        this.#unsubscribes.push(service.subscribe(rebuild));
      }
    }
    if (app.account !== undefined) {
      this.#unsubscribes.push(app.account.subscribe(() => this.#onAccount()));
    }
    this.#ready = false;
    this.#onAccount();
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
    this.#animationMs += dtMs;
    if (Math.floor(this.#now() / MINUTE) !== this.#minute) {
      this.#rebuild();
    }
    const base = super.update(dtMs);
    return this.root.findById("play.daily.art") !== null || base;
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "play" });
    super.render(context);
  }

  /** The account loaded: read the day's challenges and the standing the tiles show. */
  #onAccount() {
    const ready = this.#views.signedIn;
    if (ready && !this.#ready) {
      void this.#app.daily?.refresh();
      void this.#app.ranking?.refresh();
    }
    this.#ready = ready;
    this.#rebuild();
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.closeModal();
    this.root.clear();
    this.#minute = Math.floor(this.#now() / MINUTE);
    const { viewport } = this.services;
    const compact = viewport.compact === true;
    const layout = playLayout(viewport);
    this.#buildDeckBar(layout.bar, compact);
    const challenge = this.#views.challenge();
    const online = this.#views.online();
    const gold = goldTile(challenge, online);
    const [daily, play, practice, tutorial] = layout.tiles;
    this.root.add(new PlayTile({ id: "play.daily", ...daily, compact, ...this.#dailyTile(challenge, gold === "daily") }));
    this.root.add(new PlayTile({ id: "play.online", ...play, compact, ...this.#onlineTile(online, gold === "online") }));
    this.root.add(new PlayTile({ id: "play.practice", ...practice, compact, ...this.#practiceTile(gold === "practice") }));
    this.root.add(new PlayTile({ id: "play.tutorial", ...tutorial, compact, ...this.#tutorialTile() }));
    this.#buildLinks(layout.links, compact);
    const goldId = { daily: "play.daily.play", online: "play.online.casual", practice: "play.practice.play" }[gold];
    this.focus(this.findNode(focusedId) ?? this.root.findById(goldId) ?? null);
    if (this.#picking) {
      this.#showPicker();
    }
    this.services.requestRender();
  }

  /**
   * @param {Rect} frame
   * @param {boolean} compact
   */
  #buildDeckBar(frame, compact) {
    const decks = this.#app.deckSelection.listDecks();
    const chosen = this.#chosenDeck(decks);
    const account = this.#app.account;
    /** @type {import("./play/DeckBar.js").DeckBarAction} */
    let action = { id: "play.deck.change", text: "Change", enabled: decks.length > 0, onActivate: () => this.#showPicker() };
    let empty = "No deck to play yet";
    if (chosen === null && account?.needsStarter === true) {
      action = { id: "play.deck.starter", text: compact ? "Get one" : "Get your starter deck", enabled: this.services.hasScene(SceneId.STARTER), onActivate: () => this.services.navigate(SceneId.STARTER) };
      empty = "No deck yet: your starter deck is free";
    } else if (chosen === null) {
      action = { id: "play.deck.build", text: compact ? "Build" : "Build a deck", enabled: this.services.hasScene(SceneId.DECK_BUILDER), onActivate: () => this.services.navigate(SceneId.DECK_BUILDER, { from: SceneId.PLAY }) };
    }
    const deck = chosen === null ? null : this.#shown(chosen);
    this.root.add(new DeckBar({ id: "play.deck", ...frame, compact, deck, empty, action }));
  }

  /**
   * The deck the player plays with, among the decks here: the one chosen while it can be played, else the first that can.
   * @param {readonly import("../../application/decks/DeckSelectionService.js").DeckOption[]} decks
   */
  #chosenDeck(decks) {
    const playable = (/** @type {import("../../application/decks/DeckSelectionService.js").DeckOption} */ option) => option.report.valid;
    return this.#app.selectedDeck?.pick(decks, { idOf: (option) => option.deck.id, playable }) ?? decks.find(playable) ?? null;
  }

  /** @param {import("../../application/decks/DeckSelectionService.js").DeckOption} option */
  #shown(option) {
    const mix = deckMix(this.#app.content, option.deck.entries);
    return Object.freeze({ name: option.deck.name, summary: deckSummary(option.deck.totalCards, mix), bands: mixBands(this.services.theme, mix) });
  }

  #showPicker() {
    const decks = this.#app.deckSelection.listDecks();
    this.#picking = true;
    const close = () => {
      this.#picking = false;
      this.closeModal();
    };
    const onChoose = (/** @type {string} */ deckId) => {
      close();
      this.#app.selectedDeck?.choose(deckId);
      this.#rebuild();
    };
    this.openModal(buildDeckPicker({ viewport: this.services.viewport, theme: this.services.theme, content: this.#app.content, decks, selectedId: this.#chosenDeck(decks)?.deck.id ?? null, onChoose, onClose: close }));
  }

  /**
   * @param {import("./home/ChallengeCard.js").ChallengeView} view
   * @param {boolean} primary
   */
  #dailyTile(view, primary) {
    const picture = view.kind === "next" ? { portrait: view.opponent, clock: () => this.#animationMs } : { icon: Icon.SEASON, faction: "arcane" };
    const status = dailyStatus(view);
    return {
      picture,
      kicker: "Solo · rewards",
      kickerKey: "focus",
      title: "Daily challenges",
      text: "Three opponents a day, new every day. Beat them all to win a pack of cards.",
      status,
      primary,
      actions: [{ id: "play.daily.play", text: view.kind === "done" ? "See the challenges" : "Play the challenge", locked: view.kind === "locked", variant: variantOf(primary), onActivate: () => this.services.navigate(SceneId.DAILY) }],
    };
  }

  /**
   * @param {import("./home/OnlineCard.js").OnlineView} view
   * @param {boolean} primary
   */
  #onlineTile(view, primary) {
    const locked = view.kind === "locked";
    const note = view.kind === "locked" ? view.reason : (view.rankedLock ?? view.note);
    const play = (/** @type {"casual" | "ranked"} */ mode) => this.services.navigate(SceneId.ONLINE, { mode });
    return {
      picture: { icon: Icon.PLAY, faction: "ember" },
      kicker: "Online · real players",
      title: "Online",
      text: "Casual to practise, free. Ranked to climb the season and share its jackpot.",
      status: note === null ? null : { text: note },
      primary,
      actions: [
        { id: "play.online.casual", text: "Casual", locked, variant: variantOf(primary), onActivate: () => play("casual") },
        { id: "play.online.ranked", text: "Ranked", locked: locked || view.rankedLock !== null, onActivate: () => play("ranked") },
      ],
    };
  }

  /** @param {boolean} primary */
  #practiceTile(primary) {
    const there = this.services.hasScene(SceneId.DECK_SELECTION);
    return {
      picture: { icon: Icon.TARGET, faction: "shadow" },
      kicker: "Solo · no limits",
      kickerKey: "accentLight",
      title: "Practice vs AI",
      text: "Try a deck against the computer. Works offline, no rewards.",
      status: this.#views.signedIn ? { text: "Your practice games count towards opening ranked play." } : null,
      primary,
      actions: [{ id: "play.practice.play", text: "Practice", enabled: there, variant: variantOf(primary), onActivate: () => this.services.navigate(SceneId.DECK_SELECTION) }],
    };
  }

  #tutorialTile() {
    const tutorial = this.#app.tutorial;
    const done = this.#views.tutorialDone;
    return {
      picture: { icon: Icon.BOOK, faction: "verdant" },
      kicker: "Learn",
      kickerKey: "success",
      title: "Tutorial",
      text: "A guided game against a trainer: the rules, one at a time, in a few minutes.",
      status: done ? { text: "Completed", colorKey: "success" } : null,
      actions: [{ id: "play.tutorial.play", text: done ? "Play again" : "Start the tutorial", enabled: tutorial !== undefined, onActivate: () => tutorial !== undefined && startTutorial(this.services, tutorial) }],
    };
  }

  /**
   * The games being played now, and the player's own: both need an account.
   * @param {readonly Rect[]} frames
   * @param {boolean} compact
   */
  #buildLinks(frames, compact) {
    const signedIn = this.#views.signedIn;
    const links = [
      { id: "play.watch", icon: Icon.EYE, caption: "Watch live games", scene: SceneId.LIVE_GAMES },
      { id: "play.history", icon: Icon.HISTORY, caption: "My games and replays", scene: SceneId.GAME_HISTORY },
    ];
    links.forEach((link, index) => {
      const frame = frames[index];
      this.root.add(new IconButton({ id: link.id, ...frame, icon: link.icon, caption: compact ? "" : link.caption, enabled: signedIn && this.services.hasScene(link.scene), onActivate: () => this.services.navigate(link.scene, { back: SceneId.PLAY }) }));
    });
  }
}

/**
 * The tile with the screen's gold button: today's challenge while there is one to fight, else online play, else practice.
 * @param {import("./home/ChallengeCard.js").ChallengeView} challenge
 * @param {import("./home/OnlineCard.js").OnlineView} online
 * @returns {"daily" | "online" | "practice"}
 */
function goldTile(challenge, online) {
  if (challenge.kind === "next") {
    return "daily";
  }
  return online.kind === "open" ? "online" : "practice";
}

/**
 * The gold of the screen's one main button, or the plain look.
 * @param {boolean} primary
 * @returns {import("../ui/Button.js").ButtonVariant}
 */
function variantOf(primary) {
  return primary ? "primary" : "secondary";
}

/**
 * Where the player stands with today's challenges, in a line.
 * @param {import("./home/ChallengeCard.js").ChallengeView} view
 * @returns {import("./play/PlayTile.js").TileStatus}
 */
function dailyStatus(view) {
  switch (view.kind) {
    case "locked":
      return { text: view.reason };
    case "waiting":
      return { text: view.text };
    case "done":
      return { text: `All three beaten today · new opponents in ${view.renewsIn}`, colorKey: "success" };
    default:
      return { text: `Today: ${view.stage} of 3 beaten · next, ${view.opponent.name}` };
  }
}

/**
 * The deck's bar across the top, the four tiles two by two, the links at the foot (on a phone, beside the bar).
 * @param {{ compact?: boolean, logicalWidth: number, logicalHeight: number }} viewport the content area
 * @returns {PlayLayout}
 */
export function playLayout(viewport) {
  const compact = viewport.compact === true;
  const f = compact ? FRAME.compact : FRAME.wide;
  const width = viewport.logicalWidth - 2 * f.margin;
  const linkGap = compact ? f.gap : 16;
  const barWidth = compact ? width - 2 * (f.link + linkGap) : width;
  const bar = Object.freeze({ x: f.margin, y: f.margin, width: barWidth, height: f.bar });
  const tilesTop = f.margin + f.bar + f.gap;
  const linksY = compact ? f.margin : viewport.logicalHeight - f.margin - f.links;
  const tilesBottom = compact ? viewport.logicalHeight - f.margin : linksY - f.gap;
  const tileWidth = Math.floor((width - f.gap) / 2);
  const tileHeight = Math.floor((tilesBottom - tilesTop - f.gap) / 2);
  const tiles = [0, 1, 2, 3].map((index) => Object.freeze({ x: f.margin + (index % 2) * (tileWidth + f.gap), y: tilesTop + Math.floor(index / 2) * (tileHeight + f.gap), width: tileWidth, height: tileHeight }));
  const links = compact
    ? [0, 1].map((index) => Object.freeze({ x: f.margin + barWidth + linkGap + index * (f.link + linkGap), y: linksY, width: f.link, height: f.bar }))
    : [0, 1].map((index) => Object.freeze({ x: f.margin + index * (f.link + linkGap), y: linksY, width: f.link, height: f.links }));
  return Object.freeze({ bar, tiles: Object.freeze(tiles), links: Object.freeze(links) });
}
