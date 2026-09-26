/**
 * The player's notification feed as the server keeps it
 * (docs/tcg/15-notifiche.md). New notifications also arrive on the
 * realtime connection as `notification` messages.
 *
 * @typedef {Readonly<{ id: number, kind: string, data: Readonly<Record<string, any>>, createdAt: number, read: boolean }>} PlayerNotification
 * @typedef {Readonly<{ notifications: readonly PlayerNotification[], unread: number, more: boolean }>} NotificationPage
 *
 * @typedef {object} NotificationsApi
 * @property {(before?: number) => Promise<import("@magic8/engine/shared/Result.js").Ok<NotificationPage> | import("@magic8/engine/shared/Result.js").Fail>} list newest first; `before`: older than that id
 * @property {(request: { ids: readonly number[] } | { all: true }) => Promise<import("@magic8/engine/shared/Result.js").Ok<{ unread: number }> | import("@magic8/engine/shared/Result.js").Fail>} markRead
 */

export const NOTIFICATIONS_API_METHODS = Object.freeze(["list", "markRead"]);
