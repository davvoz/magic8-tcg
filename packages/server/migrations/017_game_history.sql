-- A player's game history is looked up by account (public, like the leaderboard), newest game first.
CREATE INDEX game_players_account ON game_players (account, game_id DESC);
