/**
 * Entry screen: a fan of cards under the game's name in living gold, the navigation
 * buttons and a content summary. The account lives in the top-left corner:
 * signed out, Sign in; signed in, the player's portrait and name, which open
 * their account (and Sign out). Buttons whose destination scene is not
 * registered are disabled rather than pretending to work. Signed in, the
 * top-right button opens the notifications and counts the unread ones;
 * beside it, Sound opens the sound settings (music, effects, mute), and Info
 * the screen that explains the game (rules, purchases, sign-in, ranked, shop).
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
import { IdentityStatus, SignInMethod } from "../../application/identity/IdentityService.js";
import { AvatarNode } from "../ui/AvatarNode.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Hotspot } from "../ui/Hotspot.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { Ornament } from "../ui/Ornament.js";
import { buildAudioSettingsModal } from "./audioSettings.js";
import { deckStorageText } from "./deckStorage.js";
import { JACKPOT_HEIGHT, JackpotPanel } from "./jackpot/JackpotPanel.js";
import { HeroNode } from "./mainMenu/HeroNode.js";
import { TitleLogo } from "./mainMenu/TitleLogo.js";
import { UiPiece } from "../images/UiArt.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";
import { startTutorial } from "./startTutorial.js";

const BUTTON_WIDTH = 360;
const BUTTON_HEIGHT = 48;
const BUTTON_GAP = 10;
const HERO = Object.freeze({ y: 20, height: 280 });
/** What the painted logo keeps clear above a phone's jackpot banner. */
const LOGO_GAP = 4;
const TITLE = Object.freeze({ y: 150, height: 110 });
const SUBTITLE_Y = 268;
const ORNAMENT_Y = 314;
const BUTTONS_Y = 360;
const SUMMARY = Object.freeze({ y: 718, lineHeight: 28, width: 900 });
const BELL = Object.freeze({ width: 260, height: 48, margin: 40 });
/** The sound settings button, left of the bell (in its place when there is none). */
const SOUND = Object.freeze({ width: 160, gap: 12, compactWidth: 130 });
/** The Info button, left of the sound settings button. */
const INFO = Object.freeze({ width: 120, compactWidth: 96 });
/** The jackpot card, right of the button column: its gap from the column and its widest. */
const JACKPOT = Object.freeze({ gap: 60, maxWidth: 500 });
/** The signed-in player's portrait and name, in the top-left corner (the bell's mirror); Sign in in their place when signed out. */
const PROFILE = Object.freeze({ size: 56, nameWidth: 320, signInWidth: 200 });
/** The account dialog the profile opens. */
const ACCOUNT = Object.freeze({ width: 460, height: 250, compactHeight: 210, avatar: 64, button: 52, inset: 24 });
/**
 * The compact layout: the header row (portrait, bell), the left half (fan,
 * title, subtitle, summary lines from the bottom) and the button column
 * centred in the right half below the header.
 */
const COMPACT = Object.freeze({
  margin: 14,
  header: Object.freeze({ y: 8, height: 48 }),
  bell: Object.freeze({ width: 200 }),
  profile: Object.freeze({ size: 46, nameWidth: 260, signInWidth: 150 }),
  hero: Object.freeze({ y: 40, width: 380, height: 210 }),
  title: Object.freeze({ y: 124, height: 84 }),
  subtitle: Object.freeze({ y: 206, height: 26 }),
  ornament: Object.freeze({ y: 236, width: 300, height: 14 }),
  summary: Object.freeze({ bottom: 392, lineHeight: 21 }),
  button: Object.freeze({ maxWidth: 340, height: 46, gap: 8, top: 64, bottom: 394 }),
  /** The jackpot banner, in place of the subtitle and the ornament. */
  jackpot: Object.freeze({ y: 210 }),
});

export class MainMenuScene extends Scene {
  #app;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** @type {(() => void) | null} */
  #unsubscribeNotifications = null;
  /** @type {(() => void) | null} */
  #unsubscribeAudio = null;
  /** @type {(() => void) | null} */
  #unsubscribeDaily = null;
  /** The sound settings button, relabelled when the game is muted from anywhere (M). @type {Button | null} */
  #soundButton = null;
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
    super(services);
    this.#app = app;
  }

  enter() {
    // The account loads after sign-in; redraw when it does (and when it fails).
    this.#unsubscribe = this.#app.account?.subscribe(() => this.#rebuild()) ?? null;
    this.#unsubscribeNotifications = this.#app.notifications?.subscribe(() => this.#rebuild()) ?? null;
    this.#unsubscribeDaily = this.#app.daily?.subscribe(() => this.#rebuild()) ?? null;
    this.#unsubscribeAudio = this.#app.audio?.subscribe((settings) => {
      if (this.#soundButton !== null) {
        this.#soundButton.text = soundLabel(settings);
        this.services.requestRender();
      }
    }) ?? null;
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
    this.#unsubscribeNotifications?.();
    this.#unsubscribeNotifications = null;
    this.#unsubscribeAudio?.();
    this.#unsubscribeAudio = null;
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
    this.#soundButton = null;
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
      ...(collection.length === 0 ? [{ id: "deckBuilder", text: "Deck Builder", scene: SceneId.DECK_BUILDER, variant: "secondary" }] : collection),
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

    this.#buildBell(layout);
    const soundX = this.#buildSound(layout);
    const infoX = this.#buildInfo(layout, soundX);
    this.#buildProfile(layout, infoX);
    const lines = this.#summaryLines();
    const { summary } = layout;
    const summaryTop = summary.bottom === null ? summary.y : summary.bottom - lines.length * summary.lineHeight;
    lines.forEach((line, index) => {
      this.root.add(new Label({ x: summary.centerX - summary.width / 2, y: summaryTop + index * summary.lineHeight, width: summary.width, height: summary.lineHeight, text: line.text, size: index === 0 ? "small" : summary.size, colorKey: line.colorKey, fit: true }));
    });
    this.focus(this.root.findById(focusedId) ?? first);
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
      ...(banner ? [] : [{ text: this.#contentSummary(), colorKey: "textMuted" }]),
      { text: this.#storageSummary(), colorKey: "textMuted" },
      ...(draft === null ? [] : [{ text: draft, colorKey: "accent" }]),
      { text: this.#versionSummary(), colorKey: "disabledText" },
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
    const signedIn = this.#app.account?.state.status === AccountStatus.READY && this.services.hasScene(SceneId.LEADERBOARD);
    const onActivate = signedIn ? () => this.services.navigate(SceneId.LEADERBOARD, { back: SceneId.MAIN_MENU }) : null;
    return this.root.add(new JackpotPanel({ ...frame, height: JACKPOT_HEIGHT[frame.layout], jackpot, now: () => service.now(), onActivate }));
  }

  /**
   * The notifications button, once signed in and the account is loaded.
   * @param {MenuLayout} layout
   */
  #buildBell({ bell }) {
    const notifications = this.#app.notifications;
    if (notifications === undefined || !this.#bellShown()) {
      return;
    }
    const { unread } = notifications.state;
    const count = unread > 99 ? "99+" : String(unread);
    this.root.add(
      new Button({
        id: "notifications",
        ...bell,
        text: unread === 0 ? "Notifications" : `Notifications (${count})`,
        variant: unread === 0 ? "secondary" : "primary",
        enabled: this.services.hasScene(SceneId.NOTIFICATIONS),
        onActivate: () => this.services.navigate(SceneId.NOTIFICATIONS),
      }),
    );
  }

  /** Whether the notifications button is shown. */
  #bellShown() {
    return this.#app.notifications !== undefined && this.#app.account?.state.status === AccountStatus.READY;
  }

  /**
   * The sound settings button, when the game has sound.
   * @param {MenuLayout} layout
   * @returns {number} where the header's buttons start so far: the next one goes left of it
   */
  #buildSound({ bell }) {
    const { compact } = this.services.viewport;
    const audio = this.#app.audio;
    // With no bell, the row ends where the bell would.
    const edge = this.#bellShown() ? bell.x : bell.x + bell.width + SOUND.gap;
    if (audio === undefined) {
      return edge;
    }
    const width = compact ? SOUND.compactWidth : SOUND.width;
    const x = edge - SOUND.gap - width;
    this.#soundButton = this.root.add(new Button({ id: "sound", x, y: bell.y, width, height: bell.height, text: soundLabel(audio.settings), textSize: compact ? "small" : "body", keepPlate: true, onActivate: () => this.#showAudioSettings() }));
    return x;
  }

  /**
   * The Info button, left of the header's other buttons.
   * @param {MenuLayout} layout
   * @param {number} edge where the header's buttons start so far
   * @returns {number} where it starts
   */
  #buildInfo({ bell }, edge) {
    const { compact } = this.services.viewport;
    const width = compact ? INFO.compactWidth : INFO.width;
    const x = edge - SOUND.gap - width;
    this.root.add(new Button({ id: "info", x, y: bell.y, width, height: bell.height, text: "Info", textSize: compact ? "small" : "body", keepPlate: true, enabled: this.services.hasScene(SceneId.INFO), onActivate: () => this.services.navigate(SceneId.INFO) }));
    return x;
  }

  #showAudioSettings() {
    const audio = this.#app.audio;
    if (audio === undefined) {
      return;
    }
    const close = () => this.closeModal();
    this.openModal(buildAudioSettingsModal({ viewport: this.services.viewport, audio, onClose: close, requestRender: this.services.requestRender }));
  }

  /**
   * The account corner: signed out, Sign in; signed in, the player's STEEM profile picture and name (stopping short of
   * the header's buttons), which open their account. Nothing offline: there is no account to have.
   * @param {MenuLayout} layout
   * @param {number} edge where the header's buttons start
   */
  #buildProfile({ profile, bell }, edge) {
    const state = this.#app.identity?.state;
    if (state?.status === IdentityStatus.SIGNED_OUT) {
      const width = Math.min(profile.signInWidth, edge - SOUND.gap - profile.x);
      this.root.add(new Button({ id: "signIn", x: profile.x, y: bell.y, width, height: bell.height, text: "Sign in", variant: "primary", keepPlate: true, textSize: this.services.viewport.compact ? "small" : "body", enabled: this.services.hasScene(SceneId.LOGIN), onActivate: () => this.services.navigate(SceneId.LOGIN) }));
      return;
    }
    const user = state?.status === IdentityStatus.SIGNED_IN ? state.user : null;
    if (user === null || user === undefined) {
      return;
    }
    this.root.add(new AvatarNode({ id: "profile.avatar", x: profile.x, y: profile.y, size: profile.size, account: user.account }));
    const nameX = profile.x + profile.size + 12;
    const nameWidth = Math.min(profile.nameWidth, edge - SOUND.gap - nameX);
    const nameHeight = Math.round(profile.size * 0.6);
    this.root.add(new Label({ id: "profile.name", x: nameX, y: profile.y, width: nameWidth, height: nameHeight, text: `@${user.account}`, size: "body", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    this.root.add(new Label({ id: "profile.hint", x: nameX, y: profile.y + nameHeight, width: nameWidth, height: profile.size - nameHeight, text: "Account · Sign out", size: "tiny", colorKey: "textMuted", align: "left", fit: true }));
    this.root.add(new Hotspot({ id: "profile", x: profile.x - 4, y: profile.y - 2, width: nameX + nameWidth - profile.x + 8, height: profile.size + 4, onActivate: () => this.#showAccount(user) }));
  }

  /**
   * The signed-in account: who, how they signed in, and Sign out.
   * @param {import("../../application/ports/AuthApi.contract.js").SessionUser} user
   */
  #showAccount(user) {
    const identity = this.#app.identity;
    if (identity === undefined) {
      return;
    }
    const { viewport } = this.services;
    const width = Math.min(ACCOUNT.width, viewport.logicalWidth - 20);
    const height = viewport.compact ? ACCOUNT.compactHeight : ACCOUNT.height;
    const close = () => this.closeModal();
    const modal = new Modal({ id: "account", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: close });
    const { panel } = modal;
    const { inset, avatar } = ACCOUNT;
    panel.add(new AvatarNode({ x: inset, y: inset, size: avatar, account: user.account }));
    const textX = inset + avatar + 16;
    panel.add(new Label({ x: textX, y: inset, width: width - textX - inset, height: avatar / 2, text: `@${user.account}`, size: "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    panel.add(new Label({ x: textX, y: inset + avatar / 2, width: width - textX - inset, height: avatar / 2, text: signedInWith(identity.state.method, user.network), size: "small", colorKey: "textMuted", align: "left", fit: true }));
    const half = (width - 2 * inset - 12) / 2;
    const buttonY = height - inset - ACCOUNT.button;
    const signOut = () => {
      close();
      void identity.signOut().then(() => this.services.navigate(SceneId.MAIN_MENU));
    };
    panel.add(new Button({ id: "signOut", x: inset, y: buttonY, width: half, height: ACCOUNT.button, text: "Sign out", variant: "danger", onActivate: signOut }));
    const closeButton = panel.add(new Button({ id: "account.close", x: inset + half + 12, y: buttonY, width: half, height: ACCOUNT.button, text: "Close", onActivate: close }));
    this.openModal(modal);
    this.focus(closeButton);
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

  #contentSummary() {
    const { content } = this.#app;
    const factions = content.deckRules.factions.join(" · ");
    return `${content.catalog.size} cards · ${content.preconDecks.length} preconstructed decks · factions: ${factions}`;
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

  #storageSummary() {
    const saved = this.#app.deckSelection.listDecks().filter((option) => option.source === "custom").length;
    return `${saved} custom deck${saved === 1 ? "" : "s"} ${deckStorageText(this.#app)}`;
  }

  /** The game's release (so a player can tell which one they run), then the engine's. */
  #versionSummary() {
    const { release, version } = this.#app.environment;
    return release === undefined ? `engine ${version}` : `KIJAM ${release} · engine ${version}`;
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
 * How the player signed in, as their account dialog says it.
 * @param {string | null} method one of SignInMethod
 * @param {string} network
 */
function signedInWith(method, network) {
  const how = method === SignInMethod.KEYS ? "with your posting key" : "with Steem Keychain";
  return `Signed in on ${network} ${how}`;
}

/** @param {import("../../application/audio/AudioSettings.js").AudioSettings} settings */
function soundLabel(settings) {
  return settings.muted ? "Sound off" : "Sound";
}

/**
 * @typedef {Readonly<{
 *   hero: { centerX: number, y: number, width: number, height: number, textWidth: number },
 *   title: { y: number, height: number },
 *   subtitle: { y: number, height: number, size: import("../theme/Theme.js").FontSize },
 *   ornament: { y: number, width: number, height: number },
 *   buttons: { centerX: number, width: number, height: number, gap: number, top: number, room: number },
 *   summary: { centerX: number, width: number, y: number, bottom: number | null, lineHeight: number, size: import("../theme/Theme.js").FontSize },
 *   bell: { x: number, y: number, width: number, height: number },
 *   profile: { x: number, y: number, size: number, nameWidth: number, signInWidth: number },
 *   jackpot: { x: number, y: number, width: number, layout: import("./jackpot/JackpotPanel.js").JackpotLayout },
 * }>} MenuLayout `buttons.room`: the height the column is centred in (0 starts it at `top`); `summary.bottom`: where its last line ends, when it is laid out from the bottom
 */

/**
 * Everything centred on one column, as designed for 1600×900.
 * @param {number} width
 * @returns {MenuLayout}
 */
function wideLayout(width) {
  const centerX = width / 2;
  return Object.freeze({
    hero: { centerX, y: HERO.y, width: 800, height: HERO.height, textWidth: width },
    title: TITLE,
    subtitle: { y: SUBTITLE_Y, height: 36, size: "body" },
    ornament: { y: ORNAMENT_Y, width: 440, height: 16 },
    buttons: { centerX, width: BUTTON_WIDTH, height: BUTTON_HEIGHT, gap: BUTTON_GAP, top: BUTTONS_Y, room: 0 },
    summary: { centerX, width: SUMMARY.width, y: SUMMARY.y, bottom: null, lineHeight: SUMMARY.lineHeight, size: "small" },
    bell: { x: width - BELL.margin - BELL.width, y: BELL.margin / 2, width: BELL.width, height: BELL.height },
    profile: { x: BELL.margin, y: BELL.margin / 2 + (BELL.height - PROFILE.size) / 2, size: PROFILE.size, nameWidth: PROFILE.nameWidth, signInWidth: PROFILE.signInWidth },
    jackpot: { x: centerX + BUTTON_WIDTH / 2 + JACKPOT.gap, y: BUTTONS_Y, width: Math.min(JACKPOT.maxWidth, width - centerX - BUTTON_WIDTH / 2 - JACKPOT.gap - BELL.margin), layout: "card" },
  });
}

/**
 * Two halves for a phone in landscape: the fan, title and summary on the left, the buttons on the right.
 * @param {number} width
 * @returns {MenuLayout}
 */
function compactLayout(width) {
  const half = width / 2;
  const left = half / 2;
  const { margin, header, button } = COMPACT;
  const buttonWidth = Math.min(button.maxWidth, half - 2 * margin);
  return Object.freeze({
    hero: { centerX: left, y: COMPACT.hero.y, width: COMPACT.hero.width, height: COMPACT.hero.height, textWidth: half - 2 * margin },
    title: COMPACT.title,
    subtitle: { ...COMPACT.subtitle, size: "small" },
    ornament: COMPACT.ornament,
    buttons: { centerX: half + half / 2, width: buttonWidth, height: button.height, gap: button.gap, top: button.top, room: button.bottom - button.top },
    summary: { centerX: left, width: half - 2 * margin, y: 0, bottom: COMPACT.summary.bottom, lineHeight: COMPACT.summary.lineHeight, size: "tiny" },
    bell: { x: width - margin - COMPACT.bell.width, y: header.y, width: COMPACT.bell.width, height: header.height },
    profile: { x: margin, y: header.y, size: COMPACT.profile.size, nameWidth: COMPACT.profile.nameWidth, signInWidth: COMPACT.profile.signInWidth },
    jackpot: { x: margin, y: COMPACT.jackpot.y, width: half - 2 * margin, layout: "banner" },
  });
}
