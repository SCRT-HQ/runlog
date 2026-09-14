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
  /** The pack the example is drawn from, and where the marketplace shows it. */
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
    // First, so the page opens on the run a stream wants, and on the pack
    // a fresh device already has: a wheel with teeth, whatever you play.
    id: "streamer",
    noun: "streamer",
    packId: "com.scrthq.runlog.forfeits",
    packTitle: "Forfeits",
    mode: "Chat's forfeits",
    at: "Round 3",
    scene: "A penalty wheel the whole chat can watch",
    vocabulary: "a Session of Rounds",
    unit: "round",
    log: [
      { where: "Round 1, Stakes", roll: "d6 → 4", text: "A fair round. Two points." },
      { where: "Round 1, Race", roll: "award · Vex", text: "Vex settled it first. 2 points; the streak holds." },
      {
        where: "Round 2, Forfeit",
        roll: "d12 → 5 · on everyone",
        text: "Inverted controls, or the nearest thing: the camera flipped, until the round is called.",
        heat: true,
      },
      { where: "Round 3, Stakes", roll: "d6 → 6", text: "Chat's round. Five points, and chat says what settling it takes." },
    ],
    state: [
      { label: "Leading", value: "Vex, 2 pts" },
      { label: "Forfeits landed", value: "1" },
      { label: "Rounds without a forfeit", value: "0" },
    ],
    clock: "Round 3 · 04:12",
    closing: "Spin for the next round.",
  },
  {
    // Second, because a DJ is the case where the one-press loop is the
    // whole pitch: both hands are busy and the run has to move anyway.
    id: "dj",
    noun: "DJ",
    packId: "com.scrthq.runlog.soundclash",
    packTitle: "Soundclash",
    mode: "Club Standard",
    at: "Round 4",
    scene: "A set where the next transition is not your call",
    vocabulary: "a Set of Rounds",
    unit: "round",
    log: [
      { where: "Round 1, Call the Round", roll: "d20 → 1", text: "Double-drop. Land both drops on the same one." },
      {
        where: "Round 2, Call the Round",
        roll: "d20 → 3",
        text: "The next track is at least 20 BPM off this one. Get there however you like.",
      },
      {
        where: "Round 3, Call the Round",
        roll: "d20 → 16",
        text: "Cut the bass on both channels for 8 beats, then bring the new one's back alone.",
      },
      {
        where: "Round 4, Call the Round",
        roll: "d20 → 7",
        text: "From the moment you touch the crossfader, you have 90 seconds.",
        heat: true,
      },
    ],
    state: [
      { label: "Rounds mixed", value: "3" },
      { label: "Passes", value: "2" },
      { label: "Style", value: "Club Standard" },
    ],
    clock: "Round 4 · 01:30",
    closing: "Call the next one.",
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
      {
        where: "Drill 1, Focus",
        roll: "d10 → 3",
        text: "The hard bar. Isolate the two seconds that break, loop only that. Eight minutes.",
      },
      { where: "Drill 2, Focus", roll: "d10 → 1", text: "Slow. Half speed or slower, every repetition perfect. Ten minutes." },
      {
        where: "Drill 3, Curveball",
        roll: "d10 → 2",
        text: "The last Exercise did not stick. Mark it Shaky; it comes back later this Session.",
        heat: true,
      },
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
    id: "elden-lord",
    noun: "Elden Lord",
    packId: "com.scrthq.runlog.elden-ring-tarnishedtool",
    packTitle: "Elden Ring: TarnishedTool",
    mode: "Solo",
    at: "Scene 4",
    scene: "Ten minutes with the world against you",
    vocabulary: "a Trial of Scenes",
    unit: "scene",
    log: [
      { where: "Scene 3, Curse", roll: "d100 → 4", text: "Mired. Half speed, and everything in this game is faster than you." },
      { where: "Scene 3, Objective", roll: "d100 → 6", text: "A named boss of wherever you have landed. Name it, find it, put it down." },
      { where: "Scene 3, Blessing", roll: "d100 → 7", text: "Runes, twenty thousand. Spend them before something takes them." },
      {
        where: "Scene 4, Displacement",
        roll: "d100 → 99 · four scenes in one place",
        text: "The sky. You are lifted a few hundred feet above wherever you were standing, and then you are not lifted any more.",
        heat: true,
      },
    ],
    state: [
      { label: "Scenes survived", value: "3" },
      { label: "Deaths", value: "5" },
      { label: "Curses per scene", value: "2" },
    ],
    clock: "Scene 4 · 10:00",
    closing: "Draw for the next scene.",
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
      {
        where: "Match 2, Draw the set · Platinum",
        roll: "d6 → 1",
        text: "Air roll into a shot, so the ball goes where you meant.",
        heat: true,
      },
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
