/**
 * Structural validation of an untrusted command object before any game
 * logic looks at it: known type, well-formed ids, bounded arrays, no extra
 * fields. Semantic checks (is it your turn, can you afford it) belong to the
 * engine and the handlers.
 */
import { LIMITS } from "../../shared/limits.js";
import { Issues, checkArrayOf, checkEnum, checkObject, checkString } from "../../shared/validation.js";
import { COMMAND_TYPES, CommandType } from "./CommandType.js";

/** Upper bound on ids in a single command; a battlefield never holds more than a few creatures. */
const MAX_IDS_PER_COMMAND = 32;

const ID_OPTIONS = Object.freeze({ minLength: 1, maxLength: LIMITS.INSTANCE_ID_MAX_LENGTH, pattern: LIMITS.ID_PATTERN });
const BASE_KEYS = Object.freeze(["type", "playerId"]);
const BLOCK_KEYS = Object.freeze(["attackerId", "blockerId"]);

/** Extra fields per command type, each validated by a dedicated check. */
const FIELDS_BY_TYPE = Object.freeze({
  [CommandType.PLAY_CARD]: Object.freeze(["cardId", "targets"]),
  [CommandType.DECLARE_ATTACKERS]: Object.freeze(["attackerIds"]),
  [CommandType.DECLARE_BLOCKERS]: Object.freeze(["blocks"]),
  [CommandType.END_PHASE]: Object.freeze([]),
  [CommandType.END_TURN]: Object.freeze([]),
  [CommandType.CONCEDE]: Object.freeze([]),
});

/**
 * @param {unknown} raw
 * @returns {import("../../shared/Result.js").Ok<Readonly<Record<string, unknown>>> | import("../../shared/Result.js").Fail}
 */
export function validateCommandShape(raw) {
  const issues = new Issues();
  const object = checkObject(issues, raw, "command");
  if (object === undefined) {
    return issues.toResult(undefined);
  }
  const type = checkEnum(issues, object.type, "command.type", COMMAND_TYPES);
  const playerId = checkString(issues, object.playerId, "command.playerId", ID_OPTIONS);
  if (type === undefined || playerId === undefined) {
    return issues.toResult(undefined);
  }
  checkObject(issues, object, "command", [...BASE_KEYS, ...FIELDS_BY_TYPE[type]]);
  const extra = checkTypedFields(issues, object, type);
  if (!issues.isEmpty) {
    return issues.toResult(undefined);
  }
  return issues.toResult(Object.freeze({ type, playerId, ...extra }));
}

/**
 * @param {Issues} issues
 * @param {Record<string, unknown>} object
 * @param {string} type
 * @returns {Record<string, unknown>}
 */
function checkTypedFields(issues, object, type) {
  switch (type) {
    case CommandType.PLAY_CARD:
      return {
        cardId: checkString(issues, object.cardId, "command.cardId", ID_OPTIONS),
        targets: Object.freeze(checkIdList(issues, object.targets ?? [], "command.targets", LIMITS.MAX_TARGET_COUNT) ?? []),
      };
    case CommandType.DECLARE_ATTACKERS:
      return { attackerIds: Object.freeze(checkIdList(issues, object.attackerIds, "command.attackerIds", MAX_IDS_PER_COMMAND) ?? []) };
    case CommandType.DECLARE_BLOCKERS:
      return { blocks: Object.freeze(checkBlocks(issues, object.blocks) ?? []) };
    default:
      return {};
  }
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {number} maxLength
 */
function checkIdList(issues, raw, path, maxLength) {
  return checkArrayOf(issues, raw, path, {
    maxLength,
    item: (item, itemPath) => checkString(issues, item, itemPath, ID_OPTIONS),
  });
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 */
function checkBlocks(issues, raw) {
  return checkArrayOf(issues, raw, "command.blocks", {
    maxLength: MAX_IDS_PER_COMMAND,
    item: (item, path) => {
      const block = checkObject(issues, item, path, BLOCK_KEYS);
      if (block === undefined) {
        return undefined;
      }
      const attackerId = checkString(issues, block.attackerId, `${path}.attackerId`, ID_OPTIONS);
      const blockerId = checkString(issues, block.blockerId, `${path}.blockerId`, ID_OPTIONS);
      return attackerId === undefined || blockerId === undefined ? undefined : Object.freeze({ attackerId, blockerId });
    },
  });
}
