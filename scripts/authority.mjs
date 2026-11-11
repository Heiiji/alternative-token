/**
 * GM authority. When several GMs are connected, exactly one must process relayed
 * requests to avoid duplicate updates. Foundry core already elects one, identically
 * on every client (`game.users.activeGM`: highest role, then lowest id).
 */

/** Id of the current primary active GM (or null). */
export function getPrimaryActiveGMId() {
  return game.users.activeGM?.id ?? null;
}

/** Is *this* client the authoritative GM? */
export function isPrimaryActiveGM() {
  return !!game.users.activeGM?.isSelf;
}
