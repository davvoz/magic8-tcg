/**
 * Onboarding module: what a new player receives (the free starter deck).
 * Orchestrates the collection and decks modules through their public APIs.
 */
export { StarterService, starterGrantKey } from "./application/StarterService.js";
export { validateStarterOffer } from "./domain/StarterOffer.js";
export { registerStarterRoutes } from "./http/starterRoutes.js";
