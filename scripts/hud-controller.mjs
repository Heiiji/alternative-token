/**
 * Injects Token HUD controls:
 *  - a GM-only *edit* button (configure this token's two images), shown whenever the
 *    token has a world actor, regardless of config state;
 *  - a *switch* button for owners, shown only when a config is enabled with both images.
 */

import { t, error, withErrorDetail } from "./constants.mjs";
import { getActorConfig, setActorConfig } from "./config-repository.mjs";
import { getPrimaryActiveGMId } from "./authority.mjs";
import { currentArtSrc, otherSlot, resolveActiveSlot } from "./slots.mjs";
import { samePath } from "./paths.mjs";
import { requestAppearanceChange } from "./request-service.mjs";
import { promptAdoptSlot, promptSlotChoice } from "./dialog.mjs";
import { AtfConfigApp } from "./config-app.mjs";

/**
 * `renderTokenHUD` handler. In V13/V14 `element` is a native HTMLElement.
 * @param {Application} hud
 * @param {HTMLElement} element
 */
export function onRenderTokenHUD(hud, element) {
  const token = hud?.object;
  const actor = token?.actor;
  const tokenDoc = token?.document;
  if (!actor || !tokenDoc) return;

  const column =
    element.querySelector(".col.right") ||
    element.querySelector(".col.left") ||
    element.querySelector(".right") ||
    element.querySelector(".left") ||
    element;

  // GM edit button — lets the GM configure the two images straight from the table.
  // Requires a real world actor to key the (GM-only) config on.
  if (game.user.isGM && game.actors.has(actor.id)) {
    column.appendChild(buildEditButton(actor.id));
  }

  // Switch button — owners only, and only when fully configured.
  if (!actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) return;

  const config = getActorConfig(actor.id);
  if (!config?.enabled || !config.a?.src || !config.b?.src) return;

  // Source of truth: the prototype for linked tokens (character-level), the token
  // itself for unlinked tokens (each unlinked token is independent).
  const artSource = tokenDoc.isLinked ? actor.prototypeToken : tokenDoc;
  const activeSrc = currentArtSrc(artSource, config.artMode);
  const active = resolveActiveSlot(activeSrc, config);
  const target = active ? otherSlot(active) : null;

  const button = buildButton(config, active, target);
  column.appendChild(button);

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    if (button.classList.contains("atf-disabled")) return;
    if (button.classList.contains("atf-processing")) return;

    // Recompute from live state: the HUD does not re-render on token art
    // changes, so slot data captured at render time can be stale after a
    // switch — acting on it would silently re-apply the showing slot.
    const liveConfig = getActorConfig(actor.id);
    if (!liveConfig?.enabled || !liveConfig.a?.src || !liveConfig.b?.src) return;
    const liveSource = tokenDoc.isLinked ? actor.prototypeToken : tokenDoc;
    const liveActive = resolveActiveSlot(currentArtSrc(liveSource, liveConfig.artMode), liveConfig);

    let slot = liveActive ? otherSlot(liveActive) : null;
    if (!liveActive) {
      if (game.user.isGM) {
        slot = await promptAdoptSlot(liveConfig);
        if (!slot) return;
        const adopted = await adoptCurrentAppearance(actor, tokenDoc, liveConfig, slot);
        if (adopted) hud.render?.();
        return;
      }
      slot = await promptSlotChoice(liveConfig);
      if (!slot) return;
    }
    // The HUD refreshes itself from the update hooks in main.mjs.
    await doSwitch(actor, slot, button, tokenDoc.uuid);
  });
}

/** A Token HUD control shaped like core's own (`button.control-icon`). */
function hudButton(cssClass, iconClass, tooltip) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("control-icon", cssClass);
  button.innerHTML = `<i class="${iconClass} fa-fw" inert></i>`;
  button.dataset.tooltip = tooltip;
  button.ariaLabel = tooltip;
  return button;
}

function buildEditButton(actorId) {
  const button = hudButton("atf-edit", "fa-solid fa-pen-to-square", t("ATF.hud.editImages"));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    AtfConfigApp.openForActor(actorId);
  });
  return button;
}

function buildButton(config, active, target) {
  const noGM = getPrimaryActiveGMId() == null;
  let tooltip;
  if (noGM) tooltip = t("ATF.hud.noGM");
  else if (active) tooltip = t("ATF.hud.switchTo", { label: config[target].label });
  else tooltip = game.user.isGM ? t("ATF.hud.outOfSyncGm") : t("ATF.hud.outOfSync");

  const button = hudButton(
    "atf-switch",
    active ? "fa-solid fa-masks-theater" : "fa-solid fa-triangle-exclamation",
    tooltip,
  );
  if (!active) button.classList.add("atf-warn");
  if (noGM) button.classList.add("atf-disabled");
  return button;
}

/**
 * Write the currently showing image into a slot. Does not switch the token —
 * it is already displaying that art.
 * @returns {Promise<boolean>}
 */
async function adoptCurrentAppearance(actor, tokenDoc, config, slot) {
  const artSource = tokenDoc.isLinked ? actor.prototypeToken : tokenDoc;
  const src = currentArtSrc(artSource, config.artMode).trim();
  if (!src) {
    ui.notifications?.warn(t("ATF.errors.noImage"));
    return false;
  }

  const next = {
    ...config,
    [slot]: { label: config[slot]?.label ?? "", src },
  };
  if (samePath(next.a?.src, next.b?.src)) {
    ui.notifications?.error(t("ATF.errors.imagesMustDiffer"));
    return false;
  }

  try {
    await setActorConfig(actor.id, next);
    ui.notifications?.info(t("ATF.notify.adopted", { label: next[slot].label || slot }));
    return true;
  } catch (err) {
    error(err);
    ui.notifications?.error(withErrorDetail(t("ATF.errors.syncFailed"), err));
    return false;
  }
}

async function doSwitch(actor, slot, button, tokenUuid) {
  const icon = button.querySelector("i");
  const prevIcon = icon?.className;
  button.classList.add("atf-processing");
  if (icon) icon.className = "fa-solid fa-spinner fa-spin fa-fw";

  try {
    const result = await requestAppearanceChange(actor, slot, tokenUuid);
    // GM fast-path returns a result directly; relayed requests notify via flag.
    if (result && !result.success) {
      ui.notifications?.warn(t(result.message ?? "ATF.errors.switchFailed"));
    } else if (result?.success) {
      ui.notifications?.info(t("ATF.notify.switched"));
    }
  } catch (err) {
    error(err);
    ui.notifications?.error(withErrorDetail(t("ATF.errors.switchFailed"), err));
  } finally {
    button.classList.remove("atf-processing");
    if (icon && prevIcon) icon.className = prevIcon;
  }
}
