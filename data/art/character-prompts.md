# Prompt per i ritratti dei personaggi (Sfide)

Un prompt per ogni personaggio e boss delle Sfide (`data/daily/characters.json`), nello stesso stile delle carte. La palette è quella della fazione nel tema (`data/ui/theme.json`).

Promemoria:
- Formato orizzontale 7:4 (1344 × 768), come le carte. Il ritratto riempie la parte alta della scheda dell'avversario e viene ritagliato: su schermo largo resta quasi tutto, sul telefono solo una striscia (il riquadro a sinistra del nome).
- **Il volto nella metà alta e al centro**: il nome è scritto sulla fascia bassa dell'immagine. Se il volto è altrove, sposta `focus` (per esempio `[0.5, 0.3]`).
- Mezzo busto, sguardo verso chi guarda: è l'avversario che ti sfida.
- Sfondo scuro e pulito ai bordi: sopra si muovono le particelle della fazione (scintille, foglie, nebbia…).
- Salva il file come `character_<id>.jpg` (per esempio `character_kael.jpg`) e aggiungi la riga in `characters.json`:

```json
{
  "schemaVersion": 1,
  "characters": {
    "kael": { "file": "character_kael.jpg", "focus": [0.5, 0.35] }
  }
}
```

Un personaggio senza ritratto mostra il medaglione con la sua iniziale.

## Personaggi

### Kael, First into the Fire (`kael`) — Ember
```
background color: red-black-orange
half-body portrait of a young impatient soldier in scorched red-black armour, short spiky hair, a cocky grin, sword resting on his shoulder, embers drifting around him, looking straight at the viewer, face in the upper middle of the frame

style : anime ritual
no text
```

### Sira, The Spark Dancer (`sira`) — Ember
```
background color: red-black-orange
half-body portrait of a cheerful pyromancer girl mid-twirl, wild orange hair like flames, mischievous smile, fireworks of sparks bursting from her open palms, looking at the viewer, face in the upper middle of the frame

style : anime ritual
no text
```

### Master Brunn, Master of the Forge (`brunn`) — Iron
```
background color: steel blue-navy-silver
half-body portrait of a grumpy old dwarf-like smith, thick grey beard braided with steel rings, leather apron, heavy hammer in hand, sparks from an anvil behind him, frowning at the viewer, face in the upper middle of the frame

style : anime ritual
no text
```

### Captain Varek, Keeper of the Line (`varek`) — Iron
```
background color: steel blue-navy-silver
half-body portrait of a stern legion captain in polished steel plate, tower shield with a navy crest, plumed helmet under his arm, scar across the cheek, rigid posture, looking at the viewer, face in the upper middle of the frame

style : anime ritual
no text
```

### Morwen, The Reaper of Graves (`morwen`) — Shadow
```
background color: purple-black-lilac
half-body portrait of a gentle and unsettling gravedigger woman, pale skin, long dark hair, lilac eyes, a soft smile, holding a tall scythe like a garden tool, wisps of violet mist and grave flowers around her, looking at the viewer, face in the upper middle of the frame

style : anime ritual
no text
```

### The Notary (`notary`) — Shadow
```
background color: purple-black-lilac
half-body portrait of a polite soul merchant in an elegant black frock coat and top hat, monocle glowing lilac, offering a parchment contract and a quill, a thin courteous smile, shadows coiling behind him, looking at the viewer, face in the upper middle of the frame

style : anime ritual
no text
```

### Elda, Hermit of the Grove (`elda`) — Verdant
```
background color: green-dark green-lime
half-body portrait of a patient old hermit woman, silver hair woven with leaves and moss, wooden staff sprouting buds, a calm knowing gaze, fireflies and drifting leaves around her, looking at the viewer, face in the upper middle of the frame

style : anime ritual
no text
```

### Rook, Tracker of the Deep Woods (`rook`) — Verdant
```
background color: green-dark green-lime
half-body portrait of a silent hunter in a hooded green cloak, bow drawn halfway, eyes sharp beneath the hood, war paint across the cheeks, a wolf's shadow behind him, looking at the viewer, face in the upper middle of the frame

style : anime ritual
no text
```

### Magistra Ilyra, First Chair of the Conclave (`ilyra`) — Arcane
```
background color: blue-indigo-cyan
half-body portrait of a haughty scholar mage in indigo robes with cyan runes, glasses, an open floating spellbook, one eyebrow raised in disdain, glowing glyphs orbiting her, looking at the viewer, face in the upper middle of the frame

style : anime ritual
no text
```

### Thessaly, Warden of the Spire (`thessaly`) — Arcane
```
background color: blue-indigo-cyan
half-body portrait of a weary guardian woman in blue-silver armour, a long spear with a crystal head, tired eyes that have seen many fall, a tower of light behind her, looking at the viewer, face in the upper middle of the frame

style : anime ritual
no text
```

## Boss

### The Volcanic Wyrm, Heart of the Mountain (`volcanic_wyrm`) — Ember
```
background color: red-black-orange
the head and neck of a colossal volcanic dragon rising from a lava lake, cracked obsidian scales glowing from within, molten eyes staring at the viewer, smoke and falling ash, head in the upper middle of the frame

style : anime ritual
no text
```

### The Iron Colossus, First Engine of the Foundry (`iron_colossus`) — Iron
```
background color: steel blue-navy-silver
the torso and head of a gigantic ancient iron automaton, riveted plates, a single glowing blue eye staring at the viewer, steam venting from its shoulders, gears turning in its chest, head in the upper middle of the frame

style : anime ritual
no text
```

### The Gravelord, King Beneath (`gravelord`) — Shadow
```
background color: purple-black-lilac
half-body portrait of an undead king on a throne of bones, tattered royal robes, a crown of black iron, lilac fire in his empty eye sockets, one skeletal hand reaching to the viewer, head in the upper middle of the frame

style : anime ritual
no text
```

### The Worldroot, Oldest of the Forest (`worldroot`) — Verdant
```
background color: green-dark green-lime
an immense ancient tree spirit with a face formed in its bark, eyes of soft lime light half open, roots and branches spreading across the frame, spores and leaves drifting, face in the upper middle of the frame

style : anime ritual
no text
```

### The Archmage, Master of the Spire (`archmage`) — Arcane
```
background color: blue-indigo-cyan
half-body portrait of an arrogant ancient archmage floating at the top of a tower, long white beard, star-embroidered indigo robes, a staff crowned with a cyan crystal, arcane circles turning behind him, looking down at the viewer, face in the upper middle of the frame

style : anime ritual
no text
```
