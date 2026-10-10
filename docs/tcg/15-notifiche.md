# 15 — Notifiche al giocatore

**Stato:** 2026-09-26.
- **Server:** modulo `notifications` (`NotificationService`: scrittura, feed, lettura, conservazione; `NotificationRelay`: invio in tempo reale). Tabella `notifications` (migrazione 009).
- **Client:** `NotificationService` (feed e connessione), toast sopra ogni schermata, pulsante "Notifications" nel menu principale, schermata "Notifications".

## L'idea

Molte cose succedono mentre il giocatore guarda altrove o non è collegato: le carte comprate arrivano dopo circa un minuto (irreversibilità STEEM, 00), qualcuno accetta o rifiuta uno scambio, una carta in bacheca viene venduta. Prima il giocatore doveva restare sulla schermata giusta e aspettare. Adesso ogni evento del genere lascia una **notifica**: arriva subito se il giocatore è collegato e resta nel suo feed se non lo è.

## Garanzie

| Proprietà | Come |
|---|---|
| **Mai una notifica per qualcosa che non è successo** | La riga viene scritta **nella stessa transazione** del cambio di stato che racconta (consegna dell'ordine, accettazione dello scambio, vendita…). Se la transazione fallisce non resta nulla. |
| **Mai una notifica persa** | La riga è il dato. Il push è solo un'accelerazione: il client rilegge il feed a ogni (ri)connessione. |
| **Push solo dopo il commit** | Nella stessa transazione parte un `pg_notify('m8_notifications', {id, userId})`. PostgreSQL lo consegna solo al commit e solo se il commit avviene. |
| **Più processi server** | Ogni processo ha un `NotificationRelay` in `LISTEN` sul canale. Solo il processo che ha la connessione di quel giocatore legge la riga e la invia (`notification`). Per gli altri il costo è un confronto in memoria. |
| **Connessione LISTEN persa** | Il driver la riapre con backoff. Al ritorno il relay chiede a tutti i giocatori collegati di rileggere il feed (`notifications.resync`), perché nel frattempo qualcosa può essere passato. |
| **Dati piccoli e sicuri** | Il payload di NOTIFY porta solo id e utente (il limite di PostgreSQL è 8000 byte). La notifica contiene tipo e dati strutturati (id, account, id delle carte), mai testo: al massimo 4 KB, tipi da un elenco chiuso. Il testo lo compone il client. |

## Tipi

| Tipo | A chi | Quando |
|---|---|---|
| `shop.fulfilled` | compratore | l'ordine è consegnato: prodotti, carte ricevute (per definizione), totale |
| `shop.refund` | compratore | un pagamento per un suo ordine non corrisponde ed è in coda di rimborso |
| `trade.offered` | destinatario | nuova proposta: cosa offre, cosa chiede |
| `trade.accepted` | proponente | accettata: cosa ha ricevuto, cosa ha dato |
| `trade.declined` | proponente | rifiutata: le carte tornano disponibili |
| `trade.cancelled` | destinatario | il proponente ha ritirato l'offerta |
| `trade.expired` | entrambi | l'offerta è scaduta |
| `sale.sold` | venditore | la carta è stata pagata ed è passata al compratore (prezzo, compratore) |
| `sale.bought` | compratore | la carta pagata è sua |
| `sale.listing_expired` | venditore | l'annuncio è scaduto, la carta torna libera |
| `sale.reservation_expired` | compratore | non ha pagato in tempo, la carta torna in vendita |
| `sale.payment_problem` | compratore | il trasferimento non paga l'acquisto (importo, valuta, mittente, ritardo) |
| `auto.finished` | entrambi | la partita della lista automatica è stata giocata: avversario, esito, stili, rating prima e dopo (23) |
| `auto.refunded` | giocatore | il biglietto automatico si è chiuso senza partita (stagione finita, partita impossibile): l'ingresso è tornato (23) |

## Conservazione

Il feed si legge a pagine di 30, dalla più recente. Le notifiche lette si cancellano dopo 30 giorni, tutte le altre dopo 180 (job orario, a lotti di 5000). Gli indici: `(user_id, id DESC)` per il feed, parziale sulle non lette per il contatore, `created_at` per la pulizia.

## Client

- Dopo il login, quando l'account è caricato, il `NotificationService` apre la connessione realtime (la stessa del gioco online, che ora parte al login e non più solo entrando in "Play online") e legge il feed.
- Una notifica in arrivo diventa un **toast** in alto a destra, sopra qualsiasi schermata. Un clic apre il feed. Se la notifica cambia la collezione (carte ricevute, restituite, vendute) il client la ricarica.
- Il menu principale mostra "Notifications (n)" con il numero delle non lette.
- La schermata "Notifications" mostra cosa è successo e quando, le carte coinvolte (con rarità, e ogni carta apre il suo dettaglio) e porta alla schermata dove si prosegue (collezione, scambi, bacheca, negozio) con un clic sulla riga o sul pulsante "Open". Aprendola, le notifiche vengono segnate come lette (il contatore del menu si azzera); quelle arrivate non lette restano **illuminate** e marcate "New", per tutta la sessione, finché il giocatore non le apre.
- Aprendo una notifica che porta alla collezione (ordine consegnato, scambio accettato, carta comprata), la collezione riceve le carte arrivate: le mette in cima alla lista, illuminate e con l'etichetta "NEW", seleziona la prima e ne indica le copie nuove; se la notifica dà il seriale (carta singola) quella copia è evidenziata. "Back" riporta alle notifiche.
- Durante un acquisto (negozio o bacheca), dopo il pagamento il giocatore può andare dove vuole: la notifica lo avvisa quando la carta arriva.

## API

| Metodo | Percorso | Note |
|---|---|---|
| `GET` | `/api/notifications?before=<id>` | `{ notifications, unread, more }`, dalla più recente; `before` per le pagine successive |
| `POST` | `/api/notifications/read` | `{ "all": true }` oppure `{ "ids": [..] }` (da 1 a 100); risponde `{ unread }` |
| WS | `notification` | una notifica appena scritta (stessa forma del feed) |
| WS | `notifications.resync` | rileggere il feed |

Ogni giocatore legge e segna solo le proprie notifiche. Limiti di frequenza: 60 richieste, poi 1 al secondo, per utente.

## Da fare

- Preferenze (disattivare alcuni tipi) e notifiche fuori dal gioco (email, push del browser).
- Notifiche per le partite classificate (fine stagione, cambio di grado).
