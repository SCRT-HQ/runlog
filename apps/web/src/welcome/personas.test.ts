import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONA, PERSONAS, article, otherScenes, otherVocabularies, personaById, savePersona, savedPersona } from "./personas.ts";

/**
 * Every persona is a full example: what the page shows changes as a set,
 * so a persona missing a piece would leave the page half about someone
 * else. And the words that get read aloud in the heading have to scan.
 */
describe("the personas", () => {
  it("are each a complete example drawn from one shipped pack", () => {
    const ids = new Set<string>();
    for (const p of PERSONAS) {
      expect(ids.has(p.id), p.id).toBe(false);
      ids.add(p.id);
      expect(p.packId).toMatch(/^com\.scrthq\.runlog\./);
      expect(p.log).toHaveLength(4);
      expect(p.log.filter((l) => l.heat)).toHaveLength(1);
      expect(p.state.length).toBeGreaterThanOrEqual(2);
      expect(p.closing).toMatch(/\.$/);
      expect(p.scene).toMatch(/^[A-Z]/);
      expect(p.vocabulary).toMatch(/^an? [A-Z]\w+ of [A-Z]\w+$/);
      expect(p.clock).toContain(p.at);
    }
  });

  it("read as a sentence: a potter, an Elden Lord, an RLCS champion", () => {
    expect(article("potter")).toBe("a");
    expect(article("Elden Lord")).toBe("an");
    expect(article("RLCS champion")).toBe("an");
    expect(article("human")).toBe("a");
  });

  it("fall back to the first for an unknown or missing choice", () => {
    expect(personaById("nobody")).toBe(DEFAULT_PERSONA);
    expect(personaById(undefined)).toBe(DEFAULT_PERSONA);
    expect(personaById("potter").packTitle).toBe("The Long Kiln");
  });

  it("list the others without repeating the one chosen", () => {
    const potter = personaById("potter");
    expect(otherScenes(potter, 3)).toHaveLength(3);
    expect(otherScenes(potter, 3)).not.toContain("a day at the wheel");
    expect(otherVocabularies(potter, 2)).not.toContain(potter.vocabulary);
  });

  it("are remembered on the device, and forgotten gracefully", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    savePersona(storage, personaById("chef"));
    expect(savedPersona(storage).id).toBe("chef");
    expect(savedPersona(null)).toBe(DEFAULT_PERSONA);
    const broken = {
      getItem: () => {
        throw new Error("no");
      },
    };
    expect(savedPersona(broken)).toBe(DEFAULT_PERSONA);
  });
});
