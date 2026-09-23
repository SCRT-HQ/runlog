import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONA, PERSONAS, article, otherScenes, otherVocabularies, personaById, savePersona, savedPersona } from "./personas.ts";

/**
 * A persona is editorial: which shipped pack and mode it draws from, and
 * the few words the page says about it. The example's gameplay comes from
 * the pack, so none of it is typed here. And the words that get read
 * aloud in the heading have to scan.
 */
describe("the personas", () => {
  it("are the five landing personas, in order, each naming its pack's mode", () => {
    expect(PERSONAS.map(({ id }) => id)).toEqual(["streamer", "dj", "learner", "elden-lord", "rlcs-champion"]);
    expect(PERSONAS.map(({ modeId }) => modeId)).toEqual(["chats", "clubStandard", "hour", "solo", "placement"]);
  });

  it("each name one shipped pack and the editorial words, and nothing the pack would say", () => {
    const ids = new Set<string>();
    for (const p of PERSONAS) {
      expect(ids.has(p.id), p.id).toBe(false);
      ids.add(p.id);
      expect(Object.keys(p).sort()).toEqual(["closing", "id", "modeId", "noun", "packId", "scene", "vocabulary"]);
      expect(p.packId).toMatch(/^com\.scrthq\.runlog\./);
      expect(p.closing).toMatch(/\.$/);
      expect(p.scene).toMatch(/^[A-Z]/);
      expect(p.vocabulary).toMatch(/^an? [A-Z]\w+ of [A-Z]\w+$/);
    }
    expect(PERSONAS.map(({ packId }) => packId)).toEqual([
      "com.scrthq.runlog.forfeits",
      "com.scrthq.runlog.soundclash",
      "com.scrthq.runlog.practice-room",
      "com.scrthq.runlog.elden-ring-tarnishedtool",
      "com.scrthq.runlog.rocket-league-ladder",
    ]);
  });

  it("read as a sentence: a streamer, an Elden Lord, an RLCS champion", () => {
    expect(article("streamer")).toBe("a");
    expect(article("Elden Lord")).toBe("an");
    expect(article("RLCS champion")).toBe("an");
    expect(article("human")).toBe("a");
  });

  it("fall back to the first for an unknown, missing, or retired choice", () => {
    expect(personaById("nobody")).toBe(DEFAULT_PERSONA);
    expect(personaById(undefined)).toBe(DEFAULT_PERSONA);
    expect(personaById("lifter")).toBe(DEFAULT_PERSONA);
    expect(personaById("elden-lord").packId).toBe("com.scrthq.runlog.elden-ring-tarnishedtool");
  });

  it("list the others without repeating the one chosen", () => {
    const lord = personaById("elden-lord");
    expect(otherScenes(lord, 3)).toHaveLength(3);
    expect(otherScenes(lord, 3)).not.toContain("ten minutes with the world against you");
    expect(otherVocabularies(lord, 2)).not.toContain(lord.vocabulary);
  });

  it("are remembered on the device, and forgotten gracefully", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    savePersona(storage, personaById("learner"));
    expect(savedPersona(storage).id).toBe("learner");
    expect(savedPersona(null)).toBe(DEFAULT_PERSONA);
    expect(savedPersona({ getItem: () => "lifter" })).toBe(DEFAULT_PERSONA);
    const broken = {
      getItem: () => {
        throw new Error("no");
      },
    };
    expect(savedPersona(broken)).toBe(DEFAULT_PERSONA);
  });
});
