/**
 * Attackers and blocks declared during the current combat. Cleared at the end
 * of combat. `blocks` maps attackerId → blockerIds so multiple blockers per
 * attacker are representable even though the slice allows one.
 */
export class CombatState {
  /** @type {string[]} */
  attackerIds;
  /** @type {Map<string, string[]>} */
  blocks;

  /**
   * @param {{ attackerIds?: readonly string[], blocks?: ReadonlyMap<string, readonly string[]> }} [fields]
   */
  constructor({ attackerIds = [], blocks = new Map() } = {}) {
    this.attackerIds = [...attackerIds];
    this.blocks = new Map([...blocks].map(([attackerId, blockerIds]) => [attackerId, [...blockerIds]]));
  }

  get hasAttackers() {
    return this.attackerIds.length > 0;
  }

  /** @param {string} attackerId */
  blockersOf(attackerId) {
    return Object.freeze([...(this.blocks.get(attackerId) ?? [])]);
  }

  /**
   * Starts a new combat with these attackers and no blocks yet.
   * @param {readonly string[]} attackerIds
   */
  declareAttackers(attackerIds) {
    this.attackerIds = [...attackerIds];
    this.blocks = new Map();
  }

  /**
   * Records blocks, grouped by attacker in declaration order.
   * @param {readonly Readonly<{ attackerId: string, blockerId: string }>[]} blocks
   */
  declareBlocks(blocks) {
    const grouped = new Map();
    for (const block of blocks) {
      grouped.set(block.attackerId, [...(grouped.get(block.attackerId) ?? []), block.blockerId]);
    }
    this.blocks = grouped;
  }

  clear() {
    this.attackerIds = [];
    this.blocks = new Map();
  }

  clone() {
    return new CombatState({ attackerIds: this.attackerIds, blocks: this.blocks });
  }

  /** Plain representation for snapshots. */
  toPlain() {
    return {
      attackerIds: [...this.attackerIds],
      blocks: [...this.blocks].map(([attackerId, blockerIds]) => ({ attackerId, blockerIds: [...blockerIds] })),
    };
  }
}
