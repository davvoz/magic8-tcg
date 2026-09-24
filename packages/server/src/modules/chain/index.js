/**
 * Chain module: the outbox of protocol records to publish (receipts now,
 * game records and the broadcaster in M5). Other modules use only what is exported here.
 */
export { ChainOutbox, OutboxKind } from "./application/ChainOutbox.js";
export { PgOutboxRepository } from "./infrastructure/PgOutboxRepository.js";
