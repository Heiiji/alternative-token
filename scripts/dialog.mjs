/**
 * The out-of-sync fallback dialog. Only shown when a token's current art matches
 * neither configured slot, so the user must pick one explicitly.
 *
 * Players revert to an approved appearance. GMs can *adopt* the current art into
 * a slot (same privilege as the File Picker) so a sheet-launched Tokenizer save
 * is not thrown away.
 */

import { SLOTS, t } from "./constants.mjs";

/**
 * Ask for slot A or B.
 * @param {object} config  the actor's configuration
 * @param {{title:string, icon:string, content:string, label:(slotLabel:string)=>string}} ui
 * @returns {Promise<"a"|"b"|null>}  null when dismissed
 */
async function promptSlot(config, { title, icon, content, label }) {
  try {
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: t(title), icon },
      content: `<p>${t(content)}</p>`,
      buttons: [
        { action: SLOTS.A, label: label(config.a?.label || "A"), default: true },
        { action: SLOTS.B, label: label(config.b?.label || "B") },
      ],
      rejectClose: false,
    });
    return choice === SLOTS.A || choice === SLOTS.B ? choice : null;
  } catch {
    return null;
  }
}

/** Player (or any non-GM owner): pick which approved appearance to revert to. */
export function promptSlotChoice(config) {
  return promptSlot(config, {
    title: "ATF.dialog.outOfSyncTitle",
    icon: "fa-solid fa-masks-theater",
    content: "ATF.dialog.outOfSyncContent",
    label: (slotLabel) => slotLabel,
  });
}

/** GM-only: assign the currently showing (unrecognized) art to slot A or B. */
export function promptAdoptSlot(config) {
  return promptSlot(config, {
    title: "ATF.dialog.adoptTitle",
    icon: "fa-solid fa-user-circle",
    content: "ATF.dialog.adoptContent",
    label: (slotLabel) => t("ATF.dialog.adoptAs", { label: slotLabel }),
  });
}
