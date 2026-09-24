/**
 * The client's address, for rate limits and logs.
 *
 * Behind a reverse proxy the socket's address is the proxy's; the proxy
 * appends the address it saw to X-Forwarded-For. Only that last entry can
 * be trusted: everything before it was sent by the client and can be
 * anything (reading the first entry would let anyone pick a fresh address
 * per request and escape every per-address limit). With `trustProxy` off,
 * the header is ignored altogether.
 */
const ADDRESS_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {boolean} trustProxy true when exactly one trusted reverse proxy sits in front of the server
 * @returns {string}
 */
export function clientAddress(request, trustProxy) {
  const socketAddress = request.socket.remoteAddress ?? "unknown";
  if (!trustProxy) {
    return socketAddress;
  }
  const header = request.headers["x-forwarded-for"];
  const entries = typeof header === "string" ? header.split(",").map((entry) => entry.trim()) : [];
  const appendedByProxy = entries.at(-1) ?? "";
  return ADDRESS_PATTERN.test(appendedByProxy) ? appendedByProxy : socketAddress;
}
