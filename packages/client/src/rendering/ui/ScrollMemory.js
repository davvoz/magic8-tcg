/**
 * Keeps where a scene's lists were scrolled across a rebuild: a scene that
 * redraws everything when something changes (a row picked, the server's
 * word) would otherwise send every list back to its top.
 *
 * `capture` notes each list's offset before the tree is cleared; `restore`
 * puts it back on the list with the same id in the new tree, once its rows
 * are in. A list that now shows something else (its `scrollKey` changed: a
 * new filter, another page) starts from the top.
 */
import { ScrollList } from "./ScrollList.js";

export class ScrollMemory {
  /** @type {Map<string, { key: string, scrollY: number }>} */
  #offsets = new Map();

  /** @param {import("./UiNode.js").UiNode} root the tree about to be cleared */
  capture(root) {
    this.#offsets.clear();
    for (const list of scrollLists(root)) {
      this.#offsets.set(list.id, { key: list.scrollKey, scrollY: list.scrollY });
    }
  }

  /** @param {import("./UiNode.js").UiNode} root the rebuilt tree, its lists filled */
  restore(root) {
    for (const list of scrollLists(root)) {
      const saved = this.#offsets.get(list.id);
      if (saved !== undefined && saved.key === list.scrollKey) {
        list.scrollTo(saved.scrollY);
      }
    }
  }
}

/**
 * Every list with an id in the tree.
 * @param {import("./UiNode.js").UiNode} node
 * @returns {ScrollList[]}
 */
function scrollLists(node) {
  if (node instanceof ScrollList) {
    return node.id === "" ? [] : [node];
  }
  return node.children.flatMap(scrollLists);
}
