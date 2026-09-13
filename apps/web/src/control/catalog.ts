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
const AFFINITIES = ["Standard", "Heavy", "Keen", "Quality", "Fire", "Flame Art", "Lightning", "Sacred", "Magic", "Cold", "Poison", "Blood", "Occult"];

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
      note: "Put back to whatever it was when the effect ends.",
      args: [
        { name: "name", kind: "choice", label: "What", required: true, options: FLAGS },
        { name: "value", kind: "flag", label: "On", required: true },
      ],
    },
    {
      op: "value.set",
      label: "Set a number",
      note: "Put back to whatever it was when the effect ends.",
      args: [
        { name: "name", kind: "choice", label: "What", required: true, options: VALUES.map((v) => v.name) },
        { name: "value", kind: "number", label: "To", required: true, note: "Each has its own range; the tool refuses anything outside it." },
      ],
    },
    {
      op: "speffect.apply",
      label: "Apply a special effect",
      note: "By the game's own id. This is how a curse becomes the real thing rather than something a player acts out.",
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
      note: "Refused rather than queued while the game is loading. The most disruptive thing on this list, and off by default in the tool.",
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
      note: "From the tool's own lists: consumables, upgrade and crafting materials, crystal tears, talismans, armor, arrows, spells, and the key items that are simply given. Spell it as the game does. A weapon is not one of these; it has an operation of its own, because its level is part of naming it.",
      oneWay: true,
      args: [
        { name: "name", kind: "name", list: "items", label: "Item", required: true, note: "Golden Seed, Rune Arc, Smithing Stone [3]." },
        { name: "quantity", kind: "number", label: "How many", least: 1, most: 99 },
      ],
    },
    {
      op: "weapon.named",
      label: "Give a weapon, at a level",
      note: "A weapon is not an item with a count: its id carries how far it has been reinforced, so the level is part of naming it. Ordinary weapons go to +25 and somber ones to +10; a level past a weapon's own ceiling is held there rather than refused.",
      oneWay: true,
      args: [
        { name: "name", kind: "name", list: "weapons", label: "Weapon", required: true, note: "Wing of Astel, Blasphemous Blade, Uchigatana." },
        { name: "upgrade", kind: "number", label: "Level", least: 0, most: 25, note: "0 is the weapon as found. Leave it empty for the same thing." },
        { name: "ash", kind: "name", list: "ashes", label: "Ash of War", note: "Only where the weapon takes one, and only an ash that goes on that kind of weapon. Refused by name rather than quietly dropped." },
        { name: "affinity", kind: "choice", label: "Affinity", options: AFFINITIES, note: "Part of the weapon rather than the ash. Left empty it is the ordinary one, or the ash's own first choice where the ash does not allow ordinary." },
        { name: "count", kind: "number", label: "How many", least: 1, most: 8, note: "A weapon does not stack, so two of them is two of them: this is how a run hands somebody a pair to dual wield." },
      ],
    },
    {
      op: "runes.give",
      label: "Give runes",
      note: "Adds, and cannot set: nothing in the game says how many somebody is carrying, so there is no number to set one to. A negative amount is a toll. One way, and it does not come back off, because runes given are usually spent by the time anything would take them and taking away what somebody earned instead is worse than letting a gift stand.",
      oneWay: true,
      args: [{ name: "amount", kind: "number", label: "How many", required: true, least: -999999999, most: 999999999, note: "Negative takes them away." }],
    },
    {
      op: "value.add",
      label: "Change a number by an amount",
      note: "Giving somebody five thousand runes is not the same as setting their runes to five thousand, and only one of those is a gift. Reverts to what it was.",
      args: [
        { name: "name", kind: "choice", label: "What", required: true, options: VALUES.map((v) => v.name) },
        { name: "by", kind: "number", label: "By", required: true, note: "Negative takes it away. Held to the same range as setting it." },
      ],
    },
    {
      op: "warp.grace",
      label: "Move the player to a grace",
      note: "By name, from the tool's own list of every grace in the game. Works for graces the player has never found, which is the point. Say the area too where a name is used twice.",
      oneWay: true,
      args: [
        { name: "name", kind: "name", list: "graces", label: "Grace", required: true, note: "Exactly as the tool spells it: Church of Elleh, Lake-Facing Cliffs." },
        { name: "area", kind: "area", list: "graces", label: "Area", note: "Needed only where two graces share a name, and then it is one of the two." },
      ],
    },
    {
      op: "warp.boss",
      label: "Move the player to a boss",
      note: "The other half of naming a place: the destinations worth asking for that are not places anybody rests. Say the area too, since several of these are the same fight in two places.",
      oneWay: true,
      args: [
        { name: "name", kind: "name", list: "bosses", label: "Boss", required: true, note: "Godrick the Grafted, Bell Bearing Hunter, Erdtree Avatar." },
        { name: "area", kind: "area", list: "bosses", label: "Area", note: "Needed only where one name is used in more than one place, and then it is one of them." },
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
      note: "With no name, any boss at all: the run hears which one it was. With a name, only that one. Nothing happens to the game either way.",
      args: [
        { name: "name", kind: "name", list: "bosses", label: "Boss", note: "Leave empty for any boss, which is what most objectives want." },
        { name: "area", kind: "area", list: "bosses", label: "Area", note: "Only where one name is used in more than one place." },
      ],
    },
    {
      op: "watch.item",
      label: "Say when an item is picked up",
      note: "Only items the game raises a flag for, which is what this list is. A smithing stone off the ground raises nothing and cannot be seen.",
      args: [
        {
          name: "category",
          kind: "choice",
          label: "Any of",
          options: ["Key Items", "Cookbooks", "Bell Bearings", "Crystal Tears", "Ashes of War", "Sorceries", "Incantations", "Talismans"],
          note: "One whole kind of thing. Leave it out and name one instead.",
        },
        { name: "name", kind: "text", label: "Named", note: "Exactly one item, spelled as the game spells it." },
      ],
    },
    {
      op: "watch.grace",
      label: "Say when a grace is lit",
      note: "With no name, any grace lit for the first time. A grace already found raises nothing, which is what makes this worth asking for.",
      args: [
        { name: "name", kind: "name", list: "graces", label: "Grace", note: "Leave empty for any grace new to this save." },
        { name: "area", kind: "area", list: "graces", label: "Area" },
      ],
    },
    {
      op: "player.drop",
      label: "Lift the player, and let go",
      note: "Straight up from wherever they are, and then gravity. Usually fatal, which is generally why it is being asked for. Needs no map at all.",
      oneWay: true,
      args: [{ name: "height", kind: "number", label: "How far up", least: 5, most: 500, note: "Metres. Around 150 is reliably fatal; 20 hurts." }],
    },
    {
      op: "item.give",
      label: "Give an item, by id",
      note: "The way in for anything the two operations above have no name for. Where a name will do, use it: an id is a number out of the game's own data and is wrong the first time the game moves.",
      oneWay: true,
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
