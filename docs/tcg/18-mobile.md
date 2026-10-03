# 18 — Giocare da telefono

**Stato:** 2026-10-03.
- **Client:** profilo di layout `compact` nel `Viewport`, tutte le schermate e la partita ridisegnate per un telefono in orizzontale, input touch (niente hover, scroll con inerzia, tastiera del telefono per i campi di testo), carte "mini" sulla board, conferma prima di giocare una carta, illustrazioni ridotte e caricate su richiesta.
- **Non ancora:** versione verticale, varianti leggere dei file delle illustrazioni. Il login con posting key, senza Keychain, è nel doc 20.

## Decisioni

| Decisione | Perché |
|---|---|
| Su telefono si gioca **solo in orizzontale**: il manifest chiede `landscape` e in verticale un avviso HTML chiede di ruotare. | La board ha i due campi uno sopra l'altro con HUD e azioni ai lati: in verticale andrebbe ripensata da zero. |
| Dispositivo minimo: **iPhone SE** (667×375 px CSS). | Il più piccolo ancora diffuso; i test di layout lo usano come riferimento. |
| Su telefono una carta della mano si **sceglie** con un tocco (si ingrandisce) e si gioca con **Play**. | Carte piccole sotto il dito: un tocco sbagliato non deve giocare una carta. |
| Il desktop non cambia: il profilo `wide` produce gli stessi rettangoli di prima. | I test esistenti lo garantiscono (nessuno è stato modificato nei valori attesi del desktop). |

## Il profilo `compact`

Prima il gioco disegnava ogni schermata in uno spazio fisso di 1600×900 unità, rimpicciolito per entrare nello schermo: su un telefono il testo usciva a ~8 px e i bottoni a ~20 px. Adesso il `Viewport` sceglie uno di due profili:

- **`wide`**: lo spazio 1600×900 di sempre, quando la scala che serve è almeno 0,6 (desktop, tablet).
- **`compact`**: lo spazio di progetto è alto **400 unità** e largo fra 760 e 1100, come permette lo schermo. Su un iPhone 14 in orizzontale 1 unità ≈ 1 px CSS: i token del tema (body 20, small 15…) restano leggibili senza cambiarli.

Il `Viewport` tiene conto anche della **safe area** (notch, indicatore home): lo spazio di progetto ne resta fuori, `bounds` la copre ancora (lo sfondo arriva ai bordi) e `safeBounds` è l'area sicura dove la board mette HUD e azioni. Su compact la densità di pixel è limitata a 2.

Le scene si ridispongono (`Scene.relayout`) solo quando cambia lo spazio di progetto (profilo o larghezza compact), non a ogni resize.

## Le schermate

- **Header e colonne condivise** (`deckBuilder/layout.js` → `screenLayout(viewport)`): su compact header alto 56 con bottoni da 48, due colonne affiancate, pannelli con angoli decorati piccoli (`Panel.smallCorners`), "Menu" al posto di "Back to menu".
- **Filtri delle carte**: su compact un solo bottone "Filter: …" che apre la barra completa in un dialogo; la scelta si applica con **Done**.
- **Righe di carte** (`CardStrip`): se il nome non ha spazio, attacco/vita e numero di copie passano nel sottotitolo. Dove non c'è posto per "Info"/"View", è la striscia stessa (`Hotspot`) ad aprire la carta.
- **Bottoni**: un'etichetta che non entra nelle placche decorate usa il bottone disegnato; poi il font piccolo; solo dopo i puntini.
- **Modali** (ispezione, info carta, carrello, rivelazione dei pacchetti, filtri, conferme) dimensionati per stare in 400 unità.
- **Toast**: nell'area sicura, al massimo metà larghezza, i due più recenti.

## La partita

`computeBoardLayout(…, { compact: true })`:

- HUD a sinistra (larghi 156, l'interno scala con la piastra: `lifeCrystalCentre`/`hudStackCentre` restano coerenti con gli effetti);
- colonna azioni a destra (150) con turno, fase, suggerimento, bottoni e in fondo **Log** (il registro si apre in un modale) e **Concede**;
- campi al centro con carte 76×106, mano in basso con carte 80×112, mano avversaria che spunta dal bordo alto;
- carte disegnate con il profilo **MINI** di `CardFace`: nome, costo e statistiche più grandi, solo le keyword nel riquadro del testo. Il testo completo si legge con il long-press (ispezione) o nell'anteprima della carta scelta;
- il lancio della moneta e la scritta di fine partita si rimpiccioliscono per stare nell'area sicura.

## Input touch

- `InputManager` passa `pointerType` e ignora i tocchi non primari (un secondo dito non preme e non scorre nulla).
- Dopo un tocco non resta nessun hover; il dito non sposta il focus da tastiera (e quindi niente anello di focus), tranne sui campi di testo.
- Le liste trascinate continuano a scorrere con inerzia.
- **Campi di testo**: un canvas non apre la tastiera del telefono. Un tocco su un `TextField` apre `TextEntryBar`, una striscia HTML in alto (sopra la tastiera) con un `<input>` vero; il valore torna al campo filtrato dalle stesse regole. `keyboard: "account"` (niente maiuscole automatiche) per i nomi STEEM, `"decimal"` per i prezzi.
- Le scorciatoie da tastiera non vengono nominate su telefono ("End turn" invece di "End turn (E)").

## Memoria e rete

Le 93 illustrazioni sono 1344×768: tutte decodificate occupano ~384 MB, più di quanto un browser mobile concede a una pagina. Su un dispositivo touch:

- vengono decodificate e **ridotte a 512 px** di larghezza (`scaledImageLoader`, ~56 MB per tutte);
- **non vengono precaricate** all'avvio: ogni illustrazione si scarica quando la sua carta compare (il service worker la tiene poi in cache).

Resta da fare: servire file più leggeri (es. WebP a 512 px) ai telefoni, per non scaricare 32 MB di originali.

## Test

- `test/rendering/compactLayouts.test.js`: ogni schermata su iPhone SE e iPhone 14 — ogni controllo dentro lo schermo (o nella sua lista), alto almeno 40 px CSS, nessuna sovrapposizione.
- `test/rendering/mobile.test.js`: board compact, scelta e conferma di una carta, ispezione con long-press, ri-layout da desktop a telefono, input touch (hover, focus, inerzia, tastiera del telefono).
- `test/rendering/canvas.test.js`: profili del `Viewport`, safe area, limite di densità.
