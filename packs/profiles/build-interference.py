"""Build Interference's states, tables and control profile from one source.

Run it from anywhere: python packs/profiles/build-interference.py


Each interference row is (weight, id, text, state, ops). `state` is
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

def press(action):
    return [{"op": "action.invoke", "args": {"action": action}}]

S = lambda i, l, sh, d: (i, l, sh, d)

# ---- interference: what is wrong with the world for one stretch --------
I = [
    # Slower, faster, frailer, feebler.
    (3, "in-slow", "Your legs are heavy. You move at four fifths.", S("slowed", "Slowed", "SLOW", "You move at four fifths."), val("player.speed", 0.8)),
    (2, "in-wade", "You are wading. Two thirds speed, everywhere, all stretch.", S("wading", "Wading", "WADE", "You move at two thirds."), val("player.speed", 0.66)),
    (2, "in-swift", "A mercy. You move a quarter faster.", S("swift", "Swift", "SWFT", "A mercy. You move a quarter faster."), val("player.speed", 1.25)),
    (3, "in-quick", "The world is hurried. Everything but you runs a fifth faster.", S("hurried", "Hurried", "FAST", "The world runs a fifth faster."), val("game.speed", 1.2)),
    (2, "in-frantic", "The world is frantic. Half again as fast as it should be.", S("frantic", "Frantic", "MANC", "The world runs half again as fast."), val("game.speed", 1.5)),
    (2, "in-slower", "Everything slows, you included. The world at four fifths.", S("sluggish", "Sluggish", "DRAG", "The whole world at four fifths."), val("game.speed", 0.8)),
    (3, "in-glass", "You are glass. Everything that touches you hits twice as hard.", S("glass", "Glass", "GLAS", "Everything hits twice as hard."), val("player.incomingDamage", 2)),
    (2, "in-paper", "You are paper. Three times damage, and you will feel all of it.", S("paper", "Paper", "PAPR", "Everything hits three times as hard."), val("player.incomingDamage", 3)),
    (3, "in-blunt", "Your weapons are blunt. A little over half of what you should deal.", S("blunted", "Blunted", "BLNT", "You deal three fifths damage."), val("player.outgoingDamage", 0.6)),
    (2, "in-dull", "Your weapons are dull. Two fifths, and everything takes twice as long.", S("dulled", "Dulled", "DULL", "You deal two fifths damage."), val("player.outgoingDamage", 0.4)),
    (1, "in-sharp", "A mercy. You hit twice as hard as you should.", S("sharp", "Sharpened", "SHRP", "A mercy. You deal double damage."), val("player.outgoingDamage", 2)),
    (1, "in-oneshot", "A mercy, and a strange one. Everything dies to one hit.", S("lethal", "Lethal", "KILL", "A mercy. Anything you hit dies."), flag("player.oneShot")),
    # What the dead do.
    (3, "in-risen", "The dead get up. Nothing you kill this stretch stays down.", S("risen", "The risen", "RISE", "Nothing you kill stays dead."), flag("enemies.noDeath")),
    (2, "in-stone", "Nothing here can be hurt. Kill nothing; go around.", S("stone", "Unkillable", "STON", "Nothing can be damaged."), flag("enemies.noDamage")),
    (2, "in-peace", "A mercy. Nothing will raise a hand to you.", S("peace", "Peace", "PEAC", "A mercy. Nothing attacks."), flag("enemies.noAttack")),
    (2, "in-still", "A mercy. Nothing here moves from where it stands.", S("still", "Stillness", "STIL", "A mercy. Nothing moves."), flag("enemies.noMove")),
    (1, "in-asleep", "A mercy. Nothing is thinking about you at all.", S("asleep", "Asleep", "SLEP", "A mercy. Nothing is paying attention."), flag("enemies.noAi")),
    # Movement and dodging.
    (3, "in-root", "You cannot dodge. No rolling this stretch, at all.", S("rooted", "Rooted", "ROOT", "No rolling."), flag("player.noRoll")),
    # Money.
    (3, "in-poor", "Nothing is owed to you. No runes from anything that dies.", S("poor", "Poor", "POOR", "No runes from anything."), flag("player.noRuneGain")),
    (2, "in-spared", "A mercy. You lose no runes if you die this stretch.", S("insured", "Insured", "KEEP", "A mercy. Death costs no runes."), flag("player.noRuneLoss")),
    # Comfort.
    (2, "in-wind", "A mercy. Your stamina does not run out.", S("tireless", "Tireless", "WIND", "A mercy. Stamina does not run out."), flag("player.infiniteStamina")),
    (2, "in-well", "A mercy. Your focus does not run out.", S("focused", "Focused", "FOCS", "A mercy. FP does not run out."), flag("player.infiniteFp")),
    (2, "in-full", "A mercy. Your pouch does not empty.", S("stocked", "Stocked", "FULL", "A mercy. Consumables are not used up."), flag("player.infiniteConsumables")),
    (1, "in-quiver", "A mercy. Your quiver does not empty.", S("quivered", "Quivered", "AMMO", "A mercy. Arrows are not used up."), flag("player.infiniteArrows")),
    (2, "in-mend", "A mercy. You heal slowly, on your own, the whole stretch.", S("mending", "Mending", "MEND", "A mercy. You heal over time."), flag("player.healOverTime")),
    (1, "in-anchored", "A mercy. Nothing staggers you.", S("anchored", "Anchored", "POIS", "A mercy. You cannot be staggered."), flag("player.infinitePoise")),
    (2, "in-hush", "A mercy. Nothing hears you coming this stretch.", S("unheard", "Unheard", "HUSH", "A mercy. Nothing hears you."), flag("player.silent")),
    (1, "in-unseen", "A mercy. Nothing sees you either.", S("unseen", "Unseen", "DARK", "A mercy. Nothing sees you."), flag("player.hidden")),
    (1, "in-lucky", "A mercy. Everything drops what it has.", S("lucky", "Lucky", "DROP", "A mercy. Drops are guaranteed."), flag("world.guaranteedDrop")),
    (1, "in-horse", "A mercy. Torrent comes when called, anywhere.", S("mounted", "Mounted", "HORS", "A mercy. Torrent is available anywhere."), flag("player.torrentAnywhere")),
    # The world itself.
    (2, "in-lost", "No map. You cannot open it this stretch; go by landmark.", S("mapless", "Mapless", "LOST", "The map cannot be opened."), flag("world.hideMap")),
    (2, "in-night", "Night falls, now, wherever you are.", None, press("SetNight")),
    (2, "in-dusk", "Dusk, and the light going.", None, press("SetDusk")),
    (2, "in-noon", "Noon, whether it suits you or not.", None, press("SetNoon")),
    (1, "in-morning", "Morning. The light comes back.", None, press("SetMorning")),
    (2, "in-fog", "Fog rolls in and stays.", None, press("FoggyWeather")),
    (2, "in-rain", "Rain, for the whole stretch.", None, press("RainyWeather")),
    (2, "in-snow", "Snow, wherever you happen to be.", None, press("SnowyWeather")),
    (1, "in-clear", "A mercy. Clear skies, for once.", None, press("DefaultWeather")),
    # Vows: nothing enforces these but you.
    (3, "vo-stay", "Do not leave this region. Whatever you meant to do elsewhere, do it here.", S("bound", "Bound", "STAY", "Do not leave this region."), None),
    (3, "vo-alone", "Alone. No summons and no Spirit Ashes.", S("alone", "Alone", "ALON", "No summons, no Spirit Ashes."), None),
    (3, "vo-naked", "Unequip your armor, all four slots.", S("bare", "Bare", "BARE", "No armor, all four slots."), None),
    (3, "vo-noshield", "Nothing in the left hand but a weapon, a catalyst, or air.", S("openhanded", "Open-handed", "OPEN", "Nothing in the left hand."), None),
    (3, "vo-noflask", "No Crimson Tears. Whatever you have, you keep.", S("thirsty", "Thirsty", "DRY", "No Crimson Tears."), None),
    (2, "vo-notears", "No flasks at all, of either colour.", S("parched", "Parched", "NONE", "No flasks of any kind."), None),
    (2, "vo-nolock", "No lock-on. Aim by hand.", S("unaimed", "Unaimed", "FREE", "No lock-on."), None),
    (2, "vo-walk", "Walk. No sprinting and no Torrent.", S("afoot", "Afoot", "WALK", "No sprinting, no Torrent."), None),
    (2, "vo-onehand", "One weapon, and no swapping it.", S("committed", "Committed", "ONE", "One weapon, no swapping."), None),
    (2, "vo-nojump", "No jumping, and no jump attacks.", S("grounded", "Grounded", "DOWN", "No jumping."), None),
    (2, "vo-noitem", "No consumables of any kind. Nothing from the pouch.", S("frugal", "Frugal", "POCK", "No consumables."), None),
    (2, "vo-noblock", "No blocking. Dodge it or wear it.", S("unguarded", "Unguarded", "NOBL", "No blocking."), None),
    (2, "vo-melee", "Nothing at range. No bows, no thrown, no spells from afar.", S("close", "Close quarters", "MELE", "Nothing at range."), None),
    (2, "vo-nomagic", "No spells and no incantations, whatever you are built for.", S("mundane", "Mundane", "MUND", "No spells or incantations."), None),
    (2, "vo-noskill", "No Ashes of War and no weapon skills.", S("plain", "Plain", "SKIL", "No Ashes of War or skills."), None),
    (2, "vo-norest", "Do not rest at a grace. Not once.", S("restless", "Restless", "REST", "No resting at graces."), None),
    (2, "vo-nolevel", "No levelling, no upgrading, no spending anything.", S("unspent", "Unspent", "SPND", "Nothing spent, nothing upgraded."), None),
    (2, "vo-notravel", "No fast travel. Ride or walk wherever you are going.", S("overland", "Overland", "TRVL", "No fast travel."), None),
    (2, "vo-fight", "Fight what you wake. Nothing you aggro may be left behind.", S("standing", "Standing", "FGHT", "Nothing you aggro is left behind."), None),
    (1, "vo-twohand", "Two hands on one weapon, the whole stretch.", S("twohanded", "Two-handed", "BOTH", "Two hands on one weapon."), None),
    (2, "in-calm", "Nothing at all. Ten quiet minutes; use them.", None, None),
]

# ---- target: what the stretch is for -----------------------------------
T = [
    (4, "ta-near", "Whatever holds the nearest ruin, cave, catacomb or camp. Name it and kill it.", 3, []),
    (3, "ta-boss", "A named boss of wherever you have landed. Name it, find it, put it down.", 5, ["hard"]),
    (2, "ta-field", "A field boss out in the open. The kind with a health bar and no door.", 4, []),
    (2, "ta-again", "A boss you have already beaten, again, at whatever it costs.", 4, ["hard"]),
    (2, "ta-gaol", "An evergaol. Name one, open it, and finish what is inside.", 4, ["hard"]),
    (2, "ta-tunnel", "A mine or tunnel, all the way to whatever is at the end.", 4, ["hard"]),
    (2, "ta-catacomb", "A catacomb, to the bottom, including the thing at the bottom.", 4, ["hard"]),
    (2, "ta-cave", "A cave, to the bottom, including whatever lives there.", 3, []),
    (2, "ta-tower", "A tower. Get to the top of it and take what is there.", 3, []),
    (3, "ta-knight", "A knight. Any of the big armored ones, wherever you are.", 3, []),
    (2, "ta-dragon", "Something enormous. A dragon, a giant, a troll. Name it.", 5, ["hard"]),
    (2, "ta-invader", "A hostile NPC. Whoever invades, or whoever you go and invade.", 3, []),
    (2, "ta-beast", "Something bestial. A bear, a lion, a wolf pack, a crab.", 3, []),
    (3, "ta-three", "Three of a kind. Pick an enemy type you can see and kill three.", 2, []),
    (3, "ta-five", "Five of a kind. Pick a type and count to five.", 3, []),
    (1, "ta-ten", "Ten of a kind. Yes, ten. Pick something common.", 5, ["hard"]),
    (2, "ta-camp", "Clear a camp. Every enemy in one encampment, to the last.", 4, ["hard"]),
    (2, "ta-building", "Clear a building. Everything inside one structure, top to bottom.", 3, []),
    (2, "ta-patrol", "A patrol. Follow it to wherever it is going, then end it.", 3, []),
    (1, "ta-night", "Something that only comes out at night. Wait for it if you must.", 5, ["hard"]),
    (3, "ta-item", "Something worth having. Name an item you can see on the map or in the world, and come away with it.", 2, []),
    (2, "ta-key", "A key item: a stonesword key, a whetblade, a medallion half. Name one and take it.", 3, []),
    (2, "ta-map", "A map fragment. Name which one and go and get it.", 3, []),
    (2, "ta-seed", "A Golden Seed or a Sacred Tear. Either will do; name it first.", 3, []),
    (2, "ta-stone", "Smithing stones, three of them, of any kind.", 2, []),
    (2, "ta-talisman", "A talisman you do not own. Name it and wear it out of there.", 3, []),
    (2, "ta-weapon", "A weapon you do not own, and swing it once before the stretch ends.", 3, []),
    (2, "ta-ash", "An Ash of War, or a Spirit Ash. Name it and take it.", 3, []),
    (2, "ta-spell", "A spell or incantation you do not know.", 3, []),
    (1, "ta-cookbook", "A cookbook. Any cookbook. Somebody wrote it down for a reason.", 2, []),
    (3, "ta-grace", "A grace you do not have. Name it and light it.", 2, []),
    (2, "ta-far", "A landmark you can see from where you stand. Name it and stand on it.", 2, []),
    (2, "ta-cross", "Cross something: a bridge, a lake, a chasm, a border into the next region.", 2, []),
    (2, "ta-high", "The highest thing you can see. Get on top of it.", 3, []),
    (2, "ta-deep", "Go underground. Name a cave, tomb or tunnel and reach the bottom.", 4, ["hard"]),
    (2, "ta-door", "An event. A sealed door opened, a lift ridden, a seal broken, a brazier lit.", 3, []),
    (2, "ta-merchant", "Find somebody to talk to. A merchant, an NPC, anyone alive and willing.", 2, []),
    (2, "ta-summon", "A summon sign on the ground, or a hostile one. Use it either way.", 3, []),
    (1, "ta-message", "Leave a message on the ground somewhere it will actually help.", 1, []),
    (1, "ta-gesture", "Use a gesture at a statue, a grave, or a corpse that seems to deserve it.", 1, []),
    (2, "ta-nohit", "Whatever you name, do it without being hit once.", 6, ["hard"]),
    (2, "ta-nofla", "Whatever you name, do it without drinking anything.", 5, ["hard"]),
    (1, "ta-fast", "Whatever you name, do it in the first half of the stretch.", 5, ["hard"]),
    (2, "ta-two", "Two targets. Draw again twice, and settle both before the stretch is out.", None,
     ["hard", "TRIGGER2"]),
    (1, "ta-three-t", "Three targets. Draw again three times. Good luck.", None, ["hard", "TRIGGER3"]),
    (3, "ta-rest", "Nothing is asked of you. Survive the stretch and that is enough.", None, ["mercy"]),
    (2, "ta-choose", "Your choice. Name anything that will take most of the stretch, and do it.", 3, []),
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

# ---- boon: what settling a target is worth -----------------------------
# Drawn when the player says they settled it, which is the only way
# anything here can know. A boon is a reward, so nothing in it is a
# punishment and nothing is worth points.
B = [
    (3, "bo-runes", "Runes, five thousand of them, for nothing but doing as you were told.", None, [{"op": "value.add", "args": {"name": "player.runes", "by": 5000}}]),
    (2, "bo-runes2", "Runes, twenty thousand. Spend them before something takes them.", None, [{"op": "value.add", "args": {"name": "player.runes", "by": 20000}}]),
    (3, "bo-seed", "A Golden Seed. One more swallow, for the rest of the run.", None, item("Golden Seed")),
    (2, "bo-tear", "A Sacred Tear. What you have goes further now.", None, item("Sacred Tear")),
    (3, "bo-arc", "A Rune Arc, and the great rune to go with it.", None, item("Rune Arc")),
    (3, "bo-stone", "Smithing Stones, three of them, for whatever you are carrying.", None, item("Smithing Stone [3]", 3)),
    (2, "bo-somber", "A Somber Smithing Stone, for the thing you actually use.", None, item("Somber Smithing Stone [3]")),
    (2, "bo-key", "Two Stonesword Keys. Something behind an imp statue is yours.", None, item("Stonesword Key", 2)),
    (2, "bo-gold", "Golden Runes, ten of them, held for when you need them.", None, item("Golden Rune [10]", 10)),
    (2, "bo-flesh", "Exalted Flesh. Hit harder for a while; it is up to you when.", None, item("Exalted Flesh", 3)),
    (2, "bo-blessing", "Blessings of Marika, three. Healing you did not have to earn.", None, item("Blessing of Marika", 3)),
    (2, "bo-baldachin", "Baldachin's Blessing. Somebody is looking out for you.", None, item("Baldachin's Blessing", 2)),
    (2, "bo-dragon", "An Ancient Dragon's Blessing. Save it for something enormous.", None, item("Ancient Dragon's Blessing")),
    (2, "bo-fowl", "Silver-Pickled Fowl Feet. Everything is worth more for a while.", None, item("Silver-Pickled Fowl Foot", 3)),
    (2, "bo-boluses", "Neutralizing Boluses, against whatever is about to poison you.", None, item("Neutralizing Boluses", 3)),
    (2, "bo-branch", "Bewitching Branches. Make a friend of something that was not one.", None, item("Bewitching Branch", 2)),
    (2, "bo-shards", "Starlight Shards, for anyone who casts.", None, item("Starlight Shards", 3)),
    (2, "bo-grease", "Fire Grease. Put it on something and go and use it.", None, item("Fire Grease", 3)),
    (1, "bo-prawn", "Boiled Prawn. Small, and it has saved better runners than you.", None, item("Boiled Prawn", 3)),
    (1, "bo-warming", "A Warming Stone, for whatever the next stretch does to you.", None, item("Warming Stone", 2)),
    (1, "bo-medallion", "A Crimson Amber Medallion. Wear it or sell it.", None, item("Crimson Amber Medallion")),
    (1, "bo-cerulean", "A Cerulean Crystal Tear, for the flask you keep forgetting.", None, item("Cerulean Crystal Tear")),
    (1, "bo-opaline", "An Opaline Bubbletear. One hit that will not land.", None, item("Opaline Bubbletear")),
    (3, "bo-mend", "You are made whole. Health, focus and flasks, all back.", None, press("SetRfbs")),
    (3, "bo-heal", "Healed to full, where you stand.", None, press("SetMaxHp")),
    (3, "bo-wind", "The next stretch costs you no stamina.", S("blessed-wind", "Second wind", "WIND+", "A boon. Stamina does not run out."), flag("player.infiniteStamina")),
    (2, "bo-focus", "The next stretch costs you no focus.", S("blessed-focus", "Clear head", "FOCS+", "A boon. FP does not run out."), flag("player.infiniteFp")),
    (3, "bo-sharp", "Your weapons bite. Double damage until the stretch is out.", S("blessed-sharp", "Whetted", "SHRP+", "A boon. Double damage."), val("player.outgoingDamage", 2)),
    (2, "bo-tough", "Nothing hurts as much. Half damage until the stretch is out.", S("blessed-tough", "Warded", "WARD", "A boon. Half damage taken."), val("player.incomingDamage", 0.5)),
    (2, "bo-luck", "Everything drops what it is carrying, for a while.", S("blessed-luck", "Fortunate", "DROP+", "A boon. Drops are guaranteed."), flag("world.guaranteedDrop")),
    (2, "bo-quiet", "Nothing hears you for the rest of the stretch.", S("blessed-quiet", "Quiet", "HUSH+", "A boon. Nothing hears you."), flag("player.silent")),
    (2, "bo-mending", "You mend as you walk, for the rest of the stretch.", S("blessed-mend", "Mending", "MEND+", "A boon. You heal over time."), flag("player.healOverTime")),
    (1, "bo-keep", "Whatever happens next, it will not cost you runes.", S("blessed-keep", "Held", "KEEP+", "A boon. Death costs no runes."), flag("player.noRuneLoss")),
    (1, "bo-horse", "Torrent comes when called, anywhere, for the rest of the stretch.", S("blessed-horse", "Mounted", "HORS+", "A boon. Torrent anywhere."), flag("player.torrentAnywhere")),
    (1, "bo-lethal", "For the rest of this stretch, anything you hit dies.", S("blessed-lethal", "Dreadful", "KILL+", "A boon. Anything you hit dies."), flag("player.oneShot")),
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
    state, ops = row[3], row[4]
    tags = ["interference"]
    if "mercy" in row[2].lower() or row[1] == "in-calm":
        tags = ["mercy"]
    tags.append("effect" if ops else "vow")
    lines = ["tags: [" + ", ".join(tags) + "]"]
    if state:
        lines.append("grants: [" + state[0] + "]")
    return lines

def t_extra(row):
    points, tags = row[3], list(row[4])
    lines = []
    trigger = None
    for t in list(tags):
        if t.startswith("TRIGGER"):
            trigger = int(t[-1])
            tags.remove(t)
    lines.append("tags: [" + ", ".join(["target"] + tags) + "]")
    if points:
        lines.append(f"points: {points}")
    if trigger:
        lines += ["triggers:", "  - on: immediately", "    do:"]
        lines += ["      - { do: rollOn, table: target }"] * trigger
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

tables = table("interference", "Interference",
               "Drawn at the top of every stretch, and it holds until the stretch ends. Some of these a tool does to the game; the rest are vows, which nothing enforces but you. None are worth points: an interference lands on everyone, and living with it is the ordinary business of a stretch.",
               built_i, i_extra)
tables += "\n" + table("target", "Target",
                       "What the stretch is for. Drawn after the interference, so you know what is wrong with the world before you are told what to do in it. Name the target in your own words: the app cannot see your game, and the log should read like something that happened.",
                       built_t, t_extra)
tables += "\n" + table("boon", "Boon",
                       "What settling a target is worth. Drawn when you say you settled it, which is the only way anything here can know. Nothing in it is a punishment and nothing is worth points: the points were on the target.",
                       built_b, i_extra)
tables += "\n" + table("displacement", "Displacement",
                       "Every fourth stretch the Lands Between are done with you where you are. Drawn as a stretch closes and taken before the next one opens. A tool does the moving: these are real places by name, and most of them are somewhere you would not have chosen.",
                       built_d, d_extra)

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(os.path.dirname(here))
pack_path = os.path.join(root, "packs", "sketches", "elden-ring-interference.yaml")
s = io.open(pack_path, encoding="utf-8").read()
head = s[:s.index("states:\n")]
tail = s[s.index("\ncounters:"):]
counters_and_after = tail[:tail.index("\ntables:")]
after_tables = tail[tail.index("\nmoves:"):]
s = head + "states:\n" + "\n".join(states) + "\n" + counters_and_after + "\ntables:\n" + tables + after_tables
io.open(pack_path, "w", encoding="utf-8", newline="").write(s)

# ---- the profile, from the same source ---------------------------------
rows = []
for row in I:
    eid, state, ops = row[1], row[3], row[4]
    if not ops:
        continue
    label = state[1] if state else eid.replace("in-", "").capitalize()
    r = {"entry": eid, "table": "interference", "label": label}
    # Weather and time hold until something changes them, which is weather.
    if ops[0]["op"] != "action.invoke":
        r["until"] = "unit"
    r["ops"] = ops
    rows.append(r)

for row in B:
    eid, state, ops = row[1], row[3], row[4]
    r = {"entry": eid, "table": "boon", "label": state[1] if state else eid.replace("bo-", "").capitalize()}
    # A buff lasts the stretch; an item or a heal is simply given.
    if ops[0]["op"] in ("flag.set", "value.set"):
        r["until"] = "unit"
    r["ops"] = ops
    rows.append(r)

for w, eid, name, area, text in PLACES:
    rows.append({"entry": eid, "table": "displacement", "label": name,
                 "ops": [{"op": "warp.grace", "args": {"area": area, "name": name}}]})
rows.append({"entry": "dis-sky", "table": "displacement", "label": "The sky",
             "ops": [{"op": "player.drop", "args": {"height": 220}}]})

profile = {"tool": "TarnishedTool",
           "setup": [{"op": "flag.set", "args": {"name": "world.noCutscenes", "value": True}}],
           "rows": rows}
io.open(os.path.join(here, "elden-ring-interference.json"), "w", encoding="utf-8", newline="").write(json.dumps(profile, indent=2) + "\n")

print("interference %d (%d driven), target %d, boon %d, displacement %d, states %d, profile rows %d"
      % (len(I), sum(1 for r in I if r[4]), len(T), len(B), len(displacement), len(states), len(rows)))
