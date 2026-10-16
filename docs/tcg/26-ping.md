# 26 — Condividere una partita come ping su cur8.fun

A fine partita il giocatore può pubblicare il risultato come **ping** su cur8.fun, il microblog di Steem del progetto: un testo già pronto con i dettagli della partita, un'immagine del risultato, una conferma, la pubblicazione.

## Cos'è un ping

Su cur8.fun (repository `cur8fun`, `config/pings.js` e `services/PingsService.js`):

- ogni giorno l'account **micro.cur8** pubblica un post-"muro" nella community `hive-159863`;
- un ping è un **commento di primo livello sotto l'ultimo muro**, al massimo 280 caratteri;
- il `json_metadata` del commento dice `type: "ping"`, `tags: ["pings", …hashtag]` e `users` (gli account citati).

Un ping pubblicato da KIJAM è quindi un normale commento Steem dell'account del giocatore: compare nel feed Pings di cur8.fun e sul suo profilo.

## Cosa si condivide

- Solo le **partite online** giocate dal giocatore connesso: casual, classificate e Sfide. Non le partite contro l'IA nel browser, il tutorial, le partite guardate da spettatore.
- Il pulsante **Share** è nel riquadro del risultato (con *Play again* e *Back to menu*; un clic fuori dal riquadro mostra il tavolo, e *See result* nella colonna delle azioni lo riapre). Apre un dialogo con l'immagine e il ping affiancati, com'è, *Back* e *Post ping*. Pubblicato, il pulsante diventa *Shared* e non si ripete.
- Il testo (`application/social/pingText.js`) dice chi ha vinto, contro chi e in che tipo di partita, poi i dettagli (turni, vita finale di entrambi, il percorso per le Sfide), dove giocare e gli hashtag:
  - *I won a ranked game against @bob on KIJAM! 🏆* / *⚔️ 12 turns · ❤️ 14 vs 0*
  - *I beat The Gravelord, today's boss, in KIJAM's Challenges! 🏆* / *⚔️ 15 turns · ❤️ 7 vs 0 · Hard*
  - seguito da *Play: <indirizzo del gioco>* e *#kijam #tcg*.
- **L'immagine** (`application/social/shareCard.js` i dati, `rendering/share/ShareCard.js` il disegno): 1200 × 630, il formato dei feed. *KIJAM* e il tipo di partita (*Ranked game*, *Challenges · Hard · Boss*), l'esito grande (*VICTORY*, *DEFEAT*, *DRAW*), i due giocatori faccia a faccia con la foto del profilo e la vita finale, i turni, *Play at …* e *#kijam*. I personaggi delle Sfide hanno il loro ritratto dipinto. Il dialogo mostra lo stesso disegno in piccolo.
- **Le foto del profilo** vengono da steemitimages.com, che non permette ad altri siti di usarle in un canvas da salvare (nessun `Access-Control-Allow-Origin`): il browser le mostrerebbe, ma l'immagine non si potrebbe più salvare. Per l'immagine da pubblicare passano quindi dal nostro server (`GET /api/pings/avatars/:account`, `AvatarProxy` + `SteemitAvatars`), che le restituisce come data URL: solo nomi account validi, solo steemitimages, solo immagini fino a 512 KB, tenute 10 minuti (al massimo 200). Senza foto, o se arriva dopo 4 secondi, resta l'iniziale.
- L'immagine si disegna nel browser (`CanvasShareImage`, JPEG), il server la carica sul servizio di immagini che usa cur8.fun (imridd, `free_upload_image`) e il ping la mostra (`![](…)` nel testo, `image` nei metadati).
- L'avversario umano è citato (`@bob`, riceve la notifica); un personaggio delle Sfide è chiamato per nome, mai con l'account `ai_…`.

## Come si pubblica

Con il metodo del login, come tutto il resto (20):

- **Keychain**: `requestPost` dell'estensione, che mostra il commento e lo firma con la posting key.
- **Posting key nel browser**: il client firma l'operazione `comment` (`LocalKeyWallet.postComment`) e il server la inoltra alla catena, come fa con i trasferimenti. La active key non serve.

Il pacchetto `@magic8/steem` serializza ora anche l'operazione `comment` (id 1); i byte sono verificati contro steem-js 0.7.11 (`test/transactions.test.js`).

## Sul server

Modulo `pings`, attivo se `M8_PINGS_WALL` non è vuoto (predefinito `micro.cur8`):

- `GET /api/pings/wall` → l'ultimo muro `{ author, permlink, images }`, letto con `bridge.get_account_posts` (`SteemPingWall`) e tenuto un minuto; 404 se il muro non c'è. `images` dice se il server carica le immagini.
- `POST /api/pings/images { image }` → carica l'immagine (base64 di un JPEG o PNG, al massimo 400 KB) sul servizio di immagini (`ImriddImageHost`, `M8_PING_IMAGE_HOST`, predefinito quello di cur8.fun; vuoto: ping senza immagine) e risponde il suo indirizzo https. Limite: 5, poi una al minuto; ogni caricamento nell'audit (`pings.image_uploaded`).
- `POST /api/pings { transaction }` → inoltra un ping firmato con la posting key. Il server **non è un relay aperto**: accetta un solo commento, dell'account connesso, sotto uno degli ultimi due muri (quello di ieri copre il cambio di giorno), con un corpo di al massimo 1600 byte. Limite: 5 ping, poi uno al minuto.
- Ogni relay finisce nell'audit (`pings.relayed` / `pings.refused`).

## Limiti di questa prima versione

- Il testo non si modifica prima di pubblicarlo.
- Il link porta al gioco, non alla partita (non c'è ancora un indirizzo pubblico per il replay).
- Se l'immagine non si riesce a fare o a caricare, il ping non parte e il dialogo lo dice (si può riprovare).
- Anteprime: `tools/preview/?scene=match&share=1` (il dialogo) e `?scene=sharecard` (l'immagine com'è salvata).
- Sulla testnet o senza muro il dialogo lo dice al momento di pubblicare.
