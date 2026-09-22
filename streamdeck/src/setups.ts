/**
 * The setups shipped for each pack's tool, for a profile built without a run.
 *
 * Written by `design/profiles.mjs`: run `npm run profiles -w streamdeck`
 * and commit what moves. Edit the setups under `packs/setups`, not this
 * file.
 *
 * Only what a key is named from, the kind each one is, and the operations
 * by name. The kind is what decides the key a setup lands on, taken from
 * the file rather than worked out again here: Start of the DLC moves the
 * player, but what it is for is opening the DLC, and only the file can say
 * so. A pack whose tool ships no setups, and a pack that names no tool at
 * all, is not in here.
 */

import type { SetupGroup } from "@runlog/rules-schema";

/** The shipped setups for each pack, by pack id. */
export const PACK_SETUPS: Record<string, Array<{ id: string; title: string; group: SetupGroup; ops: Array<{ op: string }> }>> = {
  "com.scrthq.runlog.elden-ring-tarnishedtool": [
    {
      id: "com.scrthq.runlog.setups.all-knowing-sage",
      title: "All-Knowing Sage",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.archer",
      title: "Archer",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.barbarian",
      title: "Barbarian",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.bare-handed",
      title: "Bare-handed",
      group: "effects",
      ops: [{ op: "flag.set" }, { op: "value.set" }, { op: "runes.give" }],
    },
    {
      id: "com.scrthq.runlog.setups.berserker",
      title: "Berserker",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.black-blade",
      title: "Black Blade",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.black-flame-spellblade",
      title: "Black Flame Spellblade",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.blackflame-apostle",
      title: "Blackflame Apostle",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.blasphemous-beastmaster",
      title: "Blasphemous Beastmaster",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.blazing-bushido",
      title: "Blazing Bushido",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.blood-dancer",
      title: "Blood Dancer",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.blood-dragon",
      title: "Blood Dragon",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.bloodblade",
      title: "Bloodblade",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.brute",
      title: "Brute",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "runes.give" }],
    },
    {
      id: "com.scrthq.runlog.setups.carian-knight",
      title: "Carian Knight",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.carian-sovereignty",
      title: "Carian Sovereignty",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }],
    },
    {
      id: "com.scrthq.runlog.setups.champion",
      title: "Champion",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.cleric",
      title: "Cleric",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "runes.give" }],
    },
    {
      id: "com.scrthq.runlog.setups.cold-blooded-raptor",
      title: "Cold-Blooded Raptor",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.colossal-knight",
      title: "Colossal Knight",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.darkmoon-spellblade",
      title: "Darkmoon Spellblade",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.deathblade",
      title: "Deathblade",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.double-dragon",
      title: "Double Dragon",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.dragon-knight",
      title: "Dragon Knight",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.dragon-priest",
      title: "Dragon Priest",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.enchanted-knight",
      title: "Enchanted Knight",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }],
    },
    { id: "com.scrthq.runlog.setups.give-flask-upgrades", title: "Give Flask Upgrades", group: "items", ops: [{ op: "item.named" }] },
    { id: "com.scrthq.runlog.setups.give-gloveworts", title: "Give Gloveworts", group: "items", ops: [{ op: "item.named" }] },
    {
      id: "com.scrthq.runlog.setups.give-great-runes",
      title: "Give Great Runes",
      group: "items",
      ops: [{ op: "action.invoke" }, { op: "item.named" }],
    },
    { id: "com.scrthq.runlog.setups.give-larval-tears", title: "Give Larval Tears", group: "items", ops: [{ op: "item.named" }] },
    { id: "com.scrthq.runlog.setups.give-memory-stones", title: "Give Memory Stones", group: "items", ops: [{ op: "item.named" }] },
    { id: "com.scrthq.runlog.setups.give-runes", title: "Give Runes", group: "items", ops: [{ op: "runes.give" }] },
    {
      id: "com.scrthq.runlog.setups.give-scadutree-blessings",
      title: "Give Scadutree Blessings",
      group: "items",
      ops: [{ op: "item.named" }],
    },
    { id: "com.scrthq.runlog.setups.give-smithing-stones", title: "Give Smithing Stones", group: "items", ops: [{ op: "item.named" }] },
    { id: "com.scrthq.runlog.setups.give-starting-gifts", title: "Give Starting Gifts", group: "items", ops: [{ op: "action.invoke" }] },
    {
      id: "com.scrthq.runlog.setups.give-talisman-pouches",
      title: "Give Talisman Pouches",
      group: "items",
      ops: [{ op: "action.invoke" }],
    },
    { id: "com.scrthq.runlog.setups.glass", title: "Glass", group: "effects", ops: [{ op: "value.set" }, { op: "flag.set" }] },
    {
      id: "com.scrthq.runlog.setups.lightning-lancer",
      title: "Lightning Lancer",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.magic-archer",
      title: "Magic Archer",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.magus",
      title: "Magus",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.moonlight-crusader",
      title: "Moonlight Crusader",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.moonveil-samurai",
      title: "Moonveil Samurai",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }],
    },
    {
      id: "com.scrthq.runlog.setups.moonveil-shinobi",
      title: "Moonveil Shinobi",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.open-the-map",
      title: "Open the Map",
      group: "unlocks",
      ops: [{ op: "action.invoke" }, { op: "item.named" }, { op: "item.give" }],
    },
    {
      id: "com.scrthq.runlog.setups.paladin",
      title: "Paladin",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.piercing-paladin",
      title: "Piercing Paladin",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.samurai",
      title: "Samurai",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.sanguine-samurai",
      title: "Sanguine Samurai",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.sorcerer",
      title: "Sorcerer",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "runes.give" }],
    },
    {
      id: "com.scrthq.runlog.setups.star-lined-samurai",
      title: "Star-Lined Samurai",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.start-of-the-dlc",
      title: "Start of the DLC",
      group: "unlocks",
      ops: [{ op: "action.invoke" }, { op: "warp.grace" }],
    },
    {
      id: "com.scrthq.runlog.setups.stormblade-samurai",
      title: "Stormblade Samurai",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.sword-sage",
      title: "Sword Sage",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.templar",
      title: "Templar",
      group: "loadout",
      ops: [{ op: "value.set" }, { op: "weapon.named" }, { op: "item.named" }, { op: "action.invoke" }],
    },
    {
      id: "com.scrthq.runlog.setups.long-night",
      title: "The long night",
      group: "effects",
      ops: [{ op: "action.invoke" }, { op: "flag.set" }],
    },
    { id: "com.scrthq.runlog.setups.unlock-affinities", title: "Unlock Affinities", group: "unlocks", ops: [{ op: "action.invoke" }] },
    { id: "com.scrthq.runlog.setups.unlock-gestures", title: "Unlock Gestures", group: "unlocks", ops: [{ op: "action.invoke" }] },
    { id: "com.scrthq.runlog.setups.warp-caelid", title: "Warp to Caelid", group: "warp", ops: [{ op: "warp.grace" }] },
    { id: "com.scrthq.runlog.setups.warp-farum-azula", title: "Warp to Crumbling Farum Azula", group: "warp", ops: [{ op: "warp.grace" }] },
    {
      id: "com.scrthq.runlog.setups.warp-dragonbarrow",
      title: "Warp to Greyoll's Dragonbarrow",
      group: "warp",
      ops: [{ op: "warp.grace" }],
    },
    { id: "com.scrthq.runlog.setups.warp-leyndell", title: "Warp to Leyndell, Royal Capital", group: "warp", ops: [{ op: "warp.grace" }] },
    { id: "com.scrthq.runlog.setups.warp-limgrave", title: "Warp to Limgrave", group: "warp", ops: [{ op: "warp.grace" }] },
    { id: "com.scrthq.runlog.setups.warp-liurnia", title: "Warp to Liurnia of the Lakes", group: "warp", ops: [{ op: "warp.grace" }] },
    { id: "com.scrthq.runlog.setups.warp-haligtree", title: "Warp to Miquella's Haligtree", group: "warp", ops: [{ op: "warp.grace" }] },
    { id: "com.scrthq.runlog.setups.warp-mohgwyn-palace", title: "Warp to Mohgwyn Palace", group: "warp", ops: [{ op: "warp.grace" }] },
    { id: "com.scrthq.runlog.setups.warp-mt-gelmir", title: "Warp to Mt. Gelmir", group: "warp", ops: [{ op: "warp.grace" }] },
    { id: "com.scrthq.runlog.setups.warp-nokron", title: "Warp to Nokron, Eternal City", group: "warp", ops: [{ op: "warp.grace" }] },
    { id: "com.scrthq.runlog.setups.warp-roundtable-hold", title: "Warp to Roundtable Hold", group: "warp", ops: [{ op: "warp.grace" }] },
    { id: "com.scrthq.runlog.setups.warp-stormhill", title: "Warp to Stormhill", group: "warp", ops: [{ op: "warp.grace" }] },
    { id: "com.scrthq.runlog.setups.warp-stormveil-castle", title: "Warp to Stormveil Castle", group: "warp", ops: [{ op: "warp.grace" }] },
    {
      id: "com.scrthq.runlog.setups.warp-raya-lucaria",
      title: "Warp to the Academy of Raya Lucaria",
      group: "warp",
      ops: [{ op: "warp.grace" }],
    },
    { id: "com.scrthq.runlog.setups.warp-altus-plateau", title: "Warp to the Altus Plateau", group: "warp", ops: [{ op: "warp.grace" }] },
    {
      id: "com.scrthq.runlog.setups.warp-consecrated-snowfield",
      title: "Warp to the Consecrated Snowfield",
      group: "warp",
      ops: [{ op: "warp.grace" }],
    },
    {
      id: "com.scrthq.runlog.setups.warp-deeproot-depths",
      title: "Warp to the Deeproot Depths",
      group: "warp",
      ops: [{ op: "warp.grace" }],
    },
    {
      id: "com.scrthq.runlog.setups.warp-mountaintops",
      title: "Warp to the Mountaintops of the Giants",
      group: "warp",
      ops: [{ op: "warp.grace" }],
    },
    { id: "com.scrthq.runlog.setups.warp-siofra-river", title: "Warp to the Siofra River", group: "warp", ops: [{ op: "warp.grace" }] },
    {
      id: "com.scrthq.runlog.setups.warp-stranded-graveyard",
      title: "Warp to the Stranded Graveyard",
      group: "warp",
      ops: [{ op: "warp.grace" }],
    },
    {
      id: "com.scrthq.runlog.setups.warp-weeping-peninsula",
      title: "Warp to the Weeping Peninsula",
      group: "warp",
      ops: [{ op: "warp.grace" }],
    },
    { id: "com.scrthq.runlog.setups.warp-volcano-manor", title: "Warp to Volcano Manor", group: "warp", ops: [{ op: "warp.grace" }] },
    {
      id: "com.scrthq.runlog.setups.well-armed",
      title: "Well armed",
      group: "loadout",
      ops: [{ op: "weapon.named" }, { op: "item.named" }, { op: "runes.give" }],
    },
  ],
};
