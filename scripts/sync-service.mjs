/**
 * Applies an appearance to every linked token (across all scenes) and the actor's
 * prototype token, with best-effort rollback of artwork and any configured name.
 */

import { appearanceUpdateOptions } from "./animation.mjs";
import { INTERNAL_OPTION, error } from "./constants.mjs";
import { getActorConfig } from "./config-repository.mjs";
import { activeField, currentArtSrc, resolveActiveSlot } from "./slots.mjs";
import { samePath } from "./paths.mjs";
import { buildAppearanceUpdate, buildPrototypeUpdate, planRollback, planSceneUpdates } from "./sync-plan.mjs";

function configuredAppearance(config, slot) {
  const { src, name } = config[slot] ?? {};
  if (!src) throw new Error(`target slot "${slot}" has no image`);
  return { src, name: typeof name === "string" ? name.trim() || undefined : undefined };
}

function snapshotAppearance(token, field, rename) {
  const source = token._source ?? token;
  return {
    src: foundry.utils.getProperty(source, field),
    name: rename ? source.name : undefined,
  };
}

/**
 * Switch an actor to the given slot everywhere.
 * @param {Actor} actor
 * @param {object} config  the actor's configuration
 * @param {"a"|"b"} slot
 */
export async function synchronizeAppearance(actor, config, slot) {
  const artMode = config.artMode;
  const field = activeField(artMode);
  const appearance = configuredAppearance(config, slot);
  const rename = appearance.name !== undefined;

  // Keep only tokens that still exist in their scene: a stale dependent-token
  // entry (deleted token) would make the whole batch update reject.
  const tokenDocs = (actor.getDependentTokens({ linked: true }) ?? []).filter(
    (td) => td?.parent?.id && (td.parent.tokens?.has(td.id) ?? true),
  );

  // Snapshot current values for rollback.
  const snapshot = {
    prototype: snapshotAppearance(actor.prototypeToken, field, rename),
    tokens: tokenDocs.map((td) => ({
      id: td.id,
      sceneId: td.parent.id,
      ...snapshotAppearance(td, field, rename),
    })),
  };

  const sceneUpdates = planSceneUpdates(
    tokenDocs.map((td) => ({ id: td.id, sceneId: td.parent.id })),
    artMode,
    appearance,
  );

  try {
    for (const [sceneId, updates] of sceneUpdates) {
      const scene = game.scenes.get(sceneId);
      if (scene && updates.length) {
        await scene.updateEmbeddedDocuments("Token", updates, appearanceUpdateOptions());
      }
    }
    await actor.update(buildPrototypeUpdate(artMode, appearance), { [INTERNAL_OPTION]: true });
  } catch (err) {
    await rollbackAppearance(actor, snapshot, artMode);
    throw err;
  }
}

async function rollbackAppearance(actor, snapshot, artMode) {
  for (const [sceneId, updates] of planRollback(snapshot.tokens, artMode)) {
    try {
      const scene = game.scenes.get(sceneId);
      if (scene && updates.length) {
        await scene.updateEmbeddedDocuments("Token", updates, appearanceUpdateOptions({ animate: false }));
      }
    } catch (err) {
      error("rollback failed", err);
    }
  }
  try {
    const update = buildPrototypeUpdate(artMode, snapshot.prototype);
    if (Object.keys(update).length) await actor.update(update, { [INTERNAL_OPTION]: true });
  } catch (err) {
    error("rollback failed", err);
  }
}

/**
 * Switch a single (unlinked) placed token to the given slot. Each unlinked token
 * is independent, so only this token document changes — not the prototype or any
 * sibling tokens. Best-effort rollback on failure.
 * @param {TokenDocument} tokenDoc
 * @param {object} config
 * @param {"a"|"b"} slot
 */
export async function switchSingleToken(tokenDoc, config, slot) {
  const { artMode } = config;
  const appearance = configuredAppearance(config, slot);
  if (tokenDoc?.parent && !(tokenDoc.parent.tokens?.has(tokenDoc.id) ?? true)) {
    throw new Error(`token "${tokenDoc.name ?? tokenDoc.id}" no longer exists on its scene`);
  }

  const previous = snapshotAppearance(tokenDoc, activeField(artMode), appearance.name !== undefined);
  try {
    await tokenDoc.update(buildAppearanceUpdate(artMode, appearance), appearanceUpdateOptions());
  } catch (err) {
    const update = buildAppearanceUpdate(artMode, previous);
    if (Object.keys(update).length) {
      await tokenDoc.update(update, appearanceUpdateOptions({ animate: false }))
        .catch((rollbackError) => error("rollback failed", rollbackError));
    }
    throw err;
  }
}

/**
 * Bring a freshly-created linked token in line with the actor's active slot.
 * Called on the authoritative GM from the `createToken` hook. The prototype update
 * normally covers future tokens; this is belt-and-braces reconciliation.
 * @param {TokenDocument} tokenDoc
 */
export async function reconcileToken(tokenDoc) {
  const actor = tokenDoc?.actor;
  if (!actor || !tokenDoc.isLinked) return;

  const config = getActorConfig(actor.id);
  if (!config?.enabled || !config.a?.src || !config.b?.src) return;

  const activeSrc = currentArtSrc(actor.prototypeToken, config.artMode);
  const slot = resolveActiveSlot(activeSrc, config);
  if (!slot) return; // out of sync — don't guess

  const { src, name } = configuredAppearance(config, slot);
  const update = buildAppearanceUpdate(config.artMode, {
    src: samePath(currentArtSrc(tokenDoc, config.artMode), src) ? undefined : src,
    name: tokenDoc.name === name ? undefined : name,
  });

  if (Object.keys(update).length) await tokenDoc.update(update, appearanceUpdateOptions({ animate: false }));
}
