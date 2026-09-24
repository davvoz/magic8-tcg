/** Thrown for programmer errors when producing protocol data (never for untrusted input, which gets a Result). */
export class ProtocolError extends Error {
  /**
   * @param {string} message
   * @param {unknown} [details]
   */
  constructor(message, details) {
    super(message);
    this.name = "ProtocolError";
    this.details = details ?? null;
  }
}
