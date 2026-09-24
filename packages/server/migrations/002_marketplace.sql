-- M3 marketplace and payments. Design notes: docs/tcg/04-modello-dati.md

-- A pack epoch stops taking orders when it closes; its secret is published only once every order
-- assigned to it is settled, otherwise a buyer could grind transaction ids against a known secret.
ALTER TABLE rng_epochs ADD COLUMN revealed_at TIMESTAMPTZ;
ALTER TABLE rng_epochs ADD CONSTRAINT rng_epochs_reveal_after_close
  CHECK (revealed_at IS NULL OR (closed_at IS NOT NULL AND revealed_at >= closed_at));

-- The chain account that must send the payment (the buyer's account on the order's network).
ALTER TABLE orders ADD COLUMN payer TEXT NOT NULL;
-- Payment workers pick up orders by state.
CREATE INDEX orders_settling ON orders (status, updated_at) WHERE status IN ('PAYMENT_DETECTED', 'PAYMENT_VERIFIED');
-- When the transfer's block was produced: a payment is on time if its block is, whenever we see it.
ALTER TABLE payments ADD COLUMN block_time TIMESTAMPTZ NOT NULL;
-- Payments waiting for irreversibility.
CREATE INDEX payments_detected ON payments (network, block_num) WHERE status = 'DETECTED';

-- What an order minted: copies carry the order (or order/pack) as their origin reference.
CREATE INDEX card_instances_origin ON card_instances (origin_kind, origin_ref);
