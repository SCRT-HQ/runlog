/**
 * What the tools we know about can be asked to do.
 *
 * A profile is written in a browser, usually with nothing attached: at
 * the desk, the night before, on a laptop that has never seen the game.
 * So the editor cannot ask a tool what it can do and has to carry a list,
 * and this is that list.
 *
 * It is a convenience and never an authority. The wire stays free-form,
 * this end sends whatever a profile names, and the tool refuses by name
 * anything its build does not have. Where a tool *is* attached, the panel
 * shows what that build actually reported, so a catalog gone stale shows
 * up as a difference rather than as a mystery.
 */

export type ArgKind = "number" | "flag" | "choice" | "text" | "name" | "area";

export interface ArgDef {
  name: string;
  kind: ArgKind;
  label: string;
  required?: boolean;
  /** For a number: what the tool will accept. It refuses anything else. */
  least?: number;
  most?: number;
  /** For a choice: what the tool knows, by its own names. */
  options?: string[];
  /**
   * For a name, or for the area that tells two of one name apart: which
   * of the tool's own lists it is one of.
   *
   * A choice is short enough to put in a menu. A name is one of four
   * hundred, spelled exactly as the game spells it, and the panel used
   * to ask for it with an empty box and a note saying where to look. The
   * list is fetched when the panel opens rather than shipped in this
   * file, which is a page of definitions and not a copy of the game.
   */
  list?: ListName;
  note?: string;
}

/** A list of names the tool matches against, loaded on demand. */
export type ListName = "graces" | "items" | "weapons" | "ashes" | "bosses";

export interface OpDef {
  op: string;
  label: string;
  /** What a person needs to know before choosing it, in one line. */
  note?: string;
  /** True where the tool cannot undo it: an item given, a player moved. */
  oneWay?: boolean;
  /**
   * True where asking twice is twice as much.
   *
   * Runes add up and so do items with a count; a switch thrown twice is
   * still thrown, and a grace unlocked twice is unlocked. Which is which
   * decides whether a repeated line is worth saying anything about, so
   * it is declared here rather than guessed at from the name.
   */
  additive?: boolean;
  args: ArgDef[];
}

export interface ToolCatalog {
  /** What the tool calls itself in its hello, and what a profile names. */
  tool: string;
  label: string;
  /** The game it drives, for a person choosing between catalogs. */
  game: string;
  /** The build this list was written against. */
  against: string;
  ops: OpDef[];
}

/** The affinities a weapon can carry, in the game's own order. */
const AFFINITIES = [
  "Standard",
  "Heavy",
  "Keen",
  "Quality",
  "Fire",
  "Flame Art",
  "Lightning",
  "Sacred",
  "Magic",
  "Cold",
  "Poison",
  "Blood",
  "Occult",
];

/** Every toggle Tarnished Tool exposes to a source, by its own name. */
const FLAGS = [
  "player.noDeath",
  "player.noDamage",
  "player.noHit",
  "player.oneShot",
  "player.noRoll",
  "player.infiniteStamina",
  "player.infiniteFp",
  "player.infiniteArrows",
  "player.infiniteConsumables",
  "player.infinitePoise",
  "player.lockHp",
  "player.healOverTime",
  "player.fpRegen",
  "player.silent",
  "player.hidden",
  "player.speedBuff",
  "player.torrentNoDeath",
  "player.torrentAnywhere",
  "player.noRuneGain",
  "player.noRuneLoss",
  // Weightless. Set and read back through the tool rather than a view
  // model, since nothing in the tool holds it otherwise.
  "player.noGravity",
  "enemies.noDeath",
  "enemies.noDamage",
  "enemies.noAttack",
  "enemies.noMove",
  "enemies.noAi",
  "world.freeze",
  "world.noCutscenes",
  "world.guaranteedDrop",
  "world.mapInCombat",
  "world.warpInDungeons",
  "world.hideCharacters",
  "world.hideMap",
  "travel.restOnWarp",
  "travel.showAllGraces",
];

/** Every number it will set, with what it will accept. */
const VALUES: Array<{ name: string; least: number; most: number }> = [
  { name: "player.speed", least: 0.1, most: 10 },
  { name: "game.speed", least: 0.1, most: 10 },
  { name: "game.fps", least: 20, most: 240 },
  { name: "player.newGame", least: 0, most: 7 },
  { name: "player.vigor", least: 1, most: 99 },
  { name: "player.mind", least: 1, most: 99 },
  { name: "player.endurance", least: 1, most: 99 },
  { name: "player.strength", least: 1, most: 99 },
  { name: "player.dexterity", least: 1, most: 99 },
  { name: "player.intelligence", least: 1, most: 99 },
  { name: "player.faith", least: 1, most: 99 },
  { name: "player.arcane", least: 1, most: 99 },
  { name: "player.incomingDamage", least: 0, most: 100 },
  { name: "player.outgoingDamage", least: 0, most: 100 },
  // Which Spirit Ash is in the slot, and nought for none: the one way a
  // run can say "no summons" and have it be true rather than promised.
  { name: "player.spiritAsh", least: 0, most: 255 },
];

/** The one-shot presses it will take, which are deliberately few. */
const PRESSES = [
  "Quitout",
  "ForceSave",
  "Rest",
  "RuneArc",
  // The Travel tab's unlocks. Each is one-shot, which is what a setup
  // wants: `travel.showAllGraces` reveals graces and these hand them
  // over, and there is no flag for the maps at all. The toggles beside
  // them in the tool (ShowAllMaps, NoMapAcquiredPopup) are deliberately
  // not here, since invoking a toggle flips whatever the state happened
  // to be and a run cannot then say what it started with.
  "UnlockMainGameMaps",
  "UnlockDlcMaps",
  "UnlockAllMainGameGraces",
  "UnlockAllDlcGraces",
  "UnlockAllMainRemembrancesGraces",
  "UnlockAllDlcRemembrancesGraces",
  // The Event tab's own unlocks. Each sets the game's event flags for
  // a thing rather than handing over the item that represents it,
  // which is the difference between the affinity appearing at a table
  // and a whetblade sitting unused in a bag. `UnlockAffinites` is the
  // tool's spelling.
  "UnlockAffinites",
  "GiveStartingFlasks",
  "GiveTalismanPouches",
  "GiveStartingGifts",
  "GiveGreatRunes",
  "UnlockGestures",
  "UnlockMetyr",
  "FightFortissax",
  "FightEldenBeast",
  "SetMaxHp",
  "SetRfbs",
  "KillTarget",
  "SetMorning",
  "SetNoon",
  "SetDusk",
  "SetNight",
  "DefaultWeather",
  "RainyWeather",
  "SnowyWeather",
  "FoggyWeather",
];

export const TARNISHED_TOOL: ToolCatalog = {
  tool: "TarnishedTool",
  label: "Tarnished Tool",
  game: "Elden Ring",
  against: "the control tab, September 2026",
  ops: [
    {
      op: "flag.set",
      label: "Switch something on or off",
      note: "Restores the previous value when the effect ends.",
      args: [
        { name: "name", kind: "choice", label: "What", required: true, options: FLAGS },
        { name: "value", kind: "flag", label: "On", required: true },
      ],
    },
    {
      op: "value.set",
      label: "Set a number",
      note: "Restores the previous value when the effect ends.",
      args: [
        { name: "name", kind: "choice", label: "What", required: true, options: VALUES.map((v) => v.name) },
        {
          name: "value",
          kind: "number",
          label: "To",
          required: true,
          note: "Each value has a range. The tool rejects values outside it.",
        },
      ],
    },
    {
      op: "speffect.apply",
      label: "Apply a special effect",
      note: "Use the game's effect ID. The game applies the effect automatically.",
      args: [{ name: "id", kind: "number", label: "Effect id", required: true, least: 0 }],
    },
    {
      op: "speffect.remove",
      label: "Take a special effect off",
      oneWay: true,
      args: [{ name: "id", kind: "number", label: "Effect id", required: true, least: 0 }],
    },
    {
      op: "warp.position",
      label: "Move the player somewhere",
      note: "The tool rejects this while the game loads. This is off by default because it can move the player during a fight.",
      oneWay: true,
      args: [
        { name: "block", kind: "number", label: "Block id", required: true, least: 0 },
        { name: "x", kind: "number", label: "X", required: true },
        { name: "y", kind: "number", label: "Y", required: true },
        { name: "z", kind: "number", label: "Z", required: true },
        { name: "angle", kind: "number", label: "Facing", least: -360, most: 360 },
      ],
    },
    {
      op: "item.named",
      label: "Give an item, by name",
      note: "Choose a name from the tool's lists: consumables, upgrade and crafting materials, crystal tears, talismans, armor, arrows, spells, and eligible key items. Use the game's spelling. Weapons have a separate operation because the upgrade level is part of the weapon ID.",
      oneWay: true,
      additive: true,
      args: [
        { name: "name", kind: "name", list: "items", label: "Item", required: true, note: "Golden Seed, Rune Arc, Smithing Stone [3]." },
        { name: "quantity", kind: "number", label: "How many", least: 1, most: 99 },
      ],
    },
    {
      op: "weapon.named",
      label: "Give a weapon, at a level",
      note: "The weapon ID includes its upgrade level. Ordinary weapons reach +25 and somber weapons reach +10. A level above the weapon's limit is capped at that limit.",
      oneWay: true,
      args: [
        {
          name: "name",
          kind: "name",
          list: "weapons",
          label: "Weapon",
          required: true,
          note: "Wing of Astel, Blasphemous Blade, Uchigatana.",
        },
        {
          name: "upgrade",
          kind: "number",
          label: "Level",
          least: 0,
          most: 25,
          note: "0 is the base weapon. Leave this blank to use 0.",
        },
        {
          name: "ash",
          kind: "name",
          list: "ashes",
          label: "Ash of War",
          note: "Only compatible weapons and Ashes of War are accepted. Invalid names are rejected.",
        },
        {
          name: "affinity",
          kind: "choice",
          label: "Affinity",
          options: AFFINITIES,
          note: "Affinity applies to the weapon. If blank, the weapon uses Standard or the ash's first allowed affinity when Standard is unavailable.",
        },
        {
          name: "count",
          kind: "number",
          label: "How many",
          least: 1,
          most: 8,
          note: "Weapons do not stack. A count of two gives two weapons for dual wielding.",
        },
      ],
    },
    {
      op: "runes.give",
      label: "Give runes",
      note: "Adds runes; it cannot set the total because the tool cannot read how many the player holds. A negative amount removes runes. This operation cannot be reversed because awarded runes may already have been spent.",
      oneWay: true,
      additive: true,
      args: [
        {
          name: "amount",
          kind: "number",
          label: "How many",
          required: true,
          least: -999999999,
          most: 999999999,
          note: "Negative takes them away.",
        },
      ],
    },
    {
      op: "value.add",
      label: "Change a number by an amount",
      note: "Sets the selected count instead of adding to it. Use Give runes to add runes to the player's total. Restores the previous count when the effect ends.",
      additive: true,
      args: [
        { name: "name", kind: "choice", label: "What", required: true, options: VALUES.map((v) => v.name) },
        { name: "by", kind: "number", label: "By", required: true, note: "Negative takes it away. Held to the same range as setting it." },
      ],
    },
    {
      op: "warp.grace",
      label: "Move the player to a grace",
      note: "Choose a grace by name from the tool's list. It works even if the player has not found the grace. Specify the area when a name is shared.",
      oneWay: true,
      args: [
        {
          name: "name",
          kind: "name",
          list: "graces",
          label: "Grace",
          required: true,
          note: "Exactly as the tool spells it: Church of Elleh, Lake-Facing Cliffs.",
        },
        {
          name: "area",
          kind: "area",
          list: "graces",
          label: "Area",
          note: "Specify the area only when graces share a name.",
        },
      ],
    },
    {
      op: "warp.boss",
      label: "Move the player to a boss",
      note: "Choose a boss destination by name. Specify the area when the same boss appears in multiple places.",
      oneWay: true,
      args: [
        {
          name: "name",
          kind: "name",
          list: "bosses",
          label: "Boss",
          required: true,
          note: "Godrick the Grafted, Bell Bearing Hunter, Erdtree Avatar.",
        },
        {
          name: "area",
          kind: "area",
          list: "bosses",
          label: "Area",
          note: "Specify the area only when the name refers to multiple places.",
        },
      ],
    },
    /**
     * Watching, which is the only kind of operation that does nothing.
     *
     * The rest of this list changes the game. These ask the tool to tell
     * the run when something happens in it, so an objective is settled by
     * the game saying so rather than by the player being believed. They
     * are applied and reverted like anything else, which is the whole
     * reason they are operations rather than a second protocol: a watch
     * put on for a scene comes off when that scene closes, through the
     * machinery that already takes effects back.
     *
     * What they can see is what the tool already ships data for: every
     * boss and the event flags its death sets, and the items that set a
     * flag when they are picked up. An enemy that is not a boss sets no
     * flag, so "kill three of anything" is still the player's word, and
     * says so in the pack.
     */
    {
      op: "watch.boss",
      label: "Say when a boss dies",
      note: "Leave the name blank to detect any boss death, or specify one boss. This does not change the game.",
      args: [
        { name: "name", kind: "name", list: "bosses", label: "Boss", note: "Leave empty for any boss. Most objectives do." },
        { name: "area", kind: "area", list: "bosses", label: "Area", note: "Only where one name is used in more than one place." },
      ],
    },
    {
      op: "watch.item",
      label: "Say when an item is picked up",
      note: "Detects only items that set a game event flag. Picking up a smithing stone does not set one, so it cannot be detected.",
      args: [
        {
          name: "category",
          kind: "choice",
          label: "Any of",
          options: ["Key Items", "Cookbooks", "Bell Bearings", "Crystal Tears", "Ashes of War", "Sorceries", "Incantations", "Talismans"],
          note: "Select a category, or leave this blank to name a single item.",
        },
        { name: "name", kind: "text", label: "Named", note: "Exactly one item, spelled as the game spells it." },
      ],
    },
    {
      op: "watch.grace",
      label: "Say when a grace is lit",
      note: "Leave the name blank to detect any newly discovered grace. Previously discovered graces do not trigger an event.",
      args: [
        { name: "name", kind: "name", list: "graces", label: "Grace", note: "Leave empty for any grace new to this save." },
        { name: "area", kind: "area", list: "graces", label: "Area" },
      ],
    },
    {
      op: "player.drop",
      label: "Lift the player, and let go",
      note: "Lifts the player vertically and drops them. This is usually fatal and works on any map.",
      oneWay: true,
      args: [
        {
          name: "height",
          kind: "number",
          label: "How far up",
          least: 5,
          most: 500,
          note: "Metres. Around 150 is reliably fatal; 20 hurts.",
        },
      ],
    },
    {
      op: "item.give",
      label: "Give an item, by id",
      note: "The way in for anything the two operations above have no name for. Where a name will do, use it: an id is a number out of the game's own data and is wrong the first time the game moves.",
      oneWay: true,
      additive: true,
      args: [
        { name: "id", kind: "number", label: "Item id", required: true, least: 0 },
        { name: "quantity", kind: "number", label: "How many", least: 1, most: 99 },
        { name: "ashOfWar", kind: "name", list: "ashes", label: "Ash of War" },
      ],
    },
    {
      op: "action.invoke",
      label: "Press a button in the tool",
      oneWay: true,
      args: [{ name: "action", kind: "choice", label: "Which", required: true, options: PRESSES }],
    },
  ],
};

export const CATALOGS: ToolCatalog[] = [TARNISHED_TOOL];

export function catalogFor(tool: string | undefined): ToolCatalog | null {
  if (!tool) return null;
  return CATALOGS.find((c) => c.tool.toLowerCase() === tool.toLowerCase()) ?? null;
}

export function opDef(catalog: ToolCatalog | null, op: string): OpDef | null {
  return catalog?.ops.find((o) => o.op === op) ?? null;
}

/** What the tool will accept for a number, where the catalog knows. */
export function boundsOf(catalog: ToolCatalog | null, op: string, arg: string): { least?: number; most?: number } {
  if (op === "value.set" && arg === "value") return {};
  const def = opDef(catalog, op)?.args.find((a) => a.name === arg);
  return { ...(def?.least !== undefined ? { least: def.least } : {}), ...(def?.most !== undefined ? { most: def.most } : {}) };
}

/** What a named number will accept, which the editor shows beside the box. */
export function rangeOfValue(name: string): { least: number; most: number } | null {
  return VALUES.find((v) => v.name === name) ?? null;
}
