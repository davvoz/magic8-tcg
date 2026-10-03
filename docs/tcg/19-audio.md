# 19 — Suoni e musica

**Stato:** 2026-10-03.
- **Client:** effetti sonori sintetizzati nel browser (Web Audio API, nessun file), musica di sottofondo in loop da `data/audio/`, impostazioni (musica, effetti, muto) salvate nel browser, tasto **M** per il muto ovunque.
- **Server:** serve anche `.mp3` e `.ogg` (limite di 5 MB per file, come per ogni file statico).

## Decisioni

| Decisione | Perché |
|---|---|
| Gli effetti sono **sintetizzati**, non file audio. | Niente da scaricare, nessuna licenza, ogni ripetizione leggermente diversa (pitch e rumore variano), volume e timbro regolabili dal codice. |
| Il gioco chiede **cue semantici** (`SoundCue.CARD_PLACE`), mai "un suono". | Le scene dicono *cosa è successo*; *come suona* è dell'adattatore. Cambiare un suono non tocca le scene. |
| I suoni della partita seguono **l'animazione**, non l'evento. | Un colpo si sente quando l'affondo arriva, un incantesimo quando i raggi colpiscono, la carta quando atterra nello slot. |
| La musica è decodificata intera in un `AudioBuffer`. | Loop senza stacco (un `<audio>` salta alla giunzione) e passa dal service worker (nessuna richiesta `Range`). |
| L'audio parte al **primo gesto** del giocatore. | I browser non permettono altro; prima di allora i cue sono scartati e la musica aspetta. |

## Architettura

```
application/audio/      SoundCue (cue e MusicTrack), AudioSettings (value object), AudioService (caso d'uso)
application/ports/      AudioOutput (play, playMusic, setLevels), AudioPreferences (load, save)
infrastructure/audio/   WebAudioOutput (grafo e voci), MusicPlayer, SoundBank + registerCorePatches,
                        patches/* (una famiglia per file), synth/ (Voice, NoiseBank, RoomReverb, notes),
                        NullAudioOutput (test), browserAudio (sblocco al gesto, visibilità della pagina)
infrastructure/persistence/StoredAudioPreferences
rendering/board/MatchSoundscape   i suoni della partita, al passo con la board
rendering/audio/        MusicDirector (musica per scena), serviceSounds (shop, mercato, partita trovata)
rendering/scenes/audioSettings    il dialogo Sound (dal menu principale)
```

- **Widget:** ogni `UiNode` ha un `activationCue`; la `Scene` lo suona quando il nodo viene attivato (click, tap, Invio) e solo se è attivabile. `Button` ne ha uno per variante (primary → conferma, secondary → tick, danger → colpo sordo), sovrascrivibile con `cue`.
- **Partita:** `MatchSoundscape.beat` suona gli eventi di ogni beat con il ritardo della loro animazione (`MatchPresenter.landsAfter` per i colpi in combattimento); `follow` segue fotogramma per fotogramma i momenti sul tavolo (lancio, colpo dell'incantesimo, rune, banner del turno, mirino dello scarto casuale), la moneta iniziale e la fine della partita.
- **Mix:** voci → bus effetti (+ riverbero di una piccola sala, quanto ne chiede il patch) → master → limiter; musica → livello musica → *duck* → master. Le fanfare (vittoria, sconfitta, partita trovata, carte ricevute) abbassano la musica per un momento.
- **Anti-rumore:** lo stesso cue non riparte prima di un intervallo minimo (`CUE_MIN_GAP_MS`), le voci simultanee sono al massimo 28.

## Aggiungere un suono

1. Un nuovo valore in `SoundCue`.
2. Un patch (`{ cue, render(voice), space?, vary?, duck? }`) nella famiglia giusta in `infrastructure/audio/patches/`.
3. Il cue suonato dove serve (`services.sound?.play(cue)` in una scena, `activationCue` su un widget, una voce in `MatchSoundscape`).

Il test `SoundBank` fallisce se un cue non ha patch; il test dei patch li suona tutti su un `AudioContext` finto.

## Musica

File in `data/audio/`, elencati in `main.js` (`MUSIC_FILES`): oggi **`background_music.mp3`** sia per i menu sia per la partita (stesso file = la musica continua senza ripartire). Per una traccia diversa in partita basta un secondo file e una riga in `MUSIC_FILES`.

Requisiti: MP3 (o OGG), al massimo **5 MB** (128–192 kbps, 2–4 minuti), pensato per il loop (fine che si raccorda all'inizio, senza silenzi in testa o in coda), masterizzato senza clipping. Se il file manca il gioco suona lo stesso, senza musica (un avviso nel log).
