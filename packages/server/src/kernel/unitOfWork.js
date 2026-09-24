/**
 * A unit of work runs `work` so that every write it makes — across modules —
 * commits together or not at all. Production passes
 * `(work) => database.transaction(work)`; application services depend on
 * this function type only, never on the database.
 *
 * @typedef {<T>(work: () => Promise<T>) => Promise<T>} UnitOfWork
 */

/**
 * @param {{ transaction: <T>(work: () => Promise<T>) => Promise<T> }} database
 * @returns {UnitOfWork}
 */
export const unitOfWorkOf = (database) => (work) => database.transaction(work);
