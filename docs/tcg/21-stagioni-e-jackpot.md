# 21 — Stagioni e jackpot

**Stato:** 2026-10-03. Modulo `jackpot` del server, dati in `data/ranked/ranked.json` (`seasons`, `prizePools`), migrazione `015_season_jackpots.sql`.

## Le regole

- **Season 1** dura un mese: dal 5 ottobre 2026 alle 00:00 UTC al 5 novembre 2026 alle 00:00 UTC. I rating ripartono da zero (doc 09). La stagione precedente, ora chiamata *Beta season*, finisce quando comincia Season 1.
- **Jackpot = 2/3 del wallet della banca** (`@verdu.green`, l'account dello shop, dove arrivano i pagamenti dei pacchetti e degli ingressi ranked), in STEEM liquidi. Più pacchetti e ingressi si vendono durante la stagione, più il jackpot cresce.
- **Ingresso:** in Season 1 ogni partita classificata costa un ingresso ranked (1 STEEM) a giocatore (doc 22). Ai giocatori diciamo solo che gli ingressi finiscono nel jackpot.
- **Ripartizione:** 65% al 1°, 25% al 2°, al 3° il resto (10%, più quello che resta dagli arrotondamenti per difetto). La somma delle tre quote è sempre esattamente il jackpot.
- **Chi vince:** le prime tre posizioni della classifica della stagione, contando **solo i rating assestati** (con posizione, doc 09). Un rating provvisorio non vince niente.
- **Posizioni senza vincitore** (meno di tre rating assestati): la loro quota resta nella banca, per la stagione successiva.

## Cosa vede il giocatore

Il pannello del jackpot, dorato e illuminato, mostra:

- l'importo totale, grande;
- il conto alla rovescia alla fine della stagione, al secondo (*Ends in 12d 04h 31m 08s*); prima dell'inizio, il conto alla rovescia all'inizio;
- da dove viene: *2/3 of @verdu.green's wallet · grows with every pack sold and every ranked game*, e quanto è cresciuto dall'inizio della stagione (*+200.000 STEEM since the season began*);
- le tre posizioni: quota, importo e chi le occupa **adesso** (con il ritratto), oppure *nobody yet · it could be you*.

Dove si vede:

| Schermata | Come |
|---|---|
| Menu principale (desktop) | scheda a destra dei pulsanti; con l'accesso fatto, un clic apre la classifica |
| Menu principale (telefono) | banner di tre righe sotto il titolo, al posto del sottotitolo |
| Classifica | in testa, su tutta la larghezza; *Back* torna da dove si è arrivati |
| Notifiche | al vincitore: *You finished 1st in Season 1!* con l'importo |

Il pannello si vede anche senza accesso: il jackpot è pubblico. Il client lo rilegge ogni minuto finché è sullo schermo; il conto alla rovescia si aggiorna ogni secondo dall'orologio del dispositivo.

## Come funziona

- **Valore live.** `GET /api/jackpot` (pubblico, in cache 15 s) legge il saldo della banca dalla catena al massimo una volta al minuto (`balanceMaxAgeMs`) e calcola jackpot e quote. Se la catena non risponde mostra l'ultimo saldo letto, o nessun importo.
- **Saldo di apertura.** Un job ogni minuto registra il saldo della banca la prima volta che vede la stagione in corso (`season_jackpots.opening_balance`): serve a mostrare quanto è cresciuto il jackpot.
- **Chiusura.** Finita la stagione, il job aspetta `settleAfterMinutes` (30) perché tutte le partite finite in tempo siano registrate (il recupero delle partite perse gira ogni 10 minuti, doc 09). Poi, **una sola volta** (compare-and-set sul database, anche con più processi):
  1. legge il saldo della banca (se la catena non risponde riprova al giro dopo);
  2. congela il jackpot (`season_jackpots.jackpot`) e lo divide;
  3. scrive un premio `PENDING` per ogni vincitore (`season_prizes`) e gli manda la notifica `season.prize`;
  4. registra tutto nell'audit (`jackpot.settled`).
  Dopo la chiusura il pannello mostra il jackpot finale e lo stato di ogni pagamento (*to be paid*, *sent*, *paid*).
- **Pagamento.** Il server non ha (e non deve avere) la active key della banca. L'operatore paga dal pannello `/admin.html`, sezione *Season prizes to send*, con Keychain, memo `m8tcg prize <stagione> <posizione>`. Come per i rimborsi (doc 07 §7), **il server non si fida del pannello**: il `PrizePayoutWatcher` legge i trasferimenti in uscita della banca e segna il premio `SENT` solo se destinatario, asset e importo coincidono esattamente, poi `CONFIRMED` sotto il blocco irreversibile. Importo sbagliato, memo sconosciuto o premio pagato due volte finiscono nell'audit (`jackpot.prize_mismatch`, `prize_unknown`, `prize_paid_twice`) e nel log come errore.

## Configurazione

```json
"seasons": [
  { "id": "2026-s1", "name": "Beta season", "startsAt": "2026-09-01T00:00:00Z" },
  { "id": "season-1", "name": "Season 1", "startsAt": "2026-10-05T00:00:00Z", "endsAt": "2026-11-05T00:00:00Z", "prizePool": "bank-jackpot" }
],
"prizePools": {
  "bank-jackpot": { "network": "steem", "asset": "STEEM", "share": { "numerator": 2, "denominator": 3 }, "places": [65, 25, 10], "settleAfterMinutes": 30 }
}
```

- `endsAt` è facoltativo: senza, una stagione finisce quando comincia la successiva (l'ultima non finisce mai). Una stagione con `prizePool` deve averlo.
- Fra la fine di una stagione e l'inizio della successiva la classificata è chiusa.
- Una nuova stagione con jackpot è solo una nuova riga in `seasons` che nomina un pool. Si possono definire pool diversi (altra quota, più posizioni, altro asset accettato dallo shop).
- Il server controlla tutto all'avvio: percentuali che sommano a 100, quota non oltre l'intero wallet, pool esistente, banca e asset conosciuti. Un errore ferma l'avvio.

## Fair play

Da Season 1 il rating vale denaro: le segnalazioni di fair play (doc 09: coppie ripetute, rese rapide) vanno controllate in `/api/admin/ranking-flags` **prima** di pagare i premi. Il server non blocca nessun pagamento da solo: è l'operatore a decidere di non pagare un premio ottenuto in modo scorretto.
