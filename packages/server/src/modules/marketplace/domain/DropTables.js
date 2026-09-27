/**
 * Drop tables as data (data/economy/drop-tables/*.json) resolved into the
 * protocol's DropTable: each rarity used by a slot gets its pool, every card
 * of the catalog with that rarity, sorted. The resolved table is what packs
 * are drawn from and what receipts name by hash, so anyone can recompute a
 * pack (@magic8/protocol drawPack).
 */
import { Issues, checkArray, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";
import { deepFreeze } from "@magic8/engine/shared/deepFreeze.js";
import { DROP_TABLE_VERSION, dropTableHash, dropTableOdds, validateDropTable } from "@magic8/protocol";

const TABLE_KEYS = Object.freeze(["schemaVersion", "id", "edition", "slots"]);

/**
 * @typedef {Readonly<{ table: import("@magic8/protocol").DropTable, hash: string, size: number, odds: ReturnType<typeof dropTableOdds> }>} ResolvedDropTable
 */

/**
 * @param {readonly unknown[]} rawTables
 * @param {import("./Rarities.js").Rarities} rarities
 * @returns {import("@magic8/engine/shared/Result.js").Ok<ReadonlyMap<string, ResolvedDropTable>> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function resolveDropTables(rawTables, rarities) {
  const issues = new Issues();
  /** @type {Map<string, ResolvedDropTable>} */
  const tables = new Map();
  rawTables.forEach((raw, index) => {
    const path = `dropTables[${index}]`;
    const file = checkObject(issues, raw, path, TABLE_KEYS);
    if (file === undefined) {
      return;
    }
    checkInteger(issues, file.schemaVersion, `${path}.schemaVersion`, { min: 1, max: 1 });
    const id = checkString(issues, file.id, `${path}.id`);
    const slots = checkArray(issues, file.slots, `${path}.slots`, { minLength: 1 });
    if (id === undefined || slots === undefined) {
      return;
    }
    if (tables.has(id)) {
      issues.add(`${path}.id`, `duplicate drop table "${id}"`);
      return;
    }
    const used = new Set(slots.flatMap((slot) => Object.keys(/** @type {any} */ (slot)?.weights ?? {})));
    const pools = Object.fromEntries(
      [...used].sort().map((rarity) => [
        rarity,
        [...rarities.of]
          .filter(([, cardRarity]) => cardRarity === rarity)
          .map(([cardId]) => cardId)
          .sort(),
      ]),
    );
    const table = deepFreeze({ v: DROP_TABLE_VERSION, id, edition: file.edition, slots: structuredClone(slots), pools });
    try {
      const valid = validateDropTable(table);
      const size = valid.slots.reduce((total, slot) => total + slot.count, 0);
      tables.set(id, Object.freeze({ table: valid, hash: dropTableHash(valid), size, odds: dropTableOdds(valid) }));
    } catch (error) {
      issues.add(path, error instanceof Error ? error.message : String(error));
    }
  });
  return issues.toResult(/** @type {ReadonlyMap<string, ResolvedDropTable>} */ (tables));
}
