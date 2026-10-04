/**
 * Info: what a player needs to know, in plain words. The topics are tabs on
 * the left (how to play, purchases, account and sign in, ranked games, the
 * shop and the other ways to get cards); the chosen one reads on the right
 * as a scrolling article (wheel, drag, Page Up / Page Down, Home / End).
 * The account topic ends with a button that opens join.cur8.fun, where a
 * new player gets a Steem account (their wallet) for free. Needs no game
 * server: it is there offline too.
 */
import { InfoTopicId, infoTopics } from "../../application/info/infoTopics.js";
import { drawSceneBackdrop } from "../ui/backdrop.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Panel } from "../ui/Panel.js";
import { screenLayout } from "./deckBuilder/layout.js";
import { InfoArticle } from "./info/InfoArticle.js";
import { Scene } from "./Scene.js";
import { SceneId } from "./sceneIds.js";

/**
 * The topic tabs' column and the article's parts, wide and compact (a phone in landscape).
 * @typedef {Readonly<{ tabsWidth: number, gap: number, tab: { height: number, gap: number }, title: number, link: number }>} InfoMetrics
 *   `title`, `link`: the heights of the topic's title and of its link button
 */
/** @type {InfoMetrics} */
const WIDE = Object.freeze({ tabsWidth: 360, gap: 40, tab: Object.freeze({ height: 56, gap: 10 }), title: 48, link: 56 });
/** @type {InfoMetrics} */
const COMPACT = Object.freeze({ tabsWidth: 190, gap: 10, tab: Object.freeze({ height: 46, gap: 6 }), title: 34, link: 46 });
/** Room kept between the article and what is around it. */
const SPACING = 12;
/** How much of the article a page key scrolls: most of its height, so the reader keeps a line of context. */
const PAGE = 0.85;

export class InfoScene extends Scene {
  /** The frame for the screen in use (the compact one on a phone). */
  get #screen() {
    return screenLayout(this.services.viewport);
  }

  get #m() {
    return this.#screen.compact ? COMPACT : WIDE;
  }

  /** @type {readonly import("../../application/info/infoTopics.js").InfoTopic[]} */
  #topics;
  /** @type {string} */
  #topicId = InfoTopicId.MECHANICS;
  /** Where Back leads. @type {string} */
  #back = SceneId.MAIN_MENU;
  /** How far each topic was read, kept across rebuilds and tab switches. @type {Record<string, number>} */
  #scroll = {};
  /** @type {InfoArticle | null} */
  #article = null;

  /**
   * @param {import("./Scene.js").SceneServices} services
   * @param {import("../../application/AppContext.js").AppContext} app
   */
  constructor(services, app) {
    super(services);
    this.#topics = infoTopics(app.content);
  }

  /** @param {{ topic?: string, back?: string }} [params] `topic`: the one shown first; `back`: where Back leads */
  enter(params) {
    const asked = params?.topic;
    this.#topicId = this.#topics.some((topic) => topic.id === asked) ? /** @type {string} */ (asked) : InfoTopicId.MECHANICS;
    this.#back = params?.back ?? SceneId.MAIN_MENU;
    this.#scroll = {};
    this.#rebuild();
    this.focus(this.root.findById(`info.tab.${this.#topicId}`));
  }

  exit() {
    this.#article = null;
    super.exit();
  }

  onCancel() {
    this.services.navigate(this.#back);
  }

  relayout() {
    this.#rebuild();
  }

  /** Page Up / Page Down / Home / End scroll the article, whatever has the focus. @param {import("../../input/InputManager.js").KeyInput} input */
  onKey(input) {
    const article = this.#article;
    const step = article === null ? 0 : article.height * PAGE;
    const scrolls = { PageDown: () => article?.scrollBy(step), PageUp: () => article?.scrollBy(-step), Home: () => article?.scrollTo(0), End: () => article?.scrollTo(article.maxScrollY) };
    const scroll = input.type === "keydown" && this.overlay === null && this.modal === null ? scrolls[/** @type {keyof typeof scrolls} */ (input.key)] : undefined;
    if (scroll === undefined) {
      super.onKey(input);
      return;
    }
    if (scroll() === true) {
      this.services.requestRender();
    }
  }

  /** @param {CanvasRenderingContext2D} context */
  render(context) {
    drawSceneBackdrop(context, this.services.theme, this.services.viewport.bounds, { seed: "info" });
    super.render(context);
  }

  /** The topic on show. */
  get #topic() {
    return this.#topics.find((topic) => topic.id === this.#topicId) ?? this.#topics[0];
  }

  #rebuild() {
    const focusedId = this.focusedNode?.id ?? "";
    this.root.clear();
    const { viewport } = this.services;
    const { header, columns, inset, panel: panelOptions, compact } = this.#screen;
    const m = this.#m;
    const titleWidth = viewport.logicalWidth - 2 * header.sideMargin - header.backWidth - 16;
    this.root.add(new Label({ x: header.sideMargin, y: header.y, width: titleWidth, height: header.height, text: "Info", size: "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true, fit: true }));
    const back = this.root.add(new Button({ id: "info.back", x: viewport.logicalWidth - header.sideMargin - header.backWidth, y: header.y + 4, width: header.backWidth, height: header.height - 8, text: this.#back === SceneId.MAIN_MENU ? this.#screen.backText : "Back", onActivate: () => this.onCancel() }));

    const left = columns.left.x;
    const tabs = this.root.add(new Panel({ ...panelOptions, x: left, y: columns.top, width: m.tabsWidth, height: columns.height }));
    this.#topics.forEach((topic, index) => {
      tabs.add(
        new Button({
          id: `info.tab.${topic.id}`,
          x: inset,
          y: inset + index * (m.tab.height + m.tab.gap),
          width: m.tabsWidth - 2 * inset,
          height: m.tab.height,
          text: compact ? topic.shortTitle : topic.title,
          textSize: compact ? "small" : "body",
          variant: topic.id === this.#topicId ? "primary" : "secondary",
          onActivate: () => this.#show(topic.id),
        }),
      );
    });

    this.#buildArticle(left + m.tabsWidth + m.gap);
    this.focus(this.root.findById(focusedId) ?? back);
    this.services.requestRender();
  }

  /** @param {number} x where the article's panel starts */
  #buildArticle(x) {
    const { viewport } = this.services;
    const { columns, inset, panel: panelOptions, compact } = this.#screen;
    const m = this.#m;
    const topic = this.#topic;
    const width = viewport.logicalWidth - columns.left.x - x;
    const panel = this.root.add(new Panel({ ...panelOptions, x, y: columns.top, width, height: columns.height }));
    const inner = width - 2 * inset;
    panel.add(new Label({ id: "info.title", x: inset, y: inset, width: inner, height: m.title, text: topic.title, size: compact ? "body" : "heading", weight: "bold", colorKey: "accentLight", align: "left", fit: true }));
    const top = inset + m.title + SPACING;
    const linkRoom = topic.link === null ? 0 : m.link + SPACING;
    this.#article = panel.add(
      new InfoArticle({
        id: "info.article",
        x: inset,
        y: top,
        width: inner,
        height: columns.height - top - inset - linkRoom,
        blocks: topic.blocks,
        compact,
        scrollY: this.#scroll[topic.id] ?? 0,
        onScroll: (scrollY) => (this.#scroll[topic.id] = scrollY),
      }),
    );
    const link = topic.link;
    if (link !== null) {
      const open = this.services.openLink;
      panel.add(new Button({ id: "info.link", x: inset, y: columns.height - inset - m.link, width: inner, height: m.link, text: link.text, textSize: compact ? "small" : "body", variant: "primary", enabled: open !== undefined, onActivate: () => this.#open(link.url) }));
    }
  }

  /** @param {string} topicId */
  #show(topicId) {
    if (topicId === this.#topicId) {
      return;
    }
    this.#topicId = topicId;
    this.#rebuild();
  }

  /** @param {string} url */
  #open(url) {
    this.services.logger.info("info link opened", { url });
    this.services.openLink?.(url);
  }
}
