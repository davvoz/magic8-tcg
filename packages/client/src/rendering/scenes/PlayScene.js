/**
 * Play: every way to play, in one place: four tiles, each with what it is
 * for and where the player stands with it: the daily challenges (today's
 * opponent in their portrait), online play (Casual, and Ranked
 * locked until the player may play it), practice against the AI (offline
 * too) and the tutorial. At the foot, the games being played now to watch,
 * and the player's own games and replays. What needs an account or the
 * game server stays in its place, locked, saying why. The deck is chosen
 * where each way to play starts (the challenges, the lobby, practice).
 *
 * One gold button: the challenge's while one is to fight, else Casual, else Practice.
 */
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { UiPiece } from "../images/UiArt.js";
import { Icon } from "../ui/icons.js";
import { IconButton } from "../ui/IconButton.js";
import { PlayViews } from "./home/PlayViews.js";
import { PlayTile } from "./play/PlayTile.js";
import { SceneId } from "./sceneIds.js";
import { SectionScene } from "./SectionScene.js";
import { startTutorial } from "./startTutorial.js";

/** The frame: margins, gaps, and the links at the foot (a phone's are icons only). */
const FRAME = Object.freeze({
  wide: Object.freeze({ margin: 20, gap: 20, links: 56, link: 300, linkGap: 16 }),
  compact: Object.freeze({ margin: 8, gap: 8, links: 46, link: 56, linkGap: 8 }),
});
const MINUTE = 60_000;

/**
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 * @typedef {Readonly<{ tiles: readonly Rect[], links: readonly Rect[] }>} PlayLayout
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

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   * @param {{ now?: () => number }} [clock]
   */
  constructor(services, app, { now = () => Date.now() } = {}) {
    super(services, app, { scene: SceneId.PLAY, title: "Play" });
    this.#app = app;
    this.#now = now;
    this.#views = new PlayViews({ app, hasScene: services.hasScene, now });
  }

  /** @param {Readonly<Record<string, unknown>>} [params] */
  enter(params = {}) {
    this.routeBack(params);
    const app = this.#app;
    const rebuild = () => this.#rebuild();
    for (const service of [app.daily, app.ranking, app.online, app.onboarding]) {
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
    this.root.clear();
    this.#minute = Math.floor(this.#now() / MINUTE);
    const { viewport } = this.services;
    const compact = viewport.compact === true;
    const layout = playLayout(viewport);
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
    this.services.requestRender();
  }

  /**
   * @param {import("./home/ChallengeCard.js").ChallengeView} view
   * @param {boolean} primary
   */
  #dailyTile(view, primary) {
    const picture = { portrait: this.#views.challenger(view), clock: () => this.#animationMs };
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
      picture: { piece: UiPiece.PLAY_ONLINE, icon: Icon.PLAY, faction: "ember" },
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
      picture: { piece: UiPiece.PLAY_PRACTICE, icon: Icon.TARGET, faction: "shadow" },
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
      picture: { piece: UiPiece.PLAY_TUTORIAL, icon: Icon.BOOK, faction: "verdant" },
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
      this.root.add(new IconButton({ id: link.id, ...frame, icon: link.icon, caption: compact ? "" : link.caption, enabled: signedIn && this.services.hasScene(link.scene), onActivate: () => this.services.navigate(link.scene, this.backHere()) }));
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
 * The four tiles two by two, the links at the foot.
 * @param {{ compact?: boolean, logicalWidth: number, logicalHeight: number }} viewport the content area
 * @returns {PlayLayout}
 */
export function playLayout(viewport) {
  const f = viewport.compact === true ? FRAME.compact : FRAME.wide;
  const width = viewport.logicalWidth - 2 * f.margin;
  const linksY = viewport.logicalHeight - f.margin - f.links;
  const tileWidth = Math.floor((width - f.gap) / 2);
  const tileHeight = Math.floor((linksY - f.gap - f.margin - f.gap) / 2);
  const tiles = [0, 1, 2, 3].map((index) => Object.freeze({ x: f.margin + (index % 2) * (tileWidth + f.gap), y: f.margin + Math.floor(index / 2) * (tileHeight + f.gap), width: tileWidth, height: tileHeight }));
  const links = [0, 1].map((index) => Object.freeze({ x: f.margin + index * (f.link + f.linkGap), y: linksY, width: f.link, height: f.links }));
  return Object.freeze({ tiles: Object.freeze(tiles), links: Object.freeze(links) });
}
