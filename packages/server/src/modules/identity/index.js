/**
 * Identity module: sign-in with a wallet signature, sessions, revocation.
 * Other modules use only what is exported here.
 */
export { AuthService, hashToken } from "./application/AuthService.js";
export { SessionKeyAuditor } from "./application/SessionKeyAuditor.js";
export { DEFAULT_IDENTITY_POLICY, identityPolicy } from "./domain/policies.js";
export { RevokeReason } from "./domain/Session.js";
export { PgChallengeRepository, PgSessionRepository, PgUserRepository } from "./infrastructure/PgIdentityRepositories.js";
export { publicUser, registerIdentityRoutes } from "./http/identityRoutes.js";
