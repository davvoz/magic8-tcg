/** Zones a card can occupy. Each player owns one zone of each type. */
export const ZoneType = Object.freeze({
  LIBRARY: "library",
  HAND: "hand",
  BATTLEFIELD: "battlefield",
  GRAVEYARD: "graveyard",
});

export const ZONE_TYPES = Object.freeze(Object.values(ZoneType));
