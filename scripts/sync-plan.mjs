/**
 * Pure planning for appearance synchronization. These functions build the plain
 * update objects Foundry expects, without performing any I/O — so the "what do we
 * write" decisions are unit-testable, while sync-service.mjs handles the "how".
 */

import { activeField } from "./slots.mjs";

/** Build the fields shared by placed and prototype token updates. */
export function buildAppearanceUpdate(artMode, { src, name }) {
  const update = {};
  if (src !== undefined) update[activeField(artMode)] = src;
  if (name !== undefined) update.name = name;
  return update;
}

/**
 * A single placed-token update object.
 * @param {string} tokenId
 * @param {string} artMode
 * @param {{src?:string|null, name?:string}} appearance
 */
export function buildTokenUpdate(tokenId, artMode, appearance) {
  return { _id: tokenId, ...buildAppearanceUpdate(artMode, appearance) };
}

/**
 * The prototype-token update object (Actor#update payload).
 * @param {string} artMode
 * @param {{src?:string|null, name?:string}} appearance
 */
export function buildPrototypeUpdate(artMode, appearance) {
  const fields = Object.entries(buildAppearanceUpdate(artMode, appearance));
  return Object.fromEntries(fields.map(([field, value]) => [`prototypeToken.${field}`, value]));
}

/**
 * Group per-token updates by scene id.
 * @param {Array<{id:string, sceneId:string}>} tokens
 * @param {string} artMode
 * @param {{src:string, name?:string}} appearance
 * @returns {Map<string, object[]>}  sceneId -> token update objects
 */
export function planSceneUpdates(tokens, artMode, appearance) {
  return planRollback((tokens ?? []).map((tk) => tk && { ...tk, ...appearance }), artMode);
}

/**
 * Build the scene updates that restore a captured snapshot (rollback).
 * @param {Array<{id:string, sceneId:string, src?:string|null, name?:string}>} snapshotTokens
 * @param {string} artMode
 * @returns {Map<string, object[]>}
 */
export function planRollback(snapshotTokens, artMode) {
  const bySceneId = new Map();
  for (const tk of snapshotTokens ?? []) {
    if (!tk || tk.sceneId == null) continue;
    if (!bySceneId.has(tk.sceneId)) bySceneId.set(tk.sceneId, []);
    bySceneId.get(tk.sceneId).push(buildTokenUpdate(tk.id, artMode, tk));
  }
  return bySceneId;
}
