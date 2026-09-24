# 04 — Modello dati

**Stato:** proposta, 2026-09-24. Lo schema eseguibile è [`packages/server/migrations/001_initial.sql`](../../packages/server/migrations/001_initial.sql); questo documento spiega le scelte che non si leggono dall'SQL.

## 1. Tabelle per contesto

| Contesto | Tabelle |
|---|---|
| Identity | `users`, `auth_challenges`, `sessions` |
| Catalog | `content_versions`, `card_definitions` |
| Collection | `card_instances`, `card_serial_counters`, `card_instance_events`, `grants`, vista `collections` |
| Decks | `decks`, `deck_cards` |
| Marketplace | `products`, `product_prices`, `product_items`, `orders`, `order_items`, `rng_epochs` |
| Payments | `payments`, `refunds` |
| Chain | `blockchain_transactions`, `blockchain_events` (outbox dei record), `chain_cursors`, `chain_alerts` |
| Gameplay | `games`, `game_players`, `game_commands`, `game_events`, `game_snapshots`, `matchmaking` |
| Trasversali | `idempotency_keys`, `audit_logs` |

## 2. Invarianti garantite dal database (non solo dal codice)

Il codice applicativo può avere bug; queste proprietà reggono comunque, perché le impone PostgreSQL.

| Invariante | Meccanismo |
|---|---|
| Un transfer on-chain viene contato **una sola volta** | `payments UNIQUE (network, tx_id, op_index)` |
| Un ordine è pagato da **un solo** pagamento applicato | indice unico parziale `payments (order_id) WHERE status = 'APPLIED'` |
| Nessun doppio ordine per un doppio click / retry | `orders UNIQUE (user_id, idempotency_key)` + `request_hash` |
| Il memo identifica un solo ordine | `orders.memo UNIQUE` |
| Nessuna copia con lo stesso numero di serie | `card_instances UNIQUE (definition_id, edition, serial)`; serial assegnati con `card_serial_counters` sotto lock di riga |
| Un omaggio (starter) non si ottiene due volte | `grants.key PRIMARY KEY` (`starter:<userId>`) |
| Un utente è in coda al massimo una volta | indice unico parziale `matchmaking (user_id) WHERE status = 'WAITING'` |
| Un comando di partita non si applica due volte | `game_commands PRIMARY KEY (game_id, command_id)` |
| La sequenza degli eventi non ha buchi né doppioni | `game_events PRIMARY KEY (game_id, seq)` + `games.last_event_seq` aggiornato nella stessa transazione |
| Gli eventi non si riscrivono | trigger: `game_events` accetta solo l'impostazione una tantum di `record_seq`; nessun `DELETE` |
| I record da pubblicare non cambiano dopo la costruzione | trigger su `blockchain_events` (payload, hash, `game_id`, `record_seq` immutabili) + `UNIQUE (game_id, record_seq)` |
| Log di audit, storia delle copie e comandi sono append-only | trigger `forbid_mutation` |
| La catena di audit non si biforca, anche con più processi server | `audit_logs.seq PRIMARY KEY`, assegnato sotto `pg_advisory_xact_lock`; `hash UNIQUE` |
| I serial di una stampa non si ripetono, anche con coni concorrenti | l'upsert su `card_serial_counters` prenota un intervallo tenendo il lock di riga fino al commit |
| I contenuti pubblicati sono immutabili ed esattamente quelli certificati | trigger su `content_versions`; `payload` è il testo canonico esatto, non JSONB |
| Stati validi | `CHECK (status IN (…))` su ogni macchina a stati |

In produzione l'utente applicativo del DB non è proprietario delle tabelle e non ha `UPDATE`/`DELETE` sulle tabelle append-only (difesa in profondità: i trigger proteggono anche da errori di un amministratore).

## 3. Denaro

`BIGINT` nell'unità minima dell'asset (STEEM e SBD: 3 decimali, quindi `12.500 STEEM` = `12500`). La conversione da e verso la stringa `"12.500 STEEM"` della catena avviene solo nell'adattatore STEEM con parsing esatto (niente `parseFloat`: `0.1 + 0.2` non deve poter decidere un pagamento).

## 4. Transizioni di stato

Ogni transizione è un compare-and-set:

```sql
UPDATE orders
   SET status = 'PAYMENT_VERIFIED', payment_id = $2, version = version + 1, updated_at = now()
 WHERE id = $1 AND status = 'PAYMENT_DETECTED'
RETURNING version;
```

Zero righe aggiornate = qualcun altro è arrivato prima (altro worker, altra richiesta): l'operazione si ferma senza effetti. Le operazioni con più tabelle (fulfilment: ordine + pagamento + conio + outbox della ricevuta + audit) avvengono in **un'unica transazione** tramite la `UnitOfWork`.

### 4.1 Ancoraggio dei record on-chain (M5, migrazione `004_chain.sql`)

`blockchain_events.kind` ∈ `GAME_RECORD`, `RECEIPT`, `EPOCH`; `status`: `BUILT → BROADCAST → INCLUDED → IRREVERSIBLE`, e di nuovo `BUILT` (con `reconciliation = 'MISSING_ON_CHAIN'`, `transaction_id` azzerato) quando la sua transazione scade senza essere inclusa. Il payload non cambia mai (trigger), quindi un nuovo invio pubblica gli stessi byte. `blockchain_transactions` registra ogni transazione firmata **prima** dell'invio (`BROADCAST`, con la scadenza e il JSON firmato), poi `INCLUDED` (con il blocco), `IRREVERSIBLE` o `EXPIRED`. `game_events.record_seq` viene impostato una volta sola, quando l'evento entra in un record. `chain_cursors` tiene la posizione del tracker nello storico di ogni broadcaster (`tracker:<rete>:<account>`); `chain_alerts.fingerprint` evita di registrare due volte la stessa anomalia.

### 4.2 Operazioni (M6, migrazione `005_operations.sql`)

`refunds`: `PENDING → SENT` quando il trasferimento con memo `m8tcg refund <id>`, destinatario, asset e importo esatti compare nello storico dello shop (`refund_tx_id`, `refund_op_index`, `refund_block_num`, `refund_time`), `→ CONFIRMED` quando due nodi lo vedono sotto il blocco irreversibile, di nuovo `PENDING` se sparisce. Un vincolo impedisce `SENT`/`CONFIRMED` senza il trasferimento. Indice su `blockchain_events.payload_hash` per sapere se l'impegno di un'epoca è sulla catena prima di vendere pacchetti.

## 5. Segreti a riposo

`games.secret_encrypted` e `rng_epochs.secret_encrypted` sono cifrati con AES-256-GCM con una chiave fornita dall'ambiente (non nel DB, non nel repository), con id di chiave per la rotazione (procedura in 07 §4.1, script `maintenance/rotateDataKey.js`). Un dump del DB non permette di conoscere i seed delle partite in corso né i pacchetti futuri.

## 6. Crescita

- `game_events` è la tabella più grande (≈ 200 righe per partita): partizionamento per mese di `created_at` quando supera qualche decina di milioni di righe; le partite concluse e irreversibili on-chain possono essere archiviate, perché ricostruibili dalla catena.
- `audit_logs` e `card_instance_events` crescono lentamente; indicizzati per chiave di accesso.
- `auth_challenges` scaduti e sessioni revocate vengono ripuliti da un job periodico (non sono dati storici).
