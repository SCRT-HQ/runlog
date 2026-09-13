"""Build Elden Ring: TarnishedTool's states, tables and control profile
from one source.

Run it from anywhere: python packs/profiles/build-tarnishedtool.py


Each curse row is (weight, id, text, state, ops). `state` is
(id, label, short, description) or None; `ops` is what a tool does about
it, or None for a vow that only the player enforces.
"""
import io, json, os, re, textwrap

def wrap(text, indent):
    return [" " * indent + l for l in textwrap.wrap(text, 68 - indent)]

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

# ---- curse: what is wrong with the world for one scene --------
# Everything here is adverse, or at worst weather. There is nothing good
# in this table: a reward you rolled into by accident is not a reward,
# and the blessing table below is where being paid belongs.
I = [
    # Slower, faster, frailer, feebler.
    (3, "cu-slow", "Your legs are heavy. You move at four fifths.", S("slowed", "Slowed", "SLOW", "You move at four fifths."), val("player.speed", 0.8)),
    (2, "cu-wade", "You are wading. Two thirds speed, everywhere, all scene.", S("wading", "Wading", "WADE", "You move at two thirds."), val("player.speed", 0.66)),
    (1, "cu-mired", "Mired. Half speed, and everything in this game is faster than you.", S("mired", "Mired", "MIRE", "You move at half speed."), val("player.speed", 0.5)),
    (3, "cu-quick", "The world is hurried. Everything but you runs a fifth faster.", S("hurried", "Hurried", "FAST", "The world runs a fifth faster."), val("game.speed", 1.2)),
    (2, "cu-frantic", "The world is frantic. Half again as fast as it should be.", S("frantic", "Frantic", "MANC", "The world runs half again as fast."), val("game.speed", 1.5)),
    (1, "cu-berserk", "The world has lost its mind. Everything at nearly double speed.", S("berserk", "Berserk", "BSRK", "The world runs at nearly double speed."), val("game.speed", 1.75)),
    (2, "cu-slower", "Everything slows, you included. The world at four fifths.", S("sluggish", "Sluggish", "DRAG", "The whole world at four fifths."), val("game.speed", 0.8)),
    (3, "cu-tender", "You bruise. Half again the damage from everything.", S("tender", "Tender", "TEND", "You take half again the damage."), val("player.incomingDamage", 1.5)),
    (3, "cu-glass", "You are glass. Everything that touches you hits twice as hard.", S("glass", "Glass", "GLAS", "Everything hits twice as hard."), val("player.incomingDamage", 2)),
    (1, "cu-paper", "You are paper. Three times damage, and you will feel all of it.", S("paper", "Paper", "PAPR", "Everything hits three times as hard."), val("player.incomingDamage", 3)),
    (3, "cu-blunt", "Your weapons are blunt. A little over half of what you should deal.", S("blunted", "Blunted", "BLNT", "You deal three fifths damage."), val("player.outgoingDamage", 0.6)),
    (2, "cu-dull", "Your weapons are dull. Two fifths, and everything takes twice as long.", S("dulled", "Dulled", "DULL", "You deal two fifths damage."), val("player.outgoingDamage", 0.4)),
    (1, "cu-useless", "Your weapons are useless. A quarter damage. Consider running.", S("useless", "Useless", "USLS", "You deal a quarter damage."), val("player.outgoingDamage", 0.25)),
    # What you are made of, taken away.
    (2, "cu-hollow", "Hollow. Your vigor is one for the scene; everything kills you.", S("hollow", "Hollow", "HOLW", "Vigor is one."), val("player.vigor", 1)),
    (2, "cu-feeble", "Feeble. Your strength is one, and half of what you carry is unusable.", S("feeble", "Feeble", "FEEB", "Strength is one."), val("player.strength", 1)),
    (2, "cu-clumsy", "Clumsy. Your dexterity is one; hope you were not built for it.", S("clumsy", "Clumsy", "CLMS", "Dexterity is one."), val("player.dexterity", 1)),
    (2, "cu-winded", "Winded. Your endurance is one. Two swings and a roll, if that.", S("winded", "Winded", "ENDR", "Endurance is one."), val("player.endurance", 1)),
    (1, "cu-empty", "Empty. Your mind is one. Whatever you cast, you do not, now.", S("empty", "Empty", "MIND", "Mind is one."), val("player.mind", 1)),
    # Money and sight.
    (3, "cu-poor", "Nothing is owed to you. No runes from anything that dies.", S("poor", "Poor", "POOR", "No runes from anything."), flag("player.noRuneGain")),
    (2, "cu-robbed", "Robbed. Ten thousand gone now, and nothing earned this scene is yours either.", S("robbed", "Robbed", "ROBD", "Ten thousand taken, and no runes earned."), runes(-10000) + flag("player.noRuneGain")),
    (2, "cu-toll", "A toll. Ten thousand runes, taken, whether you had them or not.", None, runes(-10000)),
    (2, "cu-lost", "No map. You cannot open it this scene; go by landmark.", S("mapless", "Mapless", "LOST", "The map cannot be opened."), flag("world.hideMap")),
    (1, "cu-unseen-world", "Nothing renders. You can see the world and nothing living in it.", S("blind", "Blind", "BLND", "Characters are not drawn."), flag("world.hideCharacters")),
    # What the dead do.
    (3, "cu-risen", "The dead get up. Nothing you kill this scene stays down.", S("risen", "The risen", "RISE", "Nothing you kill stays dead."), flag("enemies.noDeath")),
    (2, "cu-stone", "Nothing here can be hurt. Kill nothing; go around.", S("stone", "Unkillable", "STON", "Nothing can be damaged."), flag("enemies.noDamage")),
    (3, "cu-root", "You cannot dodge. No rolling this scene, at all.", S("rooted", "Rooted", "ROOT", "No rolling."), flag("player.noRoll")),
    # Weather is not a kindness or a cruelty. It is weather. Each
    # carries a badge so the board says what this scene is like,
    # though the weather itself outlives the badge: nothing puts the sun
    # back up, and the next thing to change it is the next draw.
    (2, "cu-night", "Night falls, now, wherever you are.", S("nightfall", "Night", "NGHT", "Night fell on this scene. The dark outlives it; the badge does not."), press("SetNight")),
    (2, "cu-dusk", "Dusk, and the light going.", S("dusk", "Dusk", "DUSK", "Dusk came on this scene."), press("SetDusk")),
    (1, "cu-noon", "Noon, whether it suits you or not.", S("noon", "Noon", "NOON", "Noon, on this scene."), press("SetNoon")),
    (1, "cu-morning", "Morning. The light comes back, for what it is worth.", S("morning", "Morning", "MORN", "Morning came on this scene."), press("SetMorning")),
    (2, "cu-fog", "Fog rolls in and stays.", S("fog", "Fog", "FOG", "Fog came in on this scene."), press("FoggyWeather")),
    (2, "cu-rain", "Rain, for the whole scene.", S("rain", "Rain", "RAIN", "Rain, for this scene."), press("RainyWeather")),
    (2, "cu-snow", "Snow, wherever you happen to be.", S("snow", "Snow", "SNOW", "Snow, on this scene."), press("SnowyWeather")),
    (1, "cu-clear", "Clear skies, for once. Which means everything can see you.", S("clear", "Clear", "CLR", "Clear skies on this scene, and nothing to hide behind."), press("DefaultWeather")),
    # What is left of the vows.
    #
    # There were twenty-four, and nothing enforced any of them: a vow is
    # a thing a runner agrees to and then remembers, or does not, and a
    # pack written for a tool has no business asking. One of them turned
    # out to be enforceable after all, and it is here. The rest are gone,
    # replaced below by things this build can actually do.
    (3, "cu-alone", "Alone. Whatever you had in the ash slot is out of it, and stays out.", S("alone", "Alone", "ALON", "No Spirit Ash."), val("player.spiritAsh", 0)),

    # The rest of what the tool can reach and the table had not asked for.
    # Three stats the pack had left alone while curses existed for the
    # other five, a journey nobody chose, a frame rate, and gravity.
    (2, "cu-witless", "Witless. Your intelligence is one; whatever you were going to cast, you are not.", S("witless", "Witless", "INTL", "Intelligence is one."), val("player.intelligence", 1)),
    (2, "cu-faithless", "Faithless. Your faith is one, and nothing is listening anyway.", S("faithless", "Faithless", "FTH", "Faith is one."), val("player.faith", 1)),
    (2, "cu-luckless", "Luckless. Your arcane is one. Nothing bleeds, nothing drops, nothing goes your way.", S("luckless", "Luckless", "ARC", "Arcane is one."), val("player.arcane", 1)),
    (1, "cu-journey", "A harder world. The journey goes up one for the scene; everything hits like it is somebody else's run.", S("further", "Further on", "NG+", "The journey is one higher."), val("player.newGame", 1)),
    (2, "cu-slideshow", "Thirty frames. You will feel every one of them.", S("stutter", "Stutter", "30FPS", "Thirty frames a second."), val("game.fps", 30)),
    (1, "cu-flicker", "Twenty frames, which is not a frame rate, it is a warning.", S("flicker", "Flicker", "20FPS", "Twenty frames a second."), val("game.fps", 20)),
    (1, "cu-float", "Gravity lets go. Mind the ceiling, and mind the landing.", S("weightless", "Weightless", "FLOT", "No gravity."), flag("player.noGravity")),
    (2, "cu-fixed", "Your health is pinned where it is. No healing it, no losing it slowly: whatever hits you takes it all or none.", S("pinned", "Pinned", "LOCK", "Health is locked."), flag("player.lockHp")),
    (2, "cu-calm", "Nothing at all. Ten quiet minutes; use them.", None, None),
]

# ---- objective: what the scene is for -----------------------------------
T = [
    (4, "ob-near", "Whatever holds the nearest ruin, cave, catacomb or camp. Name it and kill it.", 3, []),
    (3, "ob-boss", "A named boss of wherever you have landed. Name it, find it, put it down.", 5, ["hard"]),
    (2, "ob-field", "A field boss out in the open. The kind with a health bar and no door.", 4, []),
    (2, "ob-again", "A boss you have already beaten, again, at whatever it costs.", 4, ["hard"]),
    (2, "ob-gaol", "An evergaol. Name one, open it, and finish what is inside.", 4, ["hard"]),
    (2, "ob-tunnel", "A mine or tunnel, all the way to whatever is at the end.", 4, ["hard"]),
    (2, "ob-catacomb", "A catacomb, to the bottom, including the thing at the bottom.", 4, ["hard"]),
    (2, "ob-cave", "A cave, to the bottom, including whatever lives there.", 3, []),
    (2, "ob-tunnel-boss", "A mine. Down to the bottom and through whatever is guarding the ore.", 4, ["hard"]),
    (3, "ob-knight", "A knight. Any of the big armored ones, wherever you are.", 3, []),
    (2, "ob-dragon", "Something enormous. A dragon, a giant, a troll. Name it.", 5, ["hard"]),
    (2, "ob-invader", "A hostile NPC. Whoever invades, or whoever you go and invade.", 3, []),
    (2, "ob-beast", "A great beast: a lion, a bear, a crab, a pack of wolves that will not come one at a time.", 3, []),
    (3, "ob-three", "Three of a kind. Pick an enemy type you can see and kill three.", 2, []),
    (3, "ob-five", "Five of a kind. Pick a type and count to five.", 3, []),
    (1, "ob-ten", "Ten of a kind. Yes, ten. Pick something common.", 5, ["hard"]),
    (2, "ob-camp", "Clear a camp. Every enemy in one encampment, to the last.", 4, ["hard"]),
    (2, "ob-building", "Clear a building. Everything inside one structure, top to bottom.", 3, []),
    (2, "ob-patrol", "A patrol. Follow it to the end of its round, then kill all of it where it stops.", 3, []),
    (1, "ob-night", "Something that only comes out at night. Wait for it if you must.", 5, ["hard"]),
    (3, "ob-church", "A church you have not been inside. Find one, get to the altar, and take what is on it.", 3, []),
    # Each of these names one kind of thing, because a kind is what the
    # game files as an event and so what can be settled without being
    # asked. "Something useful" is not an objective; a Bell Bearing is.
    (2, "ob-key", "A key item. A stonesword key, a whetblade, a medallion half, a cipher: something a door or a map wants.", 3, []),
    (2, "ob-map", "A map fragment, so the next region stops being a rumour. Name which one before you go.", 3, []),
    (2, "ob-seed", "A Golden Seed or a Sacred Tear. Either will do; name which before you set off.", 3, []),
    (2, "ob-cookbook", "A cookbook. Any of them, anywhere: the crafting is not the point, the finding is.", 3, []),
    (2, "ob-bearing", "A Bell Bearing. Off a body, out of a chest, or off whatever is holding it.", 3, []),
    (2, "ob-tear", "A Crystal Tear, from the trunk of a Minor Erdtree or wherever else one is standing.", 3, []),
    (2, "ob-stone", "Smithing stones, three of them, of any kind. Count them out loud.", 2, []),
    (2, "ob-talisman", "A talisman you do not own. Name it and wear it out of there.", 3, []),
    (2, "ob-weapon", "A weapon you do not own, and swing it once before the scene ends.", 3, []),
    (2, "ob-ash", "An Ash of War. Take it, and put it on something before the scene ends.", 3, []),
    (2, "ob-spell", "A sorcery you do not know. Find it, and have the intelligence to read it or do not bother.", 3, []),
    (2, "ob-incant", "An incantation you do not know. Find it, and have the faith for it.", 3, []),
    (2, "ob-scarab", "A teardrop scarab. Chase one down and kill it before it gets away.", 3, []),
    (3, "ob-grace", "A grace you have never lit. Get to one and light it, however far that is.", 2, []),
    (3, "ob-erdtree", "A Minor Erdtree. Get to one and kill whatever is standing under it.", 4, ["hard"]),
    (2, "ob-cross", "Into the next region, overland. No fast travel, and arrive at a grace on the other side.", 3, []),
    (2, "ob-caravan", "A caravan. Kill what is pulling it, kill what is guarding it, and take what it was carrying.", 4, ["hard"]),
    (2, "ob-runebear", "A Runebear. Find one, fight it, and do not leave until one of you is finished.", 5, ["hard"]),
    (2, "ob-door", "An imp statue door. Find one, find a stonesword key, and take what is behind it.", 3, []),
    (2, "ob-upgrade", "Put a weapon up a tier. Find the stones for it this scene, whatever that takes.", 3, []),
    (2, "ob-rise", "A Rise. Get inside it, work out what it wants, and take what is at the top.", 4, ["hard"]),
    (2, "ob-level", "A level. Earn the runes for it this scene and spend them before it ends.", 3, []),
    (2, "ob-road", "A road. Follow it to the next grace along it and kill everything that contests the way.", 3, []),
    (2, "ob-nohit", "Whatever you name, do it without being hit once.", 6, ["hard"]),
    (2, "ob-nofla", "Whatever you name, do it without drinking anything.", 5, ["hard"]),
    (1, "ob-fast", "Whatever you name, do it in the first half of the scene.", 5, ["hard"]),
    (2, "ob-two", "One more than you were going to have. Draw again, and settle both before the scene is out.", None,
     ["hard", "TRIGGER1"]),
    (1, "ob-three-t", "Two more than you were going to have. Draw twice again. Good luck.", None, ["hard", "TRIGGER2"]),
    (3, "ob-rest", "Nothing is asked of you. Survive the scene and that is enough.", None, ["mercy"]),
    # Nothing to go back to on the first scene, so the tag keeps it
    # out of that draw rather than handing somebody an instruction with
    # no referent.
    (2, "ob-back", "Back to where the last scene started, overland, on foot or on Torrent. No fast travel.", 3, ["BEHIND"]),
]

PLACES = [
    (6, "dis-elleh", "Church of Elleh", "Limgrave", "The ruined church at the crossroads. A gentle place to be dropped."),
    (5, "dis-first", "The First Step", "Limgrave", "The cliff you started on. Begin again from here."),
    (5, "dis-gatefront", "Gatefront", "Limgrave", "The ruins at the gate, and the road north."),
    (4, "dis-artist", "Artist's Shack", "Limgrave", "A hut, a view, and something unpleasant nearby."),
    (4, "dis-pilgrim", "Church of Pilgrimage", "Weeping Peninsula", "South, past the bridge, in the rain."),
    (3, "dis-morne", "Castle Morne Rampart", "Weeping Peninsula", "The castle on the cliff, and the sea below it."),
    (5, "dis-cliffs", "Lake-Facing Cliffs", "Liurnia of the Lakes", "The long lift down, and the lake in front of you."),
    (4, "dis-shore", "Liurnia Lake Shore", "Liurnia of the Lakes", "Ankle deep, a long way from anywhere."),
    (3, "dis-scenic", "Scenic Isle", "Liurnia of the Lakes", "A small island. It is not as safe as it looks."),
    (4, "dis-stormveil", "Stormveil Main Gate", "Stormveil Castle", "At the gate of the castle, ready or not."),
    (3, "dis-gateside", "Gateside Chamber", "Stormveil Castle", "Inside the walls. Do not be seen."),
    (4, "dis-altus", "Altus Plateau", "Altus Plateau", "Up on the golden plateau, in the open."),
    (3, "dis-erdtree", "Erdtree-Gazing Hill", "Altus Plateau", "The hill with the view. Everything can see you too."),
    (3, "dis-windmill", "Windmill Village", "Altus Plateau", "The village with the dancing. Keep walking."),
    (4, "dis-smoulder", "Smoldering Church", "Caelid", "Caelid. It is red, and something is already coming."),
    (3, "dis-rotview", "Rotview Balcony", "Caelid", "Looking out over the rot, close enough to smell."),
    (2, "dis-dragon", "Cathedral of Dragon Communion", "Caelid", "The cathedral on the beach, and the hearts in it."),
    (3, "dis-gelmir", "Bridge of Iniquity", "Mt. Gelmir", "The mountain road, and the drop beside it."),
    (2, "dis-seethe", "Seethewater River", "Mt. Gelmir", "Magma, and things that live in magma."),
    (3, "dis-siofra", "Siofra River Bank", "Siofra River", "Underground, under the false stars."),
    (2, "dis-worship", "Worshippers' Woods", "Siofra River", "The woods below, where the drums are."),
    (3, "dis-ainsel", "Ainsel River Sluice Gate", "Ainsel River", "Deeper underground, where the ants are."),
    (2, "dis-volcano", "Volcano Manor", "Volcano Manor", "Inside the manor. They are polite until they are not."),
    (2, "dis-eiglay", "Temple of Eiglay", "Volcano Manor", "Deep in the manor, above the lava."),
    (3, "dis-zamor", "Zamor Ruins", "Mountaintops of the Giants", "Snow, and the ruins, and the cold."),
    (2, "dis-freezing", "Freezing Lake", "Mountaintops of the Giants", "The ice. Something large lives on it."),
    (2, "dis-rot", "Lake of Rot Shoreside", "Lake of Rot", "The worst lake there is. Move fast."),
    (2, "dis-shunning", "Underground Roadside", "Subterranean Shunning-Grounds", "Under the capital, in the sewer."),
    (2, "dis-deeproot", "Root-Facing Cliffs", "Deeproot Depths", "The roots, a very long way down."),
    (2, "dis-snowfield", "Consecrated Snowfield", "Consecrated Snowfield", "A whiteout. You cannot see what is walking towards you."),
    (2, "dis-ordina", "Ordina- Liturgical Town", "Consecrated Snowfield", "The empty town with the lights, which is not empty."),
    (1, "dis-farum", "Crumbling Beast Grave", "Crumbling Farum Azula", "The end of the world, falling upward."),
    (1, "dis-table", "Table of Lost Grace", "Roundtable Hold", "A mercy. The Roundtable, and a moment to breathe."),
]

def item(name, quantity=1):
    return [{"op": "item.named", "args": {"name": name, "quantity": quantity}}]

# ---- blessing: what settling an objective is worth -----------------------------
# Drawn when the player says they settled it, which is the only way
# anything here can know. A blessing is a reward, so nothing in it is a
# punishment and nothing is worth points.
B = [
    (3, "bl-runes", "Runes, five thousand of them, for nothing but doing as you were told.", None, runes(5000)),
    (2, "bl-runes2", "Runes, twenty thousand. Spend them before something takes them.", None, runes(20000)),
    (3, "bl-seed", "A Golden Seed. One more swallow, for the rest of the run.", None, item("Golden Seed")),
    (2, "bl-tear", "A Sacred Tear. What you have goes further now.", None, item("Sacred Tear")),
    (3, "bl-arc", "A Rune Arc, and the great rune to go with it.", None, item("Rune Arc")),
    (3, "bl-stone", "Smithing Stones, three of them, for whatever you are carrying.", None, item("Smithing Stone [3]", 3)),
    (2, "bl-somber", "A Somber Smithing Stone, for the thing you actually use.", None, item("Somber Smithing Stone [3]")),
    (2, "bl-key", "Two Stonesword Keys. Something behind an imp statue is yours.", None, item("Stonesword Key", 2)),
    (2, "bl-gold", "Golden Runes, ten of them, held for when you need them.", None, item("Golden Rune [10]", 10)),
    (2, "bl-flesh", "Exalted Flesh. Hit harder for a while; it is up to you when.", None, item("Exalted Flesh", 3)),
    (2, "bl-blessing", "Blessings of Marika, three. Healing you did not have to earn.", None, item("Blessing of Marika", 3)),
    (2, "bl-baldachin", "Baldachin's Blessing. Somebody is looking out for you.", None, item("Baldachin's Blessing", 2)),
    (2, "bl-dragon", "An Ancient Dragon's Blessing. Save it for something enormous.", None, item("Ancient Dragon's Blessing")),
    (2, "bl-fowl", "Silver-Pickled Fowl Feet. Everything is worth more for a while.", None, item("Silver-Pickled Fowl Foot", 3)),
    (2, "bl-boluses", "Neutralizing Boluses, against whatever is about to poison you.", None, item("Neutralizing Boluses", 3)),
    (2, "bl-branch", "Bewitching Branches. Make a friend of something that was not one.", None, item("Bewitching Branch", 2)),
    (2, "bl-shards", "Starlight Shards, for anyone who casts.", None, item("Starlight Shards", 3)),
    (2, "bl-grease", "Fire Grease. Put it on something and go and use it.", None, item("Fire Grease", 3)),
    (1, "bl-prawn", "Boiled Prawn. Small, and it has saved better runners than you.", None, item("Boiled Prawn", 3)),
    (1, "bl-warming", "A Warming Stone, for whatever the next scene does to you.", None, item("Warming Stone", 2)),
    (1, "bl-medallion", "A Crimson Amber Medallion. Wear it or sell it.", None, item("Crimson Amber Medallion")),
    (1, "bl-cerulean", "A Cerulean Crystal Tear, for the flask you keep forgetting.", None, item("Cerulean Crystal Tear")),
    (1, "bl-opaline", "An Opaline Bubbletear. One hit that will not land.", None, item("Opaline Bubbletear")),
    (3, "bl-mend", "You are made whole. Health, focus and flasks, all back.", None, press("SetRfbs")),
    (3, "bl-heal", "Healed to full, where you stand.", None, press("SetMaxHp")),
    (3, "bl-wind", "The next scene costs you no stamina.", S("blessed-wind", "Second wind", "WIND+", "A blessing. Stamina does not run out."), flag("player.infiniteStamina")),
    (2, "bl-focus", "The next scene costs you no focus.", S("blessed-focus", "Clear head", "FOCS+", "A blessing. FP does not run out."), flag("player.infiniteFp")),
    (3, "bl-sharp", "Your weapons bite. Double damage until the scene is out.", S("blessed-sharp", "Whetted", "SHRP+", "A blessing. Double damage."), val("player.outgoingDamage", 2)),
    (2, "bl-tough", "Nothing hurts as much. Half damage until the scene is out.", S("blessed-tough", "Warded", "WARD", "A blessing. Half damage taken."), val("player.incomingDamage", 0.5)),
    (2, "bl-luck", "Everything drops what it is carrying, for a while.", S("blessed-luck", "Fortunate", "DROP+", "A blessing. Drops are guaranteed."), flag("world.guaranteedDrop")),
    (2, "bl-quiet", "Nothing hears you for the rest of the scene.", S("blessed-quiet", "Quiet", "HUSH+", "A blessing. Nothing hears you."), flag("player.silent")),
    (2, "bl-mending", "You mend as you walk, for the rest of the scene.", S("blessed-mend", "Mending", "MEND+", "A blessing. You heal over time."), flag("player.healOverTime")),
    (1, "bl-keep", "Whatever happens next, it will not cost you runes.", S("blessed-keep", "Held", "KEEP+", "A blessing. Death costs no runes."), flag("player.noRuneLoss")),
    (1, "bl-horse", "Torrent comes when called, anywhere, for the rest of the scene.", S("blessed-horse", "Mounted", "HORS+", "A blessing. Torrent anywhere."), flag("player.torrentAnywhere")),
    (2, "bl-swift", "You are quick. A quarter faster for the rest of the scene.", S("blessed-swift", "Swift", "SWFT", "A blessing. You move a quarter faster."), val("player.speed", 1.25)),
    (2, "bl-peace", "Nothing will raise a hand to you for the rest of the scene.", S("blessed-peace", "Peace", "PEAC", "A blessing. Nothing attacks."), flag("enemies.noAttack")),
    (2, "bl-still", "Nothing moves from where it stands, for the rest of the scene.", S("blessed-still", "Stillness", "STIL", "A blessing. Nothing moves."), flag("enemies.noMove")),
    (1, "bl-asleep", "Nothing is thinking about you at all any more.", S("blessed-sleep", "Asleep", "SLEP", "A blessing. Nothing is paying attention."), flag("enemies.noAi")),
    (2, "bl-stocked", "Your pouch does not empty for the rest of the scene.", S("blessed-stock", "Stocked", "FULL", "A blessing. Consumables are not used up."), flag("player.infiniteConsumables")),
    (1, "bl-quiver", "Your quiver does not empty for the rest of the scene.", S("blessed-ammo", "Quivered", "AMMO", "A blessing. Arrows are not used up."), flag("player.infiniteArrows")),
    (2, "bl-anchored", "Nothing staggers you for the rest of the scene.", S("blessed-poise", "Anchored", "POIS", "A blessing. You cannot be staggered."), flag("player.infinitePoise")),
    (1, "bl-unseen", "Nothing sees you for the rest of the scene.", S("blessed-unseen", "Unseen", "DARK", "A blessing. Nothing sees you."), flag("player.hidden")),
    (1, "bl-lethal", "For the rest of this scene, anything you hit dies.", S("blessed-lethal", "Dreadful", "KILL+", "A blessing. Anything you hit dies."), flag("player.oneShot")),
]

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
displacement.append((2, "dis-sky", "The sky. You are lifted a few hundred feet above wherever you were standing, and then you are not lifted any more.", None, None))

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
               "Drawn at the top of every scene, and it holds until the scene ends. Some of these a tool does to the game; the rest are vows, which nothing enforces but you. How many are drawn is Curses per scene, a dial in the trackers: one is a game, two is unpleasant, four is a different game. Nothing in here is good for you, which is the point of it. A kindness you rolled into by accident is not a reward, and being paid is what the Blessing table is for. None are worth points either, since a curse lands on everyone.",
               built_i, i_extra)
tables += "\n" + table("objective", "Objective",
                       "What the scene is for. Drawn after the curse, so you know what is wrong with the world before you are told what to do in it. Name the objective in your own words: the app cannot see your game, and the log should read like something that happened. How many are drawn is Objectives per scene, the other dial in the trackers. Two results in here add one and two more on top of whatever it says.",
                       built_t, t_extra)
tables += "\n" + table("blessing", "Blessing",
                       "What settling an objective is worth. Drawn when you say you settled it, which is the only way anything here can know. Nothing in it is a punishment and nothing is worth points: the points were on the objective.",
                       built_b, b_extra)
tables += "\n" + table("displacement", "Displacement",
                       "Every fourth scene the Lands Between are done with you where you are. Drawn as a scene closes and taken before the next one opens. A tool does the moving: these are real places by name, and most of them are somewhere you would not have chosen.",
                       built_d, d_extra)

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(os.path.dirname(here))
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

# Fare for the journey. A displacement can put somebody twenty levels
# out of their depth with no way back but the walk, so every landing
# pays: fifty thousand is a weapon upgrade or a level or two, which is
# the difference between a scene and a death sentence. One way, like
# every grant, and paid whether or not the place turns out to be kind.
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

profile = {"tool": "TarnishedTool",
           "pack": "com.scrthq.runlog.elden-ring-tarnishedtool",
           "title": "Elden Ring: TarnishedTool",
           "setup": [{"op": "flag.set", "args": {"name": "world.noCutscenes", "value": True}}],
           "rows": rows}
io.open(os.path.join(here, "elden-ring-tarnishedtool.json"), "w", encoding="utf-8", newline="").write(json.dumps(profile, indent=2) + "\n")

print("curse %d (%d driven), objective %d, blessing %d, displacement %d, states %d, profile rows %d"
      % (len(I), sum(1 for r in I if r[4]), len(T), len(B), len(displacement), len(states), len(rows)))
