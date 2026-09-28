"""Build Elden Ring: TarnishedTool's states, tables and control profile
from one source.

Run it from anywhere: python packs/profiles/build-tarnishedtool.py


Each curse row is (weight, id, text, state, ops). `state` is
(id, label, short, description) or None; `ops` is what a tool does about
it, or None for a vow that only the player enforces.
"""
import io, json, os, re, textwrap
import yaml

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(os.path.dirname(here))

def wrap(text, indent):
    """Word-wrap text for a >- block, one wrapped word at a time.

    A blank line in the source string is a real paragraph break, kept
    as one, rather than folded into the surrounding sentence like every
    other space in it.
    """
    lines = []
    for para in text.split("\n\n"):
        lines += textwrap.wrap(para, 68 - indent)
    return [" " * indent + l for l in lines]

def flag(name, value=True):
    return [{"op": "flag.set", "args": {"name": name, "value": value}}]

def val(name, v):
    return [{"op": "value.set", "args": {"name": name, "value": v}}]

def runes(amount):
    """Runes given or taken. Not a number anything can read, so it adds."""
    return [{"op": "runes.give", "args": {"amount": amount}}]

def press(action):
    return [{"op": "action.invoke", "args": {"action": action}}]

def watch_boss(name=None, area=None):
    """Say when a boss dies. No name means any of them."""
    args = {}
    if name: args["name"] = name
    if area: args["area"] = area
    return [{"op": "watch.boss", "args": args}]

def watch_item(category=None, name=None):
    """Say when something that raises a flag is picked up."""
    args = {}
    if category: args["category"] = category
    if name: args["name"] = name
    return [{"op": "watch.item", "args": args}]

def watch_grace():
    """Say when a grace new to this save is lit."""
    return [{"op": "watch.grace", "args": {}}]

# ---- which objectives the game itself can settle ---------------------
#
# An objective the tool can watch is settled by the game saying so rather
# than by the player being believed, which is the difference between a
# score and a claim. What can be watched is what raises an event flag:
# every boss death, and the items the game files as events. An ordinary
# enemy raises nothing, so "three of a kind" stays the player's word and
# the entry says as much.
#
# Keyed by entry id. Anything absent is honestly unwatchable, not
# forgotten; the list below is checked against the table when this runs.
WATCH = {
    "ob-near": watch_boss(),
    "ob-boss": watch_boss(),
    "ob-field": watch_boss(),
    "ob-gaol": watch_boss(),
    "ob-tunnel": watch_boss(),
    "ob-catacomb": watch_boss(),
    "ob-cave": watch_boss(),
    "ob-tunnel-boss": watch_boss(),
    "ob-dragon": watch_boss(),
    "ob-erdtree": watch_boss(),
    "ob-key": watch_item(category="Key Items"),
    "ob-map": watch_item(category="Key Items"),
    "ob-cookbook": watch_item(category="Cookbooks"),
    "ob-bearing": watch_item(category="Bell Bearings"),
    "ob-tear": watch_item(category="Crystal Tears"),
    "ob-ash": watch_item(category="Ashes of War"),
    "ob-spell": watch_item(category="Sorceries"),
    "ob-incant": watch_item(category="Incantations"),
    "ob-talisman": watch_item(category="Talismans"),
    "ob-grace": watch_grace(),
}

S = lambda i, l, sh, d: (i, l, sh, d)

# ---- curses applied for one scene --------------------------------------
# This table contains adverse effects and weather changes. Rewards belong
# in the blessing table.
I = [
    # Slower, faster, frailer, feebler.
    (3, "cu-slow", "Move at four fifths speed.", S("slowed", "Slowed", "SLOW", "You move at four fifths."), val("player.speed", 0.8)),
    (2, "cu-wade", "Move at two thirds speed.", S("wading", "Wading", "WADE", "You move at two thirds."), val("player.speed", 0.66)),
    (1, "cu-mired", "Move at half speed.", S("mired", "Mired", "MIRE", "You move at half speed."), val("player.speed", 0.5)),
    (3, "cu-quick", "The game runs one fifth faster.", S("hurried", "Hurried", "FAST", "The world runs a fifth faster."), val("game.speed", 1.2)),
    (2, "cu-frantic", "The game runs half again as fast.", S("frantic", "Frantic", "MANC", "The world runs half again as fast."), val("game.speed", 1.5)),
    (1, "cu-berserk", "The game runs at 1.75 times speed.", S("berserk", "Berserk", "BSRK", "The world runs at nearly double speed."), val("game.speed", 1.75)),
    (2, "cu-slower", "The whole game runs at four fifths speed.", S("sluggish", "Sluggish", "DRAG", "The whole world at four fifths."), val("game.speed", 0.8)),
    (3, "cu-tender", "Take half again as much damage.", S("tender", "Tender", "TEND", "You take half again the damage."), val("player.incomingDamage", 1.5)),
    (3, "cu-glass", "Take double damage.", S("glass", "Glass", "GLAS", "Everything hits twice as hard."), val("player.incomingDamage", 2)),
    (1, "cu-paper", "Take triple damage.", S("paper", "Paper", "PAPR", "Everything hits three times as hard."), val("player.incomingDamage", 3)),
    (3, "cu-blunt", "Deal three fifths damage.", S("blunted", "Blunted", "BLNT", "You deal three fifths damage."), val("player.outgoingDamage", 0.6)),
    (2, "cu-dull", "Deal two fifths damage.", S("dulled", "Dulled", "DULL", "You deal two fifths damage."), val("player.outgoingDamage", 0.4)),
    (1, "cu-useless", "Deal one quarter damage.", S("useless", "Useless", "USLS", "You deal a quarter damage."), val("player.outgoingDamage", 0.25)),
    # What you are made of, taken away.
    (2, "cu-hollow", "Your vigor is one for this scene.", S("hollow", "Hollow", "HOLW", "Vigor is one."), val("player.vigor", 1)),
    (2, "cu-feeble", "Your strength is one for this scene.", S("feeble", "Feeble", "FEEB", "Strength is one."), val("player.strength", 1)),
    (2, "cu-clumsy", "Your dexterity is one for this scene.", S("clumsy", "Clumsy", "CLMS", "Dexterity is one."), val("player.dexterity", 1)),
    (2, "cu-winded", "Your endurance is one for this scene.", S("winded", "Winded", "ENDR", "Endurance is one."), val("player.endurance", 1)),
    (1, "cu-empty", "Your mind is one for this scene.", S("empty", "Empty", "MIND", "Mind is one."), val("player.mind", 1)),
    # Money and sight.
    (3, "cu-poor", "Enemies award no runes this scene.", S("poor", "Poor", "POOR", "No runes from anything."), flag("player.noRuneGain")),
    (2, "cu-robbed", "Lose 10,000 runes now. Enemies award no runes this scene.", S("robbed", "Robbed", "ROBD", "Ten thousand taken, and no runes earned."), runes(-10000) + flag("player.noRuneGain")),
    (2, "cu-toll", "Lose 10,000 runes now, even if you have fewer.", None, runes(-10000)),
    (2, "cu-lost", "You cannot open the map this scene.", S("mapless", "Mapless", "LOST", "The map cannot be opened."), flag("world.hideMap")),
    (1, "cu-unseen-world", "Characters are invisible this scene.", S("blind", "Blind", "BLND", "Characters are not drawn."), flag("world.hideCharacters")),
    # What the dead do.
    (3, "cu-risen", "Enemies you kill remain alive this scene.", S("risen", "The risen", "RISE", "Nothing you kill stays dead."), flag("enemies.noDeath")),
    (2, "cu-stone", "Enemies take no damage this scene.", S("stone", "Unkillable", "STON", "Nothing can be damaged."), flag("enemies.noDamage")),
    (3, "cu-root", "You cannot roll this scene.", S("rooted", "Rooted", "ROOT", "No rolling."), flag("player.noRoll")),
    # Weather and time changes persist until another action changes them.
    # The board state badge ends with the scene.
    (2, "cu-night", "Set the time to night.", S("nightfall", "Night", "NGHT", "Night began this scene. The time stays set after the scene ends."), press("SetNight")),
    (2, "cu-dusk", "Set the time to dusk.", S("dusk", "Dusk", "DUSK", "Dusk began this scene."), press("SetDusk")),
    (1, "cu-noon", "Set the time to noon.", S("noon", "Noon", "NOON", "Noon began this scene."), press("SetNoon")),
    (1, "cu-morning", "Set the time to morning.", S("morning", "Morning", "MORN", "Morning began this scene."), press("SetMorning")),
    (2, "cu-fog", "Set the weather to fog.", S("fog", "Fog", "FOG", "Fog began this scene."), press("FoggyWeather")),
    (2, "cu-rain", "Set the weather to rain.", S("rain", "Rain", "RAIN", "Rain began this scene."), press("RainyWeather")),
    (2, "cu-snow", "Set the weather to snow.", S("snow", "Snow", "SNOW", "Snow began this scene."), press("SnowyWeather")),
    (1, "cu-clear", "Clear the weather.", S("clear", "Clear", "CLR", "The weather cleared this scene."), press("DefaultWeather")),
    # What is left of the vows.
    #
    # There were twenty-four, and nothing enforced any of them: a vow is
    # a thing a runner agrees to and then remembers, or does not, and a
    # pack written for a tool has no business asking. One of them turned
    # out to be enforceable after all, and it is here. The rest are gone,
    # replaced below by things this build can actually do.
    (3, "cu-alone", "Disable Spirit Ashes this scene.", S("alone", "Alone", "ALON", "No Spirit Ash."), val("player.spiritAsh", 0)),

    # The rest of what the tool can reach and the table had not asked for.
    # Three stats the pack had left alone while curses existed for the
    # other five, a journey nobody chose, a frame rate, and gravity.
    (2, "cu-witless", "Your intelligence is one for this scene.", S("witless", "Witless", "INTL", "Intelligence is one."), val("player.intelligence", 1)),
    (2, "cu-faithless", "Your faith is one for this scene.", S("faithless", "Faithless", "FTH", "Faith is one."), val("player.faith", 1)),
    (2, "cu-luckless", "Your arcane is one for this scene.", S("luckless", "Luckless", "ARC", "Arcane is one."), val("player.arcane", 1)),
    (1, "cu-journey", "Raise the journey level by one for this scene.", S("further", "Further on", "NG+", "The journey is one higher."), val("player.newGame", 1)),
    (2, "cu-slideshow", "Limit the game to 30 frames per second.", S("stutter", "Stutter", "30FPS", "Thirty frames a second."), val("game.fps", 30)),
    (1, "cu-flicker", "Limit the game to 20 frames per second.", S("flicker", "Flicker", "20FPS", "Twenty frames a second."), val("game.fps", 20)),
    (1, "cu-float", "Disable gravity this scene.", S("weightless", "Weightless", "FLOT", "No gravity."), flag("player.noGravity")),
    (2, "cu-fixed", "Lock your health at its current value this scene.", S("pinned", "Pinned", "LOCK", "Health is locked."), flag("player.lockHp")),
    (2, "cu-calm", "This draw adds no curse; other drawn curses still apply.", None, None),
]

# ---- objective: what the scene is for -----------------------------------
T = [
    (4, "ob-near", "Kill the boss in the nearest ruin, cave, catacomb, or camp. Name the target.", 3, []),
    (3, "ob-boss", "Name and kill a boss in your current area.", 5, ["hard"]),
    (2, "ob-field", "Kill a field boss with a health bar and no arena door.", 4, []),
    (2, "ob-again", "Defeat a boss you have beaten before.", 4, ["hard"]),
    (2, "ob-gaol", "Enter an evergaol and defeat its boss.", 4, ["hard"]),
    (2, "ob-tunnel", "Clear a mine or tunnel and defeat its boss.", 4, ["hard"]),
    (2, "ob-catacomb", "Clear a catacomb and defeat its boss.", 4, ["hard"]),
    (2, "ob-cave", "Clear a cave and defeat its boss.", 3, []),
    (2, "ob-tunnel-boss", "Reach the bottom of a mine and defeat its boss.", 4, ["hard"]),
    (3, "ob-knight", "Kill an armored knight in your current area.", 3, []),
    (2, "ob-dragon", "Name and kill a dragon, giant, or troll.", 5, ["hard"]),
    (2, "ob-invader", "Defeat a hostile NPC, whether they invade you or you invade them.", 3, []),
    (2, "ob-beast", "Kill a lion, bear, crab, or pack of wolves.", 3, []),
    (3, "ob-three", "Choose one visible enemy type and kill three.", 2, []),
    (3, "ob-five", "Choose one enemy type and kill five.", 3, []),
    (1, "ob-ten", "Choose one enemy type and kill ten.", 5, ["hard"]),
    (2, "ob-camp", "Kill every enemy in one encampment.", 4, ["hard"]),
    (2, "ob-building", "Kill every enemy inside one building.", 3, []),
    (2, "ob-patrol", "Follow a patrol to the end of its route, then kill all its members.", 3, []),
    (1, "ob-night", "Kill an enemy that appears only at night. Wait for it if needed.", 5, ["hard"]),
    (3, "ob-church", "Enter a church you have not visited and take the item at its altar.", 3, []),
    # Each of these names one kind of thing, because a kind is what the
    # game files as an event and so what can be settled without being
    # asked. "Something useful" is not an objective; a Bell Bearing is.
    (2, "ob-key", "Find a key item such as a Stonesword Key, Whetblade, or medallion half.", 3, []),
    (2, "ob-map", "Name and find a map fragment.", 3, []),
    (2, "ob-seed", "Name and find a Golden Seed or a Sacred Tear.", 3, []),
    (2, "ob-cookbook", "Find any cookbook.", 3, []),
    (2, "ob-bearing", "Find a Bell Bearing.", 3, []),
    (2, "ob-tear", "Find a Crystal Tear.", 3, []),
    (2, "ob-stone", "Find three Smithing Stones of any kind.", 2, []),
    (2, "ob-talisman", "Find a talisman you do not own and equip it.", 3, []),
    (2, "ob-weapon", "Find a weapon you do not own and swing it once this scene.", 3, []),
    (2, "ob-ash", "Find an Ash of War and equip it this scene.", 3, []),
    (2, "ob-spell", "Find a new sorcery you have enough intelligence to use.", 3, []),
    (2, "ob-incant", "Find a new incantation you have enough faith to use.", 3, []),
    (2, "ob-scarab", "Kill a teardrop scarab before it escapes.", 3, []),
    (3, "ob-grace", "Light a site of grace you have not lit before.", 2, []),
    (3, "ob-erdtree", "Reach a Minor Erdtree and kill the enemy beneath it.", 4, ["hard"]),
    (2, "ob-cross", "Travel overland into the next region and reach a grace. No fast travel.", 3, []),
    (2, "ob-caravan", "Find a caravan, kill the creatures pulling it and its guards, and take its cargo.", 4, ["hard"]),
    (2, "ob-runebear", "Find and kill a Runebear.", 5, ["hard"]),
    (2, "ob-door", "Find an imp statue door and a Stonesword Key. Unlock the door and take what is behind it.", 3, []),
    (2, "ob-upgrade", "Find Smithing Stones this scene and upgrade a weapon by one tier.", 3, []),
    (2, "ob-rise", "Enter a Rise, solve its puzzle, and take the item at the top.", 4, ["hard"]),
    (2, "ob-level", "Earn and spend enough runes for one level this scene.", 3, []),
    (2, "ob-road", "Follow a road to its next grace and kill enemies that block it.", 3, []),
    (2, "ob-nohit", "Complete your named objective without taking a hit.", 6, ["hard"]),
    (2, "ob-nofla", "Complete your named objective without drinking anything.", 5, ["hard"]),
    (1, "ob-fast", "Complete your named objective in the first half of the scene.", 5, ["hard"]),
    (2, "ob-two", "Draw one additional objective. Complete both this scene.", None,
     ["hard", "TRIGGER1"]),
    (1, "ob-three-t", "Draw two additional objectives. Complete all three this scene.", None, ["hard", "TRIGGER2"]),
    (3, "ob-rest", "Survive the scene. No other objective is required.", None, ["mercy"]),
    # Nothing to go back to on the first scene, so the tag keeps it
    # out of that draw rather than handing somebody an instruction with
    # no referent.
    (2, "ob-back", "Return overland to where the previous scene began, on foot or on Torrent. No fast travel.", 3, ["BEHIND"]),
]

PLACES = [
    (6, "dis-elleh", "Church of Elleh", "Limgrave", "A ruined church at a crossroads."),
    (5, "dis-first", "The First Step", "Limgrave", "The cliff where the run began."),
    (5, "dis-gatefront", "Gatefront", "Limgrave", "Ruins by the gate on the road north."),
    (4, "dis-artist", "Artist's Shack", "Limgrave", "A hut with a view and an enemy nearby."),
    (4, "dis-pilgrim", "Church of Pilgrimage", "Weeping Peninsula", "South of the bridge on the Weeping Peninsula."),
    (3, "dis-morne", "Castle Morne Rampart", "Weeping Peninsula", "The castle stands on a cliff above the sea."),
    (5, "dis-cliffs", "Lake-Facing Cliffs", "Liurnia of the Lakes", "The cliffs overlook the lake below."),
    (4, "dis-shore", "Liurnia Lake Shore", "Liurnia of the Lakes", "The shore of Liurnia Lake."),
    (3, "dis-scenic", "Scenic Isle", "Liurnia of the Lakes", "A small island with nearby enemies."),
    (4, "dis-stormveil", "Stormveil Main Gate", "Stormveil Castle", "The main gate of Stormveil Castle."),
    (3, "dis-gateside", "Gateside Chamber", "Stormveil Castle", "Inside Stormveil Castle walls. Avoid detection."),
    (4, "dis-altus", "Altus Plateau", "Altus Plateau", "An open area on the golden plateau."),
    (3, "dis-erdtree", "Erdtree-Gazing Hill", "Altus Plateau", "An exposed hill with a view of the Erdtree."),
    (3, "dis-windmill", "Windmill Village", "Altus Plateau", "A village with dancing villagers."),
    (4, "dis-smoulder", "Smoldering Church", "Caelid", "A church in Caelid with nearby enemies."),
    (3, "dis-rotview", "Rotview Balcony", "Caelid", "A balcony overlooking the rot."),
    (2, "dis-dragon", "Cathedral of Dragon Communion", "Caelid", "A cathedral on the beach with Dragon Hearts inside."),
    (3, "dis-gelmir", "Bridge of Iniquity", "Mt. Gelmir", "A mountain road beside a steep drop."),
    (2, "dis-seethe", "Seethewater River", "Mt. Gelmir", "A river of magma with enemies nearby."),
    (3, "dis-siofra", "Siofra River Bank", "Siofra River", "An underground river beneath a star-like ceiling."),
    (2, "dis-worship", "Worshippers' Woods", "Siofra River", "Underground woods where drums can be heard."),
    (3, "dis-ainsel", "Ainsel River Sluice Gate", "Ainsel River", "A deeper underground area with ants."),
    (2, "dis-volcano", "Volcano Manor", "Volcano Manor", "Inside Volcano Manor, where its residents may turn hostile."),
    (2, "dis-eiglay", "Temple of Eiglay", "Volcano Manor", "A temple deep in the manor above lava."),
    (3, "dis-zamor", "Zamor Ruins", "Mountaintops of the Giants", "Snow-covered ruins in the Mountaintops."),
    (2, "dis-freezing", "Freezing Lake", "Mountaintops of the Giants", "A frozen lake with a large enemy."),
    (2, "dis-rot", "Lake of Rot Shoreside", "Lake of Rot", "A lake of rot. Cross it quickly."),
    (2, "dis-shunning", "Underground Roadside", "Subterranean Shunning-Grounds", "A sewer beneath the capital."),
    (2, "dis-deeproot", "Root-Facing Cliffs", "Deeproot Depths", "Roots deep underground."),
    (2, "dis-snowfield", "Consecrated Snowfield", "Consecrated Snowfield", "A snowfield with low visibility and nearby enemies."),
    (2, "dis-ordina", "Ordina- Liturgical Town", "Consecrated Snowfield", "A lit town that appears empty but has enemies."),
    (1, "dis-farum", "Crumbling Beast Grave", "Crumbling Farum Azula", "Crumbling ruins suspended in the air."),
    (1, "dis-table", "Table of Lost Grace", "Roundtable Hold", "Return to Roundtable Hold."),
]

def item(name, quantity=1):
    return [{"op": "item.named", "args": {"name": name, "quantity": quantity}}]

# ---- blessing: what settling an objective is worth -----------------------------
# Drawn when the player says they settled it, which is the only way
# anything here can know. A blessing is a reward, so nothing in it is a
# punishment and nothing is worth points.
B = [
    (3, "bl-runes", "Receive 5,000 runes.", None, runes(5000)),
    (2, "bl-runes2", "Receive 20,000 runes.", None, runes(20000)),
    (3, "bl-seed", "Receive one Golden Seed.", None, item("Golden Seed")),
    (2, "bl-tear", "Receive one Sacred Tear.", None, item("Sacred Tear")),
    (3, "bl-arc", "Receive one Rune Arc.", None, item("Rune Arc")),
    (3, "bl-stone", "Receive three Smithing Stones [3].", None, item("Smithing Stone [3]", 3)),
    (2, "bl-somber", "Receive one Somber Smithing Stone [3].", None, item("Somber Smithing Stone [3]")),
    (2, "bl-key", "Receive two Stonesword Keys.", None, item("Stonesword Key", 2)),
    (2, "bl-gold", "Receive ten Golden Runes [10].", None, item("Golden Rune [10]", 10)),
    (2, "bl-flesh", "Receive three Exalted Flesh.", None, item("Exalted Flesh", 3)),
    (2, "bl-blessing", "Receive three Blessings of Marika.", None, item("Blessing of Marika", 3)),
    (2, "bl-baldachin", "Receive two Baldachin's Blessings.", None, item("Baldachin's Blessing", 2)),
    (2, "bl-dragon", "Receive one Ancient Dragon's Blessing.", None, item("Ancient Dragon's Blessing")),
    (2, "bl-fowl", "Receive three Silver-Pickled Fowl Feet.", None, item("Silver-Pickled Fowl Foot", 3)),
    (2, "bl-boluses", "Receive three Neutralizing Boluses.", None, item("Neutralizing Boluses", 3)),
    (2, "bl-branch", "Receive two Bewitching Branches.", None, item("Bewitching Branch", 2)),
    (2, "bl-shards", "Receive three Starlight Shards.", None, item("Starlight Shards", 3)),
    (2, "bl-grease", "Receive three Fire Grease.", None, item("Fire Grease", 3)),
    (1, "bl-prawn", "Receive three Boiled Prawn.", None, item("Boiled Prawn", 3)),
    (1, "bl-warming", "Receive two Warming Stones.", None, item("Warming Stone", 2)),
    (1, "bl-medallion", "Receive one Crimson Amber Medallion.", None, item("Crimson Amber Medallion")),
    (1, "bl-cerulean", "Receive one Cerulean Crystal Tear.", None, item("Cerulean Crystal Tear")),
    (1, "bl-opaline", "Receive one Opaline Bubbletear.", None, item("Opaline Bubbletear")),
    (3, "bl-mend", "Restore health, focus, and flasks.", None, press("SetRfbs")),
    (3, "bl-heal", "Restore health to full.", None, press("SetMaxHp")),
    (3, "bl-wind", "Use no stamina for the next scene.", S("blessed-wind", "Second wind", "WIND+", "Stamina does not run out."), flag("player.infiniteStamina")),
    (2, "bl-focus", "Use no FP for the next scene.", S("blessed-focus", "Clear head", "FOCS+", "FP does not run out."), flag("player.infiniteFp")),
    (3, "bl-sharp", "Deal double damage until this scene ends.", S("blessed-sharp", "Whetted", "SHRP+", "You deal double damage."), val("player.outgoingDamage", 2)),
    (2, "bl-tough", "Take half damage until this scene ends.", S("blessed-tough", "Warded", "WARD", "You take half damage."), val("player.incomingDamage", 0.5)),
    (2, "bl-luck", "Guarantee enemy drops until this scene ends.", S("blessed-luck", "Fortunate", "DROP+", "Enemy drops are guaranteed."), flag("world.guaranteedDrop")),
    (2, "bl-quiet", "Enemies cannot hear you until this scene ends.", S("blessed-quiet", "Quiet", "HUSH+", "Enemies cannot hear you."), flag("player.silent")),
    (2, "bl-mending", "Regenerate health until this scene ends.", S("blessed-mend", "Mending", "MEND+", "Your health regenerates."), flag("player.healOverTime")),
    (1, "bl-keep", "Lose no runes on death until this scene ends.", S("blessed-keep", "Held", "KEEP+", "Death costs no runes."), flag("player.noRuneLoss")),
    (1, "bl-horse", "Summon Torrent anywhere until this scene ends.", S("blessed-horse", "Mounted", "HORS+", "Summon Torrent anywhere."), flag("player.torrentAnywhere")),
    (2, "bl-swift", "Move one quarter faster until this scene ends.", S("blessed-swift", "Swift", "SWFT", "You move one quarter faster."), val("player.speed", 1.25)),
    (2, "bl-peace", "Enemies do not attack until this scene ends.", S("blessed-peace", "Peace", "PEAC", "Enemies do not attack."), flag("enemies.noAttack")),
    (2, "bl-still", "Enemies do not move until this scene ends.", S("blessed-still", "Stillness", "STIL", "Enemies do not move."), flag("enemies.noMove")),
    (1, "bl-asleep", "Disable enemy AI until this scene ends.", S("blessed-sleep", "Asleep", "SLEP", "Enemy AI is disabled."), flag("enemies.noAi")),
    (2, "bl-stocked", "Consumables do not run out until this scene ends.", S("blessed-stock", "Stocked", "FULL", "Consumables are not used up."), flag("player.infiniteConsumables")),
    (1, "bl-quiver", "Arrows do not run out until this scene ends.", S("blessed-ammo", "Quivered", "AMMO", "Arrows are not used up."), flag("player.infiniteArrows")),
    (2, "bl-anchored", "You cannot be staggered until this scene ends.", S("blessed-poise", "Anchored", "POIS", "You cannot be staggered."), flag("player.infinitePoise")),
    (1, "bl-unseen", "Enemies cannot see you until this scene ends.", S("blessed-unseen", "Unseen", "DARK", "Enemies cannot see you."), flag("player.hidden")),
    (1, "bl-lethal", "Kill any enemy you hit until this scene ends.", S("blessed-lethal", "Dreadful", "KILL+", "Any enemy you hit dies."), flag("player.oneShot")),
]

# ---- the loadout phase: tiers, their builds, and their warps ------------
#
# Which tier a build belongs to is a fact about this pack's progression,
# not the setup format, so the map lives here rather than on the setup
# itself. The ops stay written once, in the setup's own YAML; this reads
# them back out rather than copying them in.

TIER_ORDER = ["beginner", "midgame", "lategame", "endgame"]

_TIER_SLUGS = {
    "beginner": [
        "samurai", "paladin", "barbarian", "dragon-priest", "archer",
        "berserker", "bloodblade",
    ],
    "midgame": [
        "moonveil-samurai", "sword-sage", "templar", "blood-dragon",
        "blackflame-apostle", "colossal-knight", "champion", "magus",
        "enchanted-knight", "magic-archer",
    ],
    "lategame": [
        "moonveil-shinobi", "blood-dancer", "blazing-bushido",
        "lightning-lancer", "darkmoon-spellblade", "black-flame-spellblade",
        "dragon-knight", "cold-blooded-raptor", "deathblade",
        "blasphemous-beastmaster",
    ],
    "endgame": [
        "sanguine-samurai", "star-lined-samurai", "carian-knight",
        "stormblade-samurai", "moonlight-crusader", "double-dragon",
        "black-blade", "carian-sovereignty", "piercing-paladin",
        "all-knowing-sage",
    ],
}

# Keyed by setup slug rather than built from the lists above directly, so
# a slug that ended up in two tiers fails loudly here instead of one tier
# quietly losing it to a dict overwrite.
TIERS = {}
for _tier in TIER_ORDER:
    for _slug_name in _TIER_SLUGS[_tier]:
        if _slug_name in TIERS:
            raise ValueError("setup slug is in more than one tier: " + _slug_name)
        TIERS[_slug_name] = _tier


def tier_builds():
    """Read the 37 setup files TIERS names and hand back their ops.

    A build's operations are written once, in its own setup YAML, and
    this is the only place that reads them for the loadout phase; nothing
    copies an op list in here. Returns a dict, tier name to a list of
    (id, title, ops) in TIER_ORDER, with each op's `once` key stripped:
    a build the loadout phase applies is applied whole every time it
    lands, not once and then never again.
    """
    setups_dir = os.path.join(root, "packs", "setups")
    out = {tier: [] for tier in TIER_ORDER}
    for slug, tier in TIERS.items():
        path = os.path.join(setups_dir, "elden-ring-" + slug + ".yaml")
        if not os.path.isfile(path):
            raise FileNotFoundError("tier map names a setup that does not exist: " + path)
        with io.open(path, encoding="utf-8") as f:
            doc = yaml.safe_load(f)
        ops = [{k: v for k, v in op.items() if k != "once"} for op in doc["ops"]]
        out[tier].append((doc["id"], doc["title"], ops))
    return out


# Four short warp tables, one per tier, rolled after a loadout lands so a
# tier does not always drop a player in the same spot. Every name and
# area here has to be spelled exactly as the tool's own grace list spells
# it, checked below rather than trusted.
WARPS = {
    "beginner": [
        ("Church of Elleh", "Limgrave"),
        ("Gatefront", "Limgrave"),
        ("Church of Pilgrimage", "Weeping Peninsula"),
        ("Warmaster's Shack", "Stormhill"),
    ],
    "midgame": [
        ("Lake-Facing Cliffs", "Liurnia of the Lakes"),
        ("Raya Lucaria Grand Library", "Academy of Raya Lucaria"),
        ("Smoldering Church", "Caelid"),
        ("Altus Plateau", "Altus Plateau"),
    ],
    "lategame": [
        ("West Capital Rampart", "Leyndell- Royal Capital"),
        ("Bridge of Iniquity", "Mt. Gelmir"),
        ("Volcano Manor", "Volcano Manor"),
        ("Zamor Ruins", "Mountaintops of the Giants"),
    ],
    "endgame": [
        ("Dragon Temple", "Crumbling Farum Azula"),
        ("Haligtree Town", "Miquella's Haligtree"),
        ("Palace Approach Ledge-Road", "Mohgwyn Palace"),
        ("Consecrated Snowfield", "Consecrated Snowfield"),
    ],
}


def _check_warps_are_real_graces():
    """Every WARPS pair has to exist in the tool's own grace list.

    A name not in that list reaches the tool, matches nothing, and
    leaves a hole in a warp with no error anybody sees.
    """
    list_path = os.path.join(root, "apps", "web", "src", "control", "lists", "tarnishedtool.json")
    with io.open(list_path, encoding="utf-8") as f:
        known = {(g["name"], g["area"]) for g in json.load(f)["graces"]}
    missing = [(tier, name, area) for tier, pairs in WARPS.items() for name, area in pairs if (name, area) not in known]
    assert not missing, "WARPS names a grace not in the tool's list: " + ", ".join(
        "%s: %r in %r" % (tier, name, area) for tier, name, area in missing
    )


_check_warps_are_real_graces()


def _warp_slug(text):
    """Lowercase and hyphenated, for building a warp row's id."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def warp_rows(tier):
    """Turn one tier's warps into (weight, id, text, state, ops) rows.

    Same shape PLACES and the Displacement table use, so a tier's warp
    table goes through the same `entries`/`table` helpers the emit
    section below already uses for Displacement.
    """
    rows = []
    seen = set()
    for name, area in WARPS[tier]:
        base = "wp-" + tier + "-" + _warp_slug(area)
        eid, n = base, 2
        while eid in seen:
            eid = base + "-" + str(n)
            n += 1
        seen.add(eid)
        text = "%s, %s." % (name, area)
        ops = [{"op": "warp.grace", "args": {"name": name, "area": area}}]
        rows.append((1, eid, text, None, ops))
    return rows


def loadout_entry_id(tier, build_id):
    """The table entry id for one build: the tier and the setup id's own slug."""
    return "ld-" + tier + "-" + build_id.rsplit(".", 1)[-1]


def loadout_rows(tier, builds):
    """Turn one tier's builds into entries() input rows, all equal weight.

    Shaped like every other rows list in this file: (weight, id, text,
    extra, ops). `extra` carries the tier through to loadout_extra below,
    the same way a curse row carries its state.
    """
    return [(1, loadout_entry_id(tier, build_id), title, tier, ops) for build_id, title, ops in builds]


def loadout_extra(row):
    """A loadout entry: tagged with the tier it belongs to."""
    tier = row[3]
    return ["tags: [loadout, " + tier + "]"]


def warp_extra_for(tier):
    """A warp entry: tagged with the tier it belongs to.

    `warp_rows` does not carry the tier in the row itself, since it is
    shaped to match Displacement's rows exactly, so the tier is closed
    over here instead.
    """
    def extra(row):
        return ["tags: [warp, " + tier + "]"]
    return extra


# Table descriptions identify each loadout tier and its separate setup,
# and state when its corresponding warp table is drawn.
LOADOUT_DESC = {
    "beginner": "A beginner build for the start of a run. The same build is available as a separate setup.",
    "midgame": "A midgame build for the second quarter of a run. The same build is available as a separate setup.",
    "lategame": "A lategame build for the third quarter of a run. The same build is available as a separate setup.",
    "endgame": "An endgame build for the final quarter of a run. The same build is available as a separate setup.",
}

WARP_DESC = {
    "beginner": "Drawn after a beginner loadout. Warps the player to one of four starting locations.",
    "midgame": "Drawn after a midgame loadout. Warps the player to one of four locations.",
    "lategame": "Drawn after a lategame loadout. Warps the player to one of four locations.",
    "endgame": "Drawn after an endgame loadout. Warps the player to one of four locations.",
}

TIER_TITLE = {"beginner": "Beginner", "midgame": "Midgame", "lategame": "Lategame", "endgame": "Endgame"}

# ---- emit ---------------------------------------------------------------
def fit(rows):
    """Scale the weights to tile a d100 exactly, keeping what is rarer rarer.

    Written by hand, the weights never add to a hundred, and tuning them
    by hand again every time an entry is added is how a table ends up
    with a gap nobody notices. So the relative weights are the input and
    the arithmetic is not anybody's problem.
    """
    want = [r[0] for r in rows]
    total = sum(want)
    scaled = [max(1, round(w * 100 / total)) for w in want]
    # Spread the difference around the entries that were meant to be
    # common, one each in turn, so no single row absorbs all of it and
    # ends up eight times likelier than its neighbours. Nothing is ever
    # rounded out of existence.
    order = sorted(range(len(scaled)), key=lambda i: -want[i])
    at = 0
    while sum(scaled) != 100:
        step = 1 if sum(scaled) < 100 else -1
        i = order[at % len(order)]
        at += 1
        if step < 0 and scaled[i] <= 1:
            continue
        scaled[i] += step
    return scaled

def entries(rows):
    out, at = [], 1
    for width, row in zip(fit(rows), rows):
        eid, text = row[1], row[2]
        lo, hi = at, at + width - 1
        at = hi + 1
        out.append((eid, lo, hi, text, row))
    assert at == 101, at
    return out

def table(name, title, desc, built, extra_of):
    out = [f"  {name}:", "    resolution: lookup", f"    title: {title}", "    description: >-"]
    out += wrap(desc, 6)
    out += ["    roll: d100", "    entries:"]
    for eid, lo, hi, text, row in built:
        out.append(f"      - id: {eid}")
        out.append(f"        range: [{lo}, {hi}]")
        out.append("        text: >-")
        out += wrap(text, 10)
        out += ["        " + l for l in extra_of(row)]
    return "\n".join(out) + "\n"

def i_extra(row):
    """A curse: something a tool does, or a vow only you keep."""
    state, ops = row[3], row[4]
    tags = ["curse", "effect" if ops else "vow"]
    if row[1] == "cu-calm":
        tags = ["curse", "quiet"]
    lines = ["tags: [" + ", ".join(tags) + "]"]
    if state:
        lines.append("grants: [" + state[0] + "]")
    return lines

def b_extra(row):
    """A blessing: a thing handed over, or a blessing that holds a while."""
    state, ops = row[3], row[4]
    kind = "item" if ops and ops[0]["op"] == "item.named" else "lasting"
    lines = ["tags: [" + ", ".join(["blessing", kind]) + "]"]
    if state:
        lines.append("grants: [" + state[0] + "]")
    return lines

def t_extra(row):
    points, tags = row[3], list(row[4])
    lines = []
    trigger = None
    behind = False
    for t in list(tags):
        if t.startswith("TRIGGER"):
            trigger = int(t[-1])
            tags.remove(t)
        if t == "BEHIND":
            behind = True
            tags.remove(t)
    lines.append("tags: [" + ", ".join(["objective"] + tags) + "]")
    if points:
        lines.append(f"points: {points}")
    if behind:
        lines += ["requires:", "  - { unitIndex: { gte: 2 } }"]
    if trigger:
        lines += ["triggers:", "  - on: immediately", "    do:"]
        lines += ["      - { do: rollOn, table: objective }"] * trigger
    return lines

def d_extra(row):
    return ["tags: [displacement, fall]"] if row[1] == "dis-sky" else ["tags: [displacement]"]

displacement = [(w, eid, f"{name}, {area}. {text}", None, None) for w, eid, name, area, text in PLACES]
displacement.append((2, "dis-sky", "The sky. You are dropped from 220 feet above your current position.", None, None))

built_i, built_t, built_d, built_b = entries(I), entries(T), entries(displacement), entries(B)

states = []
seen = set()
for row in I + B:
    st = row[3]
    if not st or st[0] in seen:
        continue
    seen.add(st[0])
    sid, label, short, desc = st
    states.append(f"  {sid}:\n    label: {label}\n    short: {short}\n    scope: run\n    until: unitEnd\n    description: {desc}")

tables = table("curse", "Curse",
               "Draw Curses per scene at the start of each scene. Most curses end with the scene. Time and weather changes persist until another action changes them; their board badges end with the scene. TarnishedTool applies game effects; the player must follow any vows. The tracker sets how many curses to draw, from one to four. Curses give no points and no rewards.",
               built_i, i_extra)
tables += "\n" + table("objective", "Objective",
                       "Draw objectives after curses. Name each objective in your own words for the log. The Objectives per scene tracker sets how many to draw. Two results draw one or two additional objectives.",
                       built_t, t_extra)
tables += "\n" + table("blessing", "Blessing",
                       "Draw a blessing when you report an objective settled. Blessings give rewards but no points; points belong to the objective.",
                       built_b, b_extra)
tables += "\n" + table("displacement", "Displacement",
                       "Every fourth scene, draw a displacement as the scene closes. TarnishedTool moves you to the named location before the next scene opens.",
                       built_d, d_extra)

TIER_BUILDS = tier_builds()
WARP_ROWS = {tier: warp_rows(tier) for tier in TIER_ORDER}

for _tier in TIER_ORDER:
    tables += "\n" + table("loadout-" + _tier, TIER_TITLE[_tier] + " Loadout", LOADOUT_DESC[_tier],
                            entries(loadout_rows(_tier, TIER_BUILDS[_tier])), loadout_extra)

for _tier in TIER_ORDER:
    tables += "\n" + table("warp-" + _tier, TIER_TITLE[_tier] + " Warp", WARP_DESC[_tier],
                            entries(WARP_ROWS[_tier]), warp_extra_for(_tier))

pack_path = os.path.join(root, "packs", "sketches", "elden-ring-tarnishedtool.yaml")
s = io.open(pack_path, encoding="utf-8").read()
head = s[:s.index("states:\n")]
tail = s[s.index("\ncounters:"):]
counters_and_after = tail[:tail.index("\ntables:")]
after_tables = tail[tail.index("\nmoves:"):]
s = head + "states:\n" + "\n".join(states) + "\n" + counters_and_after + "\ntables:\n" + tables + after_tables
# Only the states and the tables are ours. Anything else the pack
# declares was written by hand and must survive being regenerated, which
# it did not the first time a triggers block was put in the wrong place.
was = set(re.findall(r"^([a-z][a-zA-Z]*):", io.open(pack_path, encoding="utf-8").read(), re.M))
now = set(re.findall(r"^([a-z][a-zA-Z]*):", s, re.M))
assert not was - now, "regenerating would drop: " + ", ".join(sorted(was - now))
io.open(pack_path, "w", encoding="utf-8", newline="").write(s)

# ---- the profile, from the same source ---------------------------------
rows = []
for row in I:
    eid, state, ops = row[1], row[3], row[4]
    if not ops:
        continue
    label = state[1] if state else eid.replace("cu-", "").capitalize()
    r = {"entry": eid, "table": "curse", "label": label}
    # Weather and time hold until something changes them, which is weather.
    if ops[0]["op"] != "action.invoke":
        r["until"] = "unit"
    r["ops"] = ops
    rows.append(r)

for row in B:
    eid, state, ops = row[1], row[3], row[4]
    r = {"entry": eid, "table": "blessing", "label": state[1] if state else eid.replace("bl-", "").capitalize()}
    # A buff lasts the scene; an item or a heal is simply given.
    if ops[0]["op"] in ("flag.set", "value.set"):
        r["until"] = "unit"
    r["ops"] = ops
    rows.append(r)

# ---- the objectives the game can settle by itself ----------------------
#
# A watch is put on when the objective is drawn and comes off when the
# scene closes, which is why it carries `until: unit` like anything else
# that lasts a scene: an objective nobody got to stops being watched
# without anybody saying so, and the next scene's does not inherit it.
known = {row[1] for row in T}
missing = sorted(set(WATCH) - known)
assert not missing, "WATCH names objectives that are not in the table: " + ", ".join(missing)
for row in T:
    eid = row[1]
    ops = WATCH.get(eid)
    if not ops:
        continue
    rows.append({"entry": eid, "table": "objective", "label": eid.replace("ob-", "").capitalize(), "until": "unit", "ops": ops})

# Each displacement grants 50,000 runes to help cover an upgrade or
# a level or two after a potentially difficult warp. The grant is one-way.
#
# It arrives even under Poor or Robbed, which was worth checking, since
# a displacement is drawn as a scene closes and those hold until it has.
# `player.noRuneGain` patches the site where an enemy pays out, named
# `Patches.NoRunesFromEnemies` in the tool; `runes.give` calls the game's
# own GiveRunes against player data. Two paths, and the flag is not on
# this one.
FARE = 50000

for w, eid, name, area, text in PLACES:
    rows.append({"entry": eid, "table": "displacement", "label": name,
                 "ops": [{"op": "warp.grace", "args": {"area": area, "name": name}}] + runes(FARE)})
rows.append({"entry": "dis-sky", "table": "displacement", "label": "The sky",
             "ops": [{"op": "player.drop", "args": {"height": 220}}] + runes(FARE)})

# ---- the loadout phase's own rows: a build applied and stays applied,
# and the warp that follows it --------------------------------------------
for _tier in TIER_ORDER:
    for _build_id, _title, _ops in TIER_BUILDS[_tier]:
        rows.append({"entry": loadout_entry_id(_tier, _build_id), "table": "loadout-" + _tier, "label": _title, "ops": _ops})

for _tier in TIER_ORDER:
    for _weight, _eid, _text, _state, _ops in WARP_ROWS[_tier]:
        rows.append({"entry": _eid, "table": "warp-" + _tier, "label": _ops[0]["args"]["name"], "ops": _ops})

profile = {"tool": "TarnishedTool",
           "pack": "com.scrthq.runlog.elden-ring-tarnishedtool",
           "title": "Elden Ring: TarnishedTool",
           "setup": [{"op": "flag.set", "args": {"name": "world.noCutscenes", "value": True}}],
           "rows": rows}
io.open(os.path.join(here, "elden-ring-tarnishedtool.json"), "w", encoding="utf-8", newline="").write(json.dumps(profile, indent=2) + "\n")

print("curse %d (%d driven), objective %d, blessing %d, displacement %d, states %d, profile rows %d"
      % (len(I), sum(1 for r in I if r[4]), len(T), len(B), len(displacement), len(states), len(rows)))
