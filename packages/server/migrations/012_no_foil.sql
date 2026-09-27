-- Foil is gone: a copy is a card, an edition and a serial, nothing else. What the finish touched is put
-- right first, then the columns go.

-- A paid order of a foil single still waiting for its cards cannot be fulfilled any more: settle it with
-- the previous version (fulfil or refund) before upgrading.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE i.product_id LIKE 'single\_%\_foil' AND o.status IN ('PAYMENT_DETECTED', 'PAYMENT_VERIFIED')
  ) THEN
    RAISE EXCEPTION 'a paid order of a foil single is not fulfilled yet: fulfil or refund it with the previous version first';
  END IF;
END;
$$;

-- Unpaid orders of foil singles are cancelled: a payment arriving later is queued for refund like any
-- payment of a cancelled order.
UPDATE orders SET status = 'CANCELLED', failure_reason = 'foil singles are no longer sold', version = version + 1, updated_at = now()
WHERE status IN ('CREATED', 'PAYMENT_PENDING')
  AND id IN (SELECT order_id FROM order_items WHERE product_id LIKE 'single\_%\_foil');

-- Every other order line of a foil single now names the standard single of the same card (the price paid
-- stays in unit_amount), so no order refers to a product that no longer exists; then those products go.
UPDATE order_items SET product_id = left(product_id, -length('_foil'))
WHERE product_id LIKE 'single\_%\_foil';
DELETE FROM product_items WHERE product_id LIKE 'single\_%\_foil';
DELETE FROM product_prices WHERE product_id LIKE 'single\_%\_foil';
DELETE FROM products WHERE id LIKE 'single\_%\_foil';
ALTER TABLE product_items DROP COLUMN finish;

-- Copies: foil ones become ordinary copies of the same card, edition and serial.
DROP VIEW collections;
ALTER TABLE card_instances DROP COLUMN finish;
CREATE VIEW collections AS
  SELECT owner_id, definition_id, count(*)::INTEGER AS copies
  FROM card_instances
  WHERE status = 'active'
  GROUP BY owner_id, definition_id;

-- Records not yet broadcast drop the finish code from every copy ([id, definition, serial, "s"|"f"] becomes
-- [id, definition, serial]), in receipts, trades and sales alike. Records already on chain are history and
-- stay as they are.
ALTER TABLE blockchain_events DISABLE TRIGGER blockchain_events_immutable;
UPDATE blockchain_events
SET payload = regexp_replace(payload, '(\["[0-9a-f-]{36}","[^"]+",[0-9]+),"[sf]"\]', '\1]', 'g')
WHERE status = 'BUILT' AND transaction_id IS NULL AND kind IN ('RECEIPT', 'TRADE', 'SALE');
UPDATE blockchain_events
SET payload_hash = encode(sha256(convert_to(payload, 'UTF8')), 'hex')
WHERE status = 'BUILT' AND transaction_id IS NULL AND kind IN ('RECEIPT', 'TRADE', 'SALE');
ALTER TABLE blockchain_events ENABLE TRIGGER blockchain_events_immutable;

-- Notifications of sales named the copy's finish.
UPDATE notifications SET data = data #- '{card,finish}' WHERE data -> 'card' ? 'finish';
