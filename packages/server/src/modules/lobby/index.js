/**
 * Lobby module (LobbyService): who is online, and challenges between them
 * that start a game without the queue. Other modules use only what is
 * exported here.
 */
export { ChallengeEnd, ChallengeMode, DEFAULT_LOBBY_POLICY, LobbyService, PlayerActivity } from "./application/LobbyService.js";
export { registerLobbyMessages } from "./ws/lobbyMessages.js";
