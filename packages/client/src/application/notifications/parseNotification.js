/**
 * The shape of a notification as the server sends it (list and push),
 * checked before the application relies on it.
 */
const KIND = /^[a-z]+\.[a-z_]+$/;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * @param {any} value
 * @returns {import("../ports/NotificationsApi.contract.js").PlayerNotification | null}
 */
export function parseNotification(value) {
  const valid = Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.kind === "string" && KIND.test(value.kind) && value.data !== null && typeof value.data === "object" && !Array.isArray(value.data) && isCount(value.createdAt) && typeof value.read === "boolean";
  return valid ? Object.freeze({ id: value.id, kind: value.kind, data: Object.freeze({ ...value.data }), createdAt: value.createdAt, read: value.read }) : null;
}
