/**
 * The setups shipped for each pack's tool, for a profile built without a run.
 *
 * Written by `design/profiles.mjs`: run `npm run profiles -w streamdeck`
 * and commit what moves. Edit the setups under `packs/setups`, not this
 * file.
 *
 * Only what a key is named from and the operations by name, which is all it
 * takes to tell a warp from a setup. A pack whose tool ships no setups, and
 * a pack that names no tool at all, is not in here.
 */

/** The shipped setups for each pack, by pack id. */
export const PACK_SETUPS: Record<string, Array<{ id: string; title: string; ops: Array<{ op: string }> }>> = {
  "com.scrthq.runlog.elden-ring-tarnishedtool": [
    {
      id: "com.scrthq.runlog.setups.bare-handed",
      title: "Bare-handed",
      ops: [{ op: "flag.set" }, { op: "value.set" }, { op: "runes.give" }],
    },
    {
      id: "com.scrthq.runlog.setups.brute",
      title: "Brute",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "runes.give" }],
    },
    {
      id: "com.scrthq.runlog.setups.cleric",
      title: "Cleric",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "runes.give" }],
    },
    { id: "com.scrthq.runlog.setups.give-flask-upgrades", title: "Give Flask Upgrades", ops: [{ op: "item.named" }] },
    { id: "com.scrthq.runlog.setups.give-gloveworts", title: "Give Gloveworts", ops: [{ op: "item.named" }] },
    { id: "com.scrthq.runlog.setups.give-great-runes", title: "Give Great Runes", ops: [{ op: "action.invoke" }, { op: "item.named" }] },
    { id: "com.scrthq.runlog.setups.give-larval-tears", title: "Give Larval Tears", ops: [{ op: "item.named" }] },
    { id: "com.scrthq.runlog.setups.give-memory-stones", title: "Give Memory Stones", ops: [{ op: "item.named" }] },
    { id: "com.scrthq.runlog.setups.give-runes", title: "Give Runes", ops: [{ op: "runes.give" }] },
    { id: "com.scrthq.runlog.setups.give-scadutree-blessings", title: "Give Scadutree Blessings", ops: [{ op: "item.named" }] },
    { id: "com.scrthq.runlog.setups.give-smithing-stones", title: "Give Smithing Stones", ops: [{ op: "item.named" }] },
    { id: "com.scrthq.runlog.setups.give-starting-gifts", title: "Give Starting Gifts", ops: [{ op: "action.invoke" }] },
    { id: "com.scrthq.runlog.setups.give-talisman-pouches", title: "Give Talisman Pouches", ops: [{ op: "action.invoke" }] },
    { id: "com.scrthq.runlog.setups.glass", title: "Glass", ops: [{ op: "value.set" }, { op: "flag.set" }] },
    {
      id: "com.scrthq.runlog.setups.open-the-map",
      title: "Open the Map",
      ops: [{ op: "action.invoke" }, { op: "item.named" }, { op: "item.give" }],
    },
    {
      id: "com.scrthq.runlog.setups.sorcerer",
      title: "Sorcerer",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "runes.give" }],
    },
    { id: "com.scrthq.runlog.setups.start-of-the-dlc", title: "Start of the DLC", ops: [{ op: "action.invoke" }, { op: "warp.grace" }] },
    { id: "com.scrthq.runlog.setups.long-night", title: "The long night", ops: [{ op: "action.invoke" }, { op: "flag.set" }] },
    { id: "com.scrthq.runlog.setups.unlock-affinities", title: "Unlock Affinities", ops: [{ op: "action.invoke" }] },
    { id: "com.scrthq.runlog.setups.unlock-gestures", title: "Unlock Gestures", ops: [{ op: "action.invoke" }] },
    {
      id: "com.scrthq.runlog.setups.well-armed",
      title: "Well armed",
      ops: [{ op: "weapon.named" }, { op: "item.named" }, { op: "runes.give" }],
    },
  ],
};
