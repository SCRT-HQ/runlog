/**
 * Who the welcome page is talking to.
 *
 * The page shows one run as Runlog writes it, and a run is always some
 * particular game: a firing, a day, a service. One example hooks the
 * people who recognize it and loses the rest, so the page lets the reader
 * pick who they are, and every example on it follows: the heading, the
 * lede's first scene, the specimen log, the vocabulary in the reasons, the
 * last line. Each persona is one of the packs that ship, with words and
 * rolls taken from that pack, so what the page promises is what the app
 * does.
 */

export interface LogLine {
  where: string;
  roll: string;
  text: string;
  /** A result that reaches back and hurts, set apart in the log. */
  heat?: boolean;
}

export interface Persona {
  id: string;
  /** The word in the heading: "as a potter". */
  noun: string;
  /** The pack the example is drawn from, and where the catalog shows it. */
  packId: string;
  packTitle: string;
  mode: string;
  /** The unit the specimen is at: "Stage 4". */
  at: string;
  /** The lede's first scene, capitalized: "A day at the wheel". */
  scene: string;
  /** The pack's own vocabulary, as the reasons cite it: "a Firing of Stages". */
  vocabulary: string;
  /** What one unit is called, for the step that walks one: "stage". */
  unit: string;
  log: LogLine[];
  state: Array<{ label: string; value: string }>;
  clock: string;
  /** The last line on the page. */
  closing: string;
}

export const PERSONAS: Persona[] = [
  {
    id: "human",
    noun: "human",
    packId: "com.scrthq.runlog.any-given-day",
    packTitle: "Any Given Day",
    mode: "A working day",
    at: "Block 3",
    scene: "A day of things to do",
    vocabulary: "a Day of Blocks",
    unit: "block",
    log: [
      { where: "Block 1, Weather", roll: "d20 → 3", text: "A break in the clouds. Roll on Boon." },
      { where: "Block 1, Boon", roll: "d6 → 1", text: "You find a second wind. Energy +1." },
      { where: "Block 2, Twist", roll: "d10 → 4", text: "Do only the smallest complete version of it. Ship that." },
      { where: "Block 3, Setback", roll: "d8 → 3 · on Block 1", text: "It spawned a follow-up. Add a Block before the Day may end.", heat: true },
    ],
    state: [
      { label: "Streak", value: "2" },
      { label: "Tasks done", value: "2" },
      { label: "Energy", value: "3" },
    ],
    clock: "Block 3 · 10:20",
    closing: "Roll for the day.",
  },
  {
    id: "potter",
    noun: "potter",
    packId: "com.scrthq.runlog.long-kiln",
    packTitle: "The Long Kiln",
    mode: "Standard Firing",
    at: "Stage 4",
    scene: "A day at the wheel",
    vocabulary: "a Firing of Stages",
    unit: "stage",
    log: [
      { where: "Stage 2, Kiln Check", roll: "d100 → 26", text: "The Kiln dictates the form. Roll on the Form table." },
      { where: "Stage 2, Form", roll: "d6 → 4", text: "A cup. Small, and it must be usable." },
      { where: "Stage 2, Constraint", roll: "d12 → 10", text: "One glaze only, applied once." },
      { where: "Stage 4, Kiln Check", roll: "d100 → 88 · hit #2", text: "Thermal shock reaches back. The cup from Stage 2 cracks; mark it.", heat: true },
    ],
    state: [
      { label: "Glaze", value: "3 / 6" },
      { label: "Calm streak", value: "1" },
      { label: "Setbacks", value: "1" },
    ],
    clock: "Stage 4 · 12:41",
    closing: "Roll for the clay.",
  },
  {
    id: "chef",
    noun: "chef",
    packId: "com.scrthq.runlog.pantry-roulette",
    packTitle: "Pantry Roulette",
    mode: "Three courses",
    at: "Course 3",
    scene: "A kitchen under constraint",
    vocabulary: "a Service of Courses",
    unit: "course",
    log: [
      { where: "Course 1, Base", roll: "d10 → 3", text: "A vegetable that is about to turn. Find it. That one." },
      { where: "Course 1, Constraint", roll: "d12 → 2", text: "Twenty minutes from now to plated." },
      { where: "Course 2, Kitchen", roll: "d10 → 1", text: "The kitchen hums. Nothing happens." },
      { where: "Course 3, Mishap", roll: "d6 → 2 · on Course 1", text: "It has gone cold or soggy. Rescue it: a reheat, a crisp, a sauce.", heat: true },
    ],
    state: [
      { label: "Courses plated", value: "2" },
      { label: "Pantry", value: "4" },
      { label: "Mishaps", value: "1" },
    ],
    clock: "Course 3 · 19:42",
    closing: "Roll for dinner.",
  },
  {
    id: "learner",
    noun: "learner",
    packId: "com.scrthq.runlog.practice-room",
    packTitle: "Practice Room",
    mode: "The full hour",
    at: "Drill 3",
    scene: "An hour of practice",
    vocabulary: "a Session of Drills",
    unit: "drill",
    log: [
      { where: "Drill 1, Curveball", roll: "d10 → 1", text: "Nothing. Carry on." },
      { where: "Drill 1, Focus", roll: "d10 → 3", text: "The hard bar. Isolate the two seconds that break, loop only that. Eight minutes." },
      { where: "Drill 2, Focus", roll: "d10 → 1", text: "Slow. Half speed or slower, every repetition perfect. Ten minutes." },
      { where: "Drill 3, Curveball", roll: "d10 → 2", text: "The last Exercise did not stick. Mark it Shaky; it comes back later this Session.", heat: true },
    ],
    state: [
      { label: "Drills done", value: "2" },
      { label: "Clean streak", value: "2" },
      { label: "Shaky", value: "1" },
    ],
    clock: "Drill 3 · 31:05",
    closing: "Roll for the next rep.",
  },
  {
    id: "writer",
    noun: "writer",
    packId: "com.scrthq.runlog.salt-and-signal",
    packTitle: "Salt & Signal",
    mode: "Standard Vigil",
    at: "Watch 3",
    scene: "A lighthouse log kept through the night",
    vocabulary: "a Vigil of Watches",
    unit: "watch",
    log: [
      { where: "Watch 1, The Tide", roll: "draw → ♣", text: "Damage to the light. Spend one Supply repairing it." },
      { where: "Watch 2, The Oracle", roll: "2d10 → 11", text: "Yes, but it costs you." },
      { where: "Watch 2, Send a Signal", roll: "draw → ♥", text: "A response, or the sound of one. Mark one Contact and spend one Supply." },
      { where: "Watch 3, Erosion", roll: "d8 → 2 · on Watch 1", text: "You are no longer certain it happened. Mark it Doubted.", heat: true },
    ],
    state: [
      { label: "Dread", value: "3" },
      { label: "Supply", value: "1" },
      { label: "Contact", value: "1" },
    ],
    clock: "Watch 3 · 02:14",
    closing: "Keep the light burning.",
  },
  {
    id: "elden-lord",
    noun: "Elden Lord",
    packId: "com.scrthq.runlog.elden-ring-expedition",
    packTitle: "Elden Ring: Expedition",
    mode: "Expedition",
    at: "Region 2",
    scene: "A run across the Lands Between",
    vocabulary: "an Expedition of Regions",
    unit: "region",
    log: [
      { where: "Region 1, Handicap", roll: "d12 → 4", text: "Two-handed only. Shields stay on your back." },
      { where: "Region 1, Target", roll: "d10 → 3", text: "A hunt. Three names are drawn; all three must fall before you leave." },
      { where: "Region 1, A name to hunt", roll: "d12 → 4", text: "Blaidd." },
      { where: "Region 2, Handicap", roll: "d12 → 2", text: "No summons of any kind this region: no spirit ashes, no players.", heat: true },
    ],
    state: [
      { label: "Deaths", value: "7" },
      { label: "Targets done", value: "1" },
      { label: "Vows kept", value: "0" },
    ],
    clock: "Region 2 · 1:48:10",
    closing: "Roll for the Lands Between.",
  },
  {
    id: "rlcs-champion",
    noun: "RLCS champion",
    packId: "com.scrthq.runlog.rocket-league-ladder",
    packTitle: "Rocket League: Mechanics Ladder",
    mode: "Placement",
    at: "Match 2",
    scene: "A night on the ladder",
    vocabulary: "a Ladder of Matches",
    unit: "match",
    log: [
      { where: "Match 1, Draw the set · Gold", roll: "d6 → 2", text: "Speed flip a kickoff." },
      { where: "Match 1, Draw the set · Gold", roll: "d6 → 4", text: "Shadow defend a whole possession without committing." },
      { where: "Match 1, Log the match", roll: "landed 1 of 2", text: "One down. Mechanics landed +1; the other comes back next Match." },
      { where: "Match 2, Draw the set · Platinum", roll: "d6 → 1", text: "Air roll into a shot, so the ball goes where you meant.", heat: true },
    ],
    state: [
      { label: "Mechanics landed", value: "1" },
      { label: "Matches played", value: "1" },
      { label: "Rank", value: "Platinum" },
    ],
    clock: "Match 2 · 05:00",
    closing: "Roll for the kickoff.",
  },
  {
    id: "homemaker",
    noun: "homemaker",
    packId: "com.scrthq.runlog.homefront",
    packTitle: "Homefront",
    mode: "A Sweep",
    at: "Room 2",
    scene: "A house cleaned like a dungeon",
    vocabulary: "a Sweep of Rooms",
    unit: "room",
    log: [
      { where: "Room 1, Draw the Room", roll: "d12 → 1", text: "The kitchen. Surfaces, sink, the thing in the back of the fridge." },
      { where: "Room 1, Complication", roll: "d8 → 3", text: "Go one layer deeper than usual: inside, behind, or under one thing." },
      { where: "Room 1, Reward", roll: "d6 → 1", text: "Sit down for five minutes. Patience +1." },
      { where: "Room 2, Complication", roll: "d8 → 1", text: "Fifteen minutes. Whatever is done at the buzzer is done.", heat: true },
    ],
    state: [
      { label: "Rooms cleared", value: "1" },
      { label: "Patience", value: "3" },
      { label: "Guests coming", value: "yes" },
    ],
    clock: "Room 2 · 00:41",
    closing: "Roll for the room.",
  },
  {
    id: "lifter",
    noun: "lifter",
    packId: "com.scrthq.runlog.ladder-work",
    packTitle: "Ladder Work",
    mode: "Standard Session",
    at: "Block 2",
    scene: "An evening under the bar",
    vocabulary: "a Session of Blocks",
    unit: "block",
    log: [
      { where: "Block 1, Draw the Block", roll: "d12 → 1", text: "Back squat." },
      { where: "Block 1, Loading", roll: "d6 → 1", text: "Five sets of five. Two minutes between sets." },
      { where: "Block 2, Draw the Block", roll: "d12 → 4", text: "Deadlift, from the floor." },
      { where: "Block 2, Loading", roll: "d6 → 4", text: "One all-out set. Take as long as you need beforehand, then go.", heat: true },
    ],
    state: [
      { label: "Accumulated fatigue", value: "4" },
      { label: "Blocks logged", value: "1" },
      { label: "Taxed", value: "yes" },
    ],
    clock: "Block 2 · 38:12",
    closing: "Roll for the bar.",
  },
];

export const DEFAULT_PERSONA = PERSONAS[0]!;

export function personaById(id: string | null | undefined): Persona {
  return PERSONAS.find((p) => p.id === id) ?? DEFAULT_PERSONA;
}

/** "a" or "an", by the sound the word starts with, for the handful of words here. */
export function article(noun: string): "a" | "an" {
  const first = noun.charAt(0).toLowerCase();
  // "RLCS" is read letter by letter and starts with an "ar"; the rest by their vowel.
  if (/^[A-Z]{2,}/.test(noun)) return /^[aefhilmnorsx]/.test(first) ? "an" : "a";
  return /^[aeiou]/.test(first) ? "an" : "a";
}

/** The rest of the personas' scenes, in the page's order, for the lede's list. */
export function otherScenes(persona: Persona, count: number): string[] {
  return PERSONAS.filter((p) => p.id !== persona.id)
    .slice(0, count)
    .map((p) => p.scene.charAt(0).toLowerCase() + p.scene.slice(1));
}

/** Two other vocabularies, so the reasons still show the range. */
export function otherVocabularies(persona: Persona, count: number): string[] {
  return PERSONAS.filter((p) => p.id !== persona.id)
    .slice(0, count)
    .map((p) => p.vocabulary);
}

const KEY = "runlog:persona";

export function savedPersona(storage: Pick<Storage, "getItem"> | null): Persona {
  try {
    return personaById(storage?.getItem(KEY));
  } catch {
    return DEFAULT_PERSONA;
  }
}

export function savePersona(storage: Pick<Storage, "setItem"> | null, persona: Persona): void {
  try {
    storage?.setItem(KEY, persona.id);
  } catch {
    // Storage is a convenience; the page works without remembering.
  }
}
