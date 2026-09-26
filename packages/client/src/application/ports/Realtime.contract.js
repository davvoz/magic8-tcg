/**
 * A live, authenticated connection to the game server (WebSocket in the
 * browser). Messages are envelopes { t, d }; `request` sends one with an id
 * and resolves with the server's reply to it. The connection reconnects by
 * itself after a drop; listeners hear "open" again and should say hello.
 *
 * @typedef {Readonly<{ t: string, d: any }>} ServerMessage
 * @typedef {"connecting" | "open" | "closed"} ConnectionStatus
 * @typedef {object} RealtimeConnection
 * @property {() => void} connect idempotent: several services share one connection
 * @property {ConnectionStatus} [status] where it stands now (a listener added late missed "open")
 * @property {() => void} close for good (no reconnection)
 * @property {(type: string, data: unknown) => Promise<import("@magic8/engine/shared/Result.js").Ok<ServerMessage> | import("@magic8/engine/shared/Result.js").Fail>} request
 * @property {(listener: (message: ServerMessage) => void) => () => void} subscribe messages that are not replies
 * @property {(listener: (status: ConnectionStatus, detail: { code: number | null }) => void) => () => void} onStatus
 */

export const RealtimeFailure = Object.freeze({ NOT_CONNECTED: "NOT_CONNECTED", TIMEOUT: "TIMEOUT" });

export const REALTIME_CONNECTION_METHODS = Object.freeze(["connect", "close", "request", "subscribe", "onStatus"]);
