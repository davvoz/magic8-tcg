# 28 — Chat al tavolo

**Stato:** 2026-10-28. Server: modulo `gameplay` (`GameActor.chat`, `domain/chat.js`, messaggio `game.chat`). Client: `MatchChat`, il pulsante e il dialogo della chat nella schermata di gioco (`ChatDialog`), i fumetti accanto ai posti (`SpeechBubble`).

## L'idea

Nelle partite online i due giocatori possono scriversi, e chi guarda la partita può commentarla. Quello che dice un giocatore compare come **fumetto accanto al suo posto**, lo stesso dei personaggi delle Sfide (24), e nel registro di battaglia. Gli spettatori hanno una chat loro: leggono i giocatori e si leggono fra loro.

## Chi legge cosa

| Chi scrive | Lo leggono |
|---|---|
| un giocatore | l'altro giocatore e tutti gli spettatori |
| uno spettatore | solo gli spettatori |

I giocatori **non leggono** gli spettatori: nessuno può suggerire mosse dagli spalti. Lo spettatore vede comunque meno di ciascun giocatore (10, *Cosa vede uno spettatore*), ma un commento come "attento all'attacco" resta un aiuto; la regola è la stessa delle partite di scacchi online. Il dialogo dice a ciascuno chi lo legge.

## Regole

- **Chi può scrivere:** i due giocatori, e chi sta guardando la partita (`watch.start`). Gli altri ricevono `NOT_IN_GAME`.
- **Quando:** da quando la partita è cominciata (`GAME_NOT_ACTIVE` prima). I giocatori possono ancora scriversi per **un minuto dopo la fine** (il "gg"): il server tiene l'attore della partita finita per quel tempo. Gli spettatori smettono con la partita (`watch.over`).
- **Contro l'IA no:** in una partita contro l'IA del server (Sfide) non c'è nessuno a leggere: `CHAT_CLOSED`, e il client non mostra il pulsante.
- **Il testo** (`cleanChatLine`): testo semplice su una riga, al massimo **140 caratteri**. Spariscono i caratteri di controllo e di formattazione (per esempio quelli che invertono la direzione del testo), tranne il joiner che tiene insieme le emoji; gli spazi ripetuti diventano uno. Una riga vuota dopo la pulizia è `INVALID_CHAT`.
- **Quanto spesso** (`ChatThrottle`): 4 righe di fila, poi una ogni 2 secondi, per persona. Oltre: `CHAT_TOO_FAST`. Si somma al limite di messaggi della connessione.
- **Niente viene salvato.** Le righe vivono nella memoria dell'attore finché la partita è in corso: non entrano negli eventi della partita, nel DB né sulla catena. Le ultime 30 vanno a chi comincia a guardare.
- **Silenziare:** dal dialogo, *Mute* nasconde quello che scrivono gli altri (le proprie righe restano), finché la partita è sullo schermo.

## Protocollo

| Direzione | Messaggio | Contenuto |
|---|---|---|
| client → server | `game.chat { gameId, text }` | risposta `game.chatted { gameId }`; errori `NOT_FOUND` (`NOT_IN_GAME`) e `CONFLICT` con `details.code` = `GAME_NOT_ACTIVE`, `INVALID_CHAT`, `CHAT_TOO_FAST`, `CHAT_CLOSED`. Lo stesso messaggio per giocatori e spettatori: il server capisce chi scrive dall'utente |
| server → giocatori | `game.chat` | una riga di un giocatore |
| server → spettatori | `watch.chat` | una riga di un giocatore o di uno spettatore |
| server → spettatore | `watch.state` | ha in più `chat`: le ultime righe |

Una riga: `{ "gameId", "from": "player" | "spectator", "seat": "s0" | "s1" | null, "account", "text", "at" }`. Anche chi scrive riceve la propria riga dal server: sullo schermo c'è sempre quello che leggono gli altri.

## Client

- **Il pulsante** è il fumetto accanto al **?** dell'aiuto, sopra il tavolo (al posto del **?** per gli spettatori, che non hanno l'aiuto); il tasto **C** fa lo stesso. Un pallino rosso conta le righe arrivate a chat chiusa (fino a *9+*).
- **Il dialogo** si apre sopra il tavolo, che intanto continua: il titolo, chi legge, il campo e *Send*, sei frasi pronte da mandare con un tocco (*Hello!*, *Good luck!*, *Nice move!*, *Oops!*, *Well played!*, *Thanks!*; per gli spettatori *Wow!*, *Close game!*, *GG* al posto di alcune), poi le righe. Il campo è in alto, così la tastiera del telefono non lo copre. Una riga partita chiude il dialogo, così la si vede comparire nel fumetto; una rifiutata dice perché al posto della riga "chi legge". Le mosse dell'avversario ricostruiscono il dialogo senza perdere quello che si sta scrivendo.
- **I fumetti:** la riga di un giocatore compare accanto al suo posto, in alto per l'avversario e in basso per sé (per uno spettatore: in basso il primo giocatore). Il proprio fumetto dura meno (3,5 s invece di 6) perché copre la mano. Non prendono clic e non si disegnano sopra un dialogo. Le righe degli spettatori non hanno fumetto: vanno nel registro (più tenui) e nel dialogo.
- **Il registro di battaglia** ha due tipi nuovi: `CHAT` (giocatori) e `COMMENT` (spettatori), *@account: testo*.
- **Il campo** accetta lettere, segni, punteggiatura e simboli (emoji comprese): un insieme più largo di quello degli altri campi (`TextField`, `characters: "chat"`).
- Anteprima: `tools/preview/?scene=match&chat=Good luck!|Thanks!` (con `&press=chat.open` il dialogo aperto).

## Minacce

- **Molestie:** *Mute* lato client; niente link cliccabili (il testo è disegnato sul canvas, mai HTML); nessuna riga resta dopo la partita.
- **Spam e sovraccarico:** limite per persona e per riga, una riga va al più a 2 giocatori e 50 spettatori (`MAX_SPECTATORS`).
- **Testo ingannevole:** i caratteri che invertono la direzione o sono invisibili vengono tolti dal server; il client disegna solo testo.
- **Suggerimenti dagli spalti (T11):** gli spettatori non arrivano ai giocatori.
