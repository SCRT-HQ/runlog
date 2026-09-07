import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeRunFor, forgetActive, lastActive, setActiveRunFor, setLastActive } from "./active.ts";

/** A localStorage for a process that has none. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe("which run this device has open", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("remembers one run per pack, and the last one touched overall", () => {
    expect(activeRunFor("kiln")).toBeNull();
    setActiveRunFor("kiln", "r1");
    setActiveRunFor("salt", "r2");
    setLastActive({ packId: "salt", runId: "r2" });
    expect(activeRunFor("kiln")).toBe("r1");
    expect(activeRunFor("salt")).toBe("r2");
    expect(lastActive()).toEqual({ packId: "salt", runId: "r2" });
  });

  it("forgets a run only where it was the active one", () => {
    setActiveRunFor("kiln", "r1");
    setLastActive({ packId: "kiln", runId: "r1" });
    forgetActive("kiln", "other");
    expect(activeRunFor("kiln")).toBe("r1");
    forgetActive("kiln", "r1");
    expect(activeRunFor("kiln")).toBeNull();
    expect(lastActive()).toBeNull();
  });

  it("is nothing where there is no storage, and never throws", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(activeRunFor("kiln")).toBeNull();
    expect(lastActive()).toBeNull();
    expect(() => setActiveRunFor("kiln", "r1")).not.toThrow();
  });
});
