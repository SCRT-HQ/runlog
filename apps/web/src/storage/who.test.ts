import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetWho, LEGACY_NAME, nameFor, onWhoChanged, whoAmI, whoIsHere, whoSoFar } from "./who.ts";

/**
 * Whose data the device is keeping.
 *
 * The bug this is about: everything lived under one database name, so
 * signing out cleared nothing and a phone that had never signed in showed
 * whatever the last account had synced down. Signed out has to be
 * somebody, with a shelf of their own, rather than a view of the last
 * person's.
 */

afterEach(() => {
  forgetWho();
  vi.useRealTimers();
});

describe("the name data is kept under", () => {
  it("gives every account its own, and signed out one of its own too", () => {
    expect(nameFor({ kind: "account", id: "user_a" })).toBe("runlog:u:user_a");
    expect(nameFor({ kind: "account", id: "user_b" })).toBe("runlog:u:user_b");
    expect(nameFor({ kind: "anon" })).toBe("runlog:anon");
    // The three are three, which is the whole claim.
    const names = new Set([
      nameFor({ kind: "account", id: "user_a" }),
      nameFor({ kind: "account", id: "user_b" }),
      nameFor({ kind: "anon" }),
    ]);
    expect(names.size).toBe(3);
  });

  it("cannot let an account collide with signed out, whatever an id looks like", () => {
    // An id is somebody else's format and could one day be anything.
    expect(nameFor({ kind: "account", id: "anon" })).not.toBe(nameFor({ kind: "anon" }));
  });

  it("leaves a build with no accounts on the name it always had", () => {
    // A copy on disk, a static page, the tests: nothing to sign in to, so
    // nothing to leak and no reason to move anybody's data.
    expect(nameFor({ kind: "local" })).toBe(LEGACY_NAME);
  });
});

describe("waiting to be told", () => {
  it("does not answer until the app knows, because guessing is the bug", () => {
    expect(whoSoFar()).toBeNull();
    let answered: unknown = null;
    void whoAmI().then((w) => (answered = w));
    expect(answered).toBeNull();
  });

  it("answers everyone waiting, once", async () => {
    const first = whoAmI();
    const second = whoAmI();
    whoIsHere({ kind: "account", id: "user_a" });
    expect(await first).toEqual({ kind: "account", id: "user_a" });
    expect(await second).toEqual({ kind: "account", id: "user_a" });
  });

  it("assumes nobody when the answer never comes, which is the safe way to fail", async () => {
    vi.useFakeTimers();
    const asked = whoAmI();
    vi.advanceTimersByTime(10_000);
    // Not the last account, and not a guess: anonymous can see least, and
    // an empty library is a better failure than somebody else's.
    expect(await asked).toEqual({ kind: "anon" });
  });
});

describe("when it changes", () => {
  it("says so, so an open database can be closed", () => {
    const seen: string[] = [];
    onWhoChanged((w) => seen.push(nameFor(w)));
    whoIsHere({ kind: "account", id: "user_a" });
    // The first answer is not a change; there was nothing before it.
    expect(seen).toEqual([]);
    whoIsHere({ kind: "anon" });
    whoIsHere({ kind: "account", id: "user_b" });
    expect(seen).toEqual(["runlog:anon", "runlog:u:user_b"]);
  });

  it("says nothing when the same person is reported twice", () => {
    const seen: string[] = [];
    whoIsHere({ kind: "account", id: "user_a" });
    onWhoChanged((w) => seen.push(nameFor(w)));
    whoIsHere({ kind: "account", id: "user_a" });
    expect(seen).toEqual([]);
  });
});
