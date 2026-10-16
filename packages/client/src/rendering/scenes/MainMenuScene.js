/**
 * Entry screen (the Home section, until a home of its own replaces it): a
 * fan of cards under the game's name in living gold, the navigation
 * buttons and a content summary. The player's account, the notifications,
 * the sound and Info are the shell's (its top bar). Buttons whose
 * destination scene is not registered are disabled rather than pretending
 * to work.
 *
 * On a compact screen (a phone in landscape) the fan, the title and the
 * summary take the left half and the buttons the right one.
 *
 * When the ranked season has a jackpot, it is shown beside the buttons (as a
 * banner under the title on a compact screen), its countdown ticking; signed
 * in, a click on it opens the leaderboard.
 *
 * Signed in, the day's challenges sit under online play: a gold button
 * while today's are still to win, a plain one once they are won. The tutorial (a guided first match) is offered under the play buttons.
 * The Deck Builder has a button of its own only while there is no
 * collection to open (signed out, or offline); signed in, it is opened from
 * the collection, beside the cards it builds with.
 */
import { AccountStatus } from "../../application/account/AccountService.js";
import { SoundCue } from "../../application/audio/SoundCue.js";
import { IdentityStatus } from "../../application/identity/IdentityService.js";
import { contentLine, storageLine, versionLine } from "../shell/aboutLines.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Ornament } from "../ui/Ornament.js";
import { JACKPOT_HEIGHT, JackpotPanel } from "./jackpot/JackpotPanel.js";
import { HeroNode } from "./mainMenu/HeroNode.js";
import { TitleLogo } from "./mainMenu/TitleLogo.js";
import { UiPiece } from "../images/UiArt.js";
import { SceneId } from "./sceneIds.js";
import { SectionScene } from "./SectionScene.js";
import { startTutorial } from "./startTutorial.js";

const BUTTON_WIDTH = 360;
const BUTTON_HEIGHT = 48;
const BUTTON_GAP = 10;
/** The wide layout, in the content area the shell leaves (1488 × 824): the fan and the name, the buttons, the summary under them. */
const WIDE = Object.freeze({
  hero: Object.freeze({ y: 0, width: 800, height: 280 }),
  title: Object.freeze({ y: 94, height: 110 }),
  subtitle: Object.freeze({ y: 212, height: 36 }),
  ornament: Object.freeze({ y: 258, width: 440, height: 16 }),
  buttonsY: 304,
  summary: Object.freeze({ y: 662, lineHeight: 28, width: 900 }),
  /** The jackpot card, right of the button column: its gap from the column, its widest and what it keeps from the edge. */
  jackpot: Object.freeze({ gap: 60, maxWidth: 500, margin: 28 }),
});
/** What the painted logo keeps clear above a phone's jackpot banner. */
const LOGO_GAP = 4;
/**
 * The compact layout, in the content area the shell leaves (about 680–1020 × 348): the left half (fan, title,
 * subtitle, summary lines from the bottom) and the button column centred in the right half.
 */
const COMPACT = Object.freeze({
  margin: 14,
  hero: Object.freeze({ y: 0, width: 380, height: 200 }),
  title: Object.freeze({ y: 80, height: 84 }),
  subtitle: Object.freeze({ y: 162, height: 26 }),
  ornament: Object.freeze({ y: 192, width: 300, height: 14 }),
  summary: Object.freeze({ bottom: 344, lineHeight: 21 }),
  button: Object.freeze({ maxWidth: 340, height: 46, gap: 8, top: 6, bottom: 342 }),
  /** The jackpot banner, in place of the subtitle and the ornament. */
  jackpot: Object.freeze({ y: 166 }),
});

export class MainMenuScene extends SectionScene {
  #app;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** @type {(() => void) | null} */
  #unsubscribeDaily = null;
  /** @type {Array<() => void>} */
  #jackpotWatch = [];
  /** @type {JackpotPanel | null} */
  #jackpotPanel = null;
  /** The game's name; kept across rebuilds, so its light keeps its pace. */
  #title = new TitleLogo({ text: "KIJAM" });
  /** Whether the heading was last laid out for the painted logo. */
  #paintedTitle = false;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services, app, { scene: SceneId.MAIN_MENU, title: "Home" });
    this.#app = app;
  }

  /** @param {Readonly<Record<string, unknown>>} [params] */
  enter(params = {}) {
    this.routeBack(params);
    // The account loads after sign-in; redraw when it does (and when it fails).
    this.#unsubscribe = this.#app.account?.subscribe(() => this.#rebuild()) ?? null;
    this.#unsubscribeDaily = this.#app.daily?.subscribe(() => this.#rebuild()) ?? null;
    const jackpot = this.#app.jackpot;
    if (jackpot !== undefined) {
      this.#jackpotWatch = [jackpot.subscribe(() => this.#rebuild()), jackpot.watch()];
    }
    this.#rebuild();
    this.services.logger.info("main menu ready", { theme: this.services.theme.layout });
  }

  exit() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#unsubscribeDaily?.();
    this.#unsubscribeDaily = null;
    this.#jackpotWatch.forEach((stop) => stop());
    this.#jackpotWatch = [];
    this.#jackpotPanel = null;
    super.exit();
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.root.clear();
    const { viewport, hasScene, navigate } = this.services;
    const width = viewport.logicalWidth;
    const layout = viewport.compact ? compactLayout(width) : wideLayout(width);
    this.#buildHeading(layout);

    const collection = this.#collectionEntries();
    const entries = [
      ...this.#onlineEntries(),
      ...this.#dailyEntries(),
      { id: "play", text: this.#onlineEntries().length > 0 ? "Practice vs AI" : "Play", scene: SceneId.DECK_SELECTION, variant: this.#onlineEntries().length > 0 ? "secondary" : "primary" },
      ...this.#tutorialEntries(),
      ...(collection.length === 0 ? [{ id: "deckBuilder", text: "My decks", scene: SceneId.DECKS, variant: "secondary" }] : collection),
      ...(this.#app.shop === undefined ? [] : [{ id: "shop", text: "Shop", scene: SceneId.SHOP, variant: "secondary" }]),
    ];
    /** @type {Button | null} */
    let first = null;
    const { buttons } = layout;
    // A phone's column pairs its last secondary entries side by side rather than overflow the screen when there are many.
    const rows = rowsFor(entries, buttons);
    const buttonsTop = buttons.top + Math.max(0, (buttons.room - (rows.length * (buttons.height + buttons.gap) - buttons.gap)) / 2);
    rows.forEach((row, index) => {
      const buttonWidth = (buttons.width - (row.length - 1) * buttons.gap) / row.length;
      row.forEach((entry, place) => {
        const button = this.root.add(
          new Button({
            id: entry.id,
            x: buttons.centerX - buttons.width / 2 + place * (buttonWidth + buttons.gap),
            y: buttonsTop + index * (buttons.height + buttons.gap),
            width: buttonWidth,
            height: buttons.height,
            text: entry.text,
            textSize: row.length > 1 ? "small" : "body",
            variant: /** @type {import("../ui/Button.js").ButtonVariant} */ (entry.variant),
            cue: entry.cue,
            onActivate: entry.onActivate ?? (() => navigate(/** @type {string} entries without onActivate have a scene */ (entry.scene))),
          }),
        );
        button.enabled = entry.scene === null || hasScene(entry.scene);
        first ??= button;
      });
    });

    const lines = this.#summaryLines();
    const { summary } = layout;
    const summaryTop = summary.bottom === null ? summary.y : summary.bottom - lines.length * summary.lineHeight;
    lines.forEach((line, index) => {
      this.root.add(new Label({ x: summary.centerX - summary.width / 2, y: summaryTop + index * summary.lineHeight, width: summary.width, height: summary.lineHeight, text: line.text, size: index === 0 ? "small" : summary.size, colorKey: line.colorKey, fit: true }));
    });
    this.focus(this.findNode(focusedId) ?? first);
    this.services.requestRender();
  }

  /**
   * The fan, the game's name, and under it the subtitle and the ornament, or on a phone the jackpot banner in their place.
   * The painted logo (once ready) carries its own tagline and scrolls: it takes their place too, from the fan's top down.
   * @param {MenuLayout} layout
   */
  #buildHeading(layout) {
    const { hero } = layout;
    this.root.add(new HeroNode({ x: hero.centerX - hero.width / 2, y: hero.y, width: hero.width, height: hero.height }));
    const jackpot = this.#app.jackpot?.state.jackpot ?? null;
    const banner = jackpot !== null && layout.jackpot.layout === "banner";
    this.#paintedTitle = this.#paintedLogoReady();
    const bottom = banner ? layout.jackpot.y - LOGO_GAP : layout.ornament.y + layout.ornament.height;
    const area = this.#paintedTitle ? { y: hero.y, height: bottom - hero.y } : layout.title;
    Object.assign(this.#title, { x: hero.centerX - hero.textWidth / 2, y: area.y, width: hero.textWidth, height: area.height });
    this.root.add(this.#title);
    if (!banner && !this.#paintedTitle) {
      this.root.add(new Label({ x: hero.centerX - hero.textWidth / 2, y: layout.subtitle.y, width: hero.textWidth, height: layout.subtitle.height, text: "A collectible card game on STEEM", size: layout.subtitle.size, colorKey: "textMuted" }));
      this.root.add(new Ornament({ x: hero.centerX - layout.ornament.width / 2, y: layout.ornament.y, width: layout.ornament.width, height: layout.ornament.height }));
    }
    this.#jackpotPanel = jackpot === null ? null : this.#buildJackpot(jackpot, layout);
  }

  /** Whether the painted logo is ready to stand for the name (Theme.uiArt). */
  #paintedLogoReady() {
    const art = this.services.theme.uiArt;
    return art?.layout.title !== undefined && art.imageFor(UiPiece.TITLE) !== null;
  }

  /** The summary under the buttons; the jackpot banner leaves a phone's one line less. */
  #summaryLines() {
    const draft = this.#draftSummary();
    const banner = this.#jackpotPanel !== null && this.services.viewport.compact;
    return [
      { text: this.#accountSummary(), colorKey: "accentLight" },
      ...(banner ? [] : [{ text: contentLine(this.#app), colorKey: "textMuted" }]),
      { text: storageLine(this.#app), colorKey: "textMuted" },
      ...(draft === null ? [] : [{ text: draft, colorKey: "accent" }]),
      { text: versionLine(this.#app), colorKey: "disabledText" },
    ];
  }

  /** @param {number} dtMs */
  update(dtMs) {
    if (this.#paintedLogoReady() !== this.#paintedTitle) {
      // The painted logo arrived (or went) since the heading was laid out: lay it out again for it.
      this.#rebuild();
    }
    const base = super.update(dtMs);
    const ticked = this.#jackpotPanel?.tick() ?? false;
    return this.#title.update(dtMs) || ticked || base;
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    const { theme, viewport } = this.services;
    drawSceneBackdrop(context, theme, viewport.bounds, { seed: "menu" });
    super.render(context);
  }

  relayout() {
    this.#rebuild();
  }

  /**
   * The season's jackpot; signed in, it opens the leaderboard.
   * @param {import("../../application/ports/JackpotApi.contract.js").Jackpot} jackpot
   * @param {MenuLayout} layout
   */
  #buildJackpot(jackpot, { jackpot: frame }) {
    const service = /** @type {import("../../application/jackpot/JackpotService.js").JackpotService} */ (this.#app.jackpot);
    const signedIn = this.#app.account?.state.status === AccountStatus.READY && this.services.hasScene(SceneId.SEASON);
    const onActivate = signedIn ? () => this.services.navigate(SceneId.SEASON) : null;
    return this.root.add(new JackpotPanel({ ...frame, height: JACKPOT_HEIGHT[frame.layout], jackpot, now: () => service.now(), onActivate }));
  }

  /** The tutorial, when the game has one. */
  #tutorialEntries() {
    const tutorial = this.#app.tutorial;
    return tutorial === undefined ? [] : [{ id: "tutorial", text: "Tutorial", scene: null, variant: "secondary", onActivate: () => startTutorial(this.services, tutorial) }];
  }

  /** Online play, once signed in and the account is loaded. */
  #onlineEntries() {
    const ready = this.#app.online !== undefined && this.#app.account?.state.status === AccountStatus.READY;
    return ready ? [{ id: "online", text: "Play online", scene: SceneId.ONLINE, variant: "primary" }] : [];
  }

  /** The daily challenges, once signed in and the account is loaded: gold while today's are to win, plain once won; always the plain click. */
  #dailyEntries() {
    const daily = this.#app.daily;
    const ready = daily !== undefined && this.#app.online !== undefined && this.#app.account?.state.status === AccountStatus.READY;
    if (!ready) {
      return [];
    }
    const done = daily.state.day?.run?.rewarded === true;
    return [{ id: "daily", text: "Challenges", scene: SceneId.DAILY, variant: done ? "secondary" : "primary", cue: SoundCue.UI_CLICK }];
  }

  /** The free starter deck until it is taken, the collection afterwards. */
  #collectionEntries() {
    const account = this.#app.account;
    if (account === undefined || account.state.status === AccountStatus.SIGNED_OUT) {
      return [];
    }
    if (account.needsStarter) {
      return [{ id: "starter", text: "Free starter deck", scene: SceneId.STARTER, variant: "primary" }];
    }
    return [{ id: "collection", text: "Collection", scene: SceneId.COLLECTION, variant: "secondary" }];
  }

  #accountSummary() {
    const state = this.#app.identity?.state;
    if (state === undefined || state.status === IdentityStatus.OFFLINE) {
      return "Offline: practice against the AI (no game server)";
    }
    if (state.status === IdentityStatus.SIGNED_IN && state.user !== null) {
      return `Signed in as @${state.user.account} (${state.user.network})${this.#collectionSummary()}`;
    }
    return state.status === IdentityStatus.UNKNOWN ? "Connecting to the game server…" : "Not signed in";
  }

  #collectionSummary() {
    const account = this.#app.account;
    if (account === undefined) {
      return "";
    }
    const { status, error } = account.state;
    if (status === AccountStatus.LOADING) {
      return " · loading your collection…";
    }
    if (status === AccountStatus.FAILED) {
      return ` · collection unavailable: ${error?.message ?? "unknown error"}`;
    }
    const owned = account.collection.state.cards.reduce((total, entry) => total + entry.copies.length, 0);
    return ` · ${owned} card${owned === 1 ? "" : "s"} owned`;
  }

  /** A deck left open in the builder survives navigation; say so. */
  #draftSummary() {
    const draft = this.#app.deckBuilding.draft;
    if (draft === null || draft === undefined) {
      return null;
    }
    const state = this.#app.deckBuilding.hasUnsavedChanges ? "unsaved changes" : "saved";
    return `Deck builder: editing "${draft.name}" (${state})`;
  }
}

/**
 * The menu's buttons in rows: one a row, unless the column (a phone's, `room` > 0) would overflow; then its last
 * entries other than the primary ones go two a row, from the bottom up, until it fits.
 * @template {{ variant: string }} T
 * @param {readonly T[]} entries in order
 * @param {{ height: number, gap: number, room: number }} column
 * @returns {T[][]}
 */
function rowsFor(entries, { height, gap, room }) {
  const rows = entries.map((entry) => [entry]);
  const fits = () => room === 0 || rows.length * (height + gap) - gap <= room;
  for (let index = rows.length - 1; index > 0 && !fits(); index -= 1) {
    const [above, below] = [rows[index - 1], rows[index]];
    if (above.length === 1 && below.length === 1 && above[0].variant !== "primary" && below[0].variant !== "primary") {
      rows.splice(index - 1, 2, [above[0], below[0]]);
      index -= 1;
    }
  }
  return rows;
}

/**
 * @typedef {Readonly<{
 *   hero: { centerX: number, y: number, width: number, height: number, textWidth: number },
 *   title: { y: number, height: number },
 *   subtitle: { y: number, height: number, size: import("../theme/Theme.js").FontSize },
 *   ornament: { y: number, width: number, height: number },
 *   buttons: { centerX: number, width: number, height: number, gap: number, top: number, room: number },
 *   summary: { centerX: number, width: number, y: number, bottom: number | null, lineHeight: number, size: import("../theme/Theme.js").FontSize },
 *   jackpot: { x: number, y: number, width: number, layout: import("./jackpot/JackpotPanel.js").JackpotLayout },
 * }>} MenuLayout `buttons.room`: the height the column is centred in (0 starts it at `top`); `summary.bottom`: where its last line ends, when it is laid out from the bottom
 */

/**
 * Everything centred on one column.
 * @param {number} width the content area's
 * @returns {MenuLayout}
 */
function wideLayout(width) {
  const centerX = width / 2;
  const jackpotX = centerX + BUTTON_WIDTH / 2 + WIDE.jackpot.gap;
  return Object.freeze({
    hero: { centerX, y: WIDE.hero.y, width: WIDE.hero.width, height: WIDE.hero.height, textWidth: width },
    title: WIDE.title,
    subtitle: { ...WIDE.subtitle, size: "body" },
    ornament: WIDE.ornament,
    buttons: { centerX, width: BUTTON_WIDTH, height: BUTTON_HEIGHT, gap: BUTTON_GAP, top: WIDE.buttonsY, room: 0 },
    summary: { centerX, width: WIDE.summary.width, y: WIDE.summary.y, bottom: null, lineHeight: WIDE.summary.lineHeight, size: "small" },
    jackpot: { x: jackpotX, y: WIDE.buttonsY, width: Math.min(WIDE.jackpot.maxWidth, width - jackpotX - WIDE.jackpot.margin), layout: "card" },
  });
}

/**
 * Two halves for a phone in landscape: the fan, title and summary on the left, the buttons on the right.
 * @param {number} width the content area's
 * @returns {MenuLayout}
 */
function compactLayout(width) {
  const half = width / 2;
  const left = half / 2;
  const { margin, button } = COMPACT;
  const buttonWidth = Math.min(button.maxWidth, half - 2 * margin);
  return Object.freeze({
    hero: { centerX: left, y: COMPACT.hero.y, width: Math.min(COMPACT.hero.width, half), height: COMPACT.hero.height, textWidth: half - 2 * margin },
    title: COMPACT.title,
    subtitle: { ...COMPACT.subtitle, size: "small" },
    ornament: COMPACT.ornament,
    buttons: { centerX: half + half / 2, width: buttonWidth, height: button.height, gap: button.gap, top: button.top, room: button.bottom - button.top },
    summary: { centerX: left, width: half - 2 * margin, y: 0, bottom: COMPACT.summary.bottom, lineHeight: COMPACT.summary.lineHeight, size: "tiny" },
    jackpot: { x: margin, y: COMPACT.jackpot.y, width: half - 2 * margin, layout: "banner" },
  });
}
