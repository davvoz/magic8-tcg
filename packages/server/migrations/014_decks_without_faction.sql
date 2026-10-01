-- A deck has no faction any more: any card may go in any deck, and what a deck is made of is shown from
-- its cards (the faction mix), never stored.
ALTER TABLE decks DROP COLUMN faction;
