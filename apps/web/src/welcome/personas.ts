/**
 * Who the welcome page is talking to.
 *
 * The page shows one run as Runlog writes it, and a run is always some
 * particular game: a firing, a day, a service. One example hooks the
 * people who recognize it and loses the rest, so the page lets the reader
 * pick who they are. Each persona names one of the packs that ship and the
 * mode to play it in; the example itself, every roll, line and label, is
 * generated from that pack (see demoScenario.ts), so nothing here repeats
 * what the pack says. What is left is the editorial part: the chip's word,
 * a scene, the vocabulary, a closing line.
 */

/** The five packs the landing page draws examples from, in the page's order. */
export type PersonaId = "streamer" | "dj" | "learner" | "elden-lord" | "rlcs-champion";

export interface Persona {
  id: PersonaId;
  /** The word in the heading: "as a potter". */
  noun: string;
  /** The pack the example is drawn from, and where the marketplace shows it. */
  packId: string;
  /** The pack's own mode id, the key `loadDemoPack`'s pack carries it under. */
  modeId: string;
  /** The lede's first scene, capitalized: "A day at the wheel". */
  scene: string;
  /** The pack's own vocabulary, as the reasons cite it: "a Firing of Stages". */
  vocabulary: string;
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
    modeId: "chats",
    scene: "A penalty wheel the whole chat can watch",
    vocabulary: "a Session of Rounds",
    closing: "Spin for the next round.",
  },
  {
    // Second, because a DJ is the case where the one-press loop is the
    // whole pitch: both hands are busy and the run has to move anyway.
    id: "dj",
    noun: "DJ",
    packId: "com.scrthq.runlog.soundclash",
    modeId: "clubStandard",
    scene: "A set where the next transition is not your call",
    vocabulary: "a Set of Rounds",
    closing: "Call the next one.",
  },
  {
    id: "learner",
    noun: "learner",
    packId: "com.scrthq.runlog.practice-room",
    modeId: "hour",
    scene: "An hour of practice",
    vocabulary: "a Session of Drills",
    closing: "Roll for the next rep.",
  },
  {
    id: "elden-lord",
    noun: "Elden Lord",
    packId: "com.scrthq.runlog.elden-ring-tarnishedtool",
    modeId: "solo",
    scene: "Ten minutes with the world against you",
    vocabulary: "a Trial of Scenes",
    closing: "Draw for the next scene.",
  },
  {
    id: "rlcs-champion",
    noun: "RLCS champion",
    packId: "com.scrthq.runlog.rocket-league-ladder",
    modeId: "placement",
    scene: "A night on the ladder",
    vocabulary: "a Ladder of Matches",
    closing: "Roll for the kickoff.",
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
