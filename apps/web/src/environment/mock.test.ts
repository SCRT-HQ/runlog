import { describe, expect, it } from "vitest";
import type { EnvironmentLink, ExternalEvent } from "@runlog/engine";
import { MockEnvironment } from "./mock.ts";

/**
 * The mock is the specification by example: an adapter that behaves like this
 * one works with the panel, because the panel has never known which it is
 * talking to. So these are really tests of the contract, written against the
 * only implementation that needs nothing installed to run.
 */

/** Type-level check that the mock satisfies the port, not a duck-typed cousin. */
const asLink: EnvironmentLink = new MockEnvironment();

describe("the environment contract", () => {
  it("starts disconnected and reports nothing until it is connected", async () => {
    const env = new MockEnvironment(["Kept track"]);
    expect(env.status()).toBe("disconnected");
    // A disconnected link reporting an empty world would look identical to a
    // connected one reporting an empty world, so this must not be mistaken for
    // agreement: the panel gates on status, and the snapshot backs it up.
    expect((await env.snapshot()).subjects).toEqual([]);
  });

  it("connects and then reports what it holds", async () => {
    const env = new MockEnvironment(["First", "Second"]);
    expect(await env.connect()).toBe("connected");
    const { subjects } = await env.snapshot();
    expect(subjects.map((s) => s.name)).toEqual(["First", "Second"]);
    expect(subjects.map((s) => s.index)).toEqual([1, 2]);
  });

  it("stops reporting once disconnected", async () => {
    const env = new MockEnvironment(["First"]);
    await env.connect();
    env.disconnect();
    expect(env.status()).toBe("disconnected");
    expect((await env.snapshot()).subjects).toEqual([]);
  });

  it("hands back a copy, so a caller cannot edit the world by accident", async () => {
    const env = new MockEnvironment(["First"]);
    await env.connect();
    const { subjects } = await env.snapshot();
    subjects[0]!.name = "Tampered";
    expect((await env.snapshot()).subjects[0]!.name).toBe("First");
  });

  describe("telling the app when something changed", () => {
    it("announces additions, renames and removals", async () => {
      const env = new MockEnvironment();
      const seen: ExternalEvent[] = [];
      env.subscribe((e) => seen.push(e));

      const added = env.add("First");
      env.rename(added.id, "Renamed");
      env.remove(added.id);

      expect(seen.map((e) => e.t)).toEqual(["subjectAdded", "subjectRenamed", "subjectRemoved"]);
    });

    it("stops when unsubscribed", () => {
      const env = new MockEnvironment();
      const seen: ExternalEvent[] = [];
      const stop = env.subscribe((e) => seen.push(e));
      env.add("First");
      stop();
      env.add("Second");
      expect(seen).toHaveLength(1);
    });

    it("announces a connection, so a panel can refresh on it", async () => {
      const env = new MockEnvironment();
      const seen: ExternalEvent[] = [];
      env.subscribe((e) => seen.push(e));
      await env.connect();
      expect(seen.map((e) => e.t)).toContain("changed");
    });
  });

  it("keeps positions contiguous when something is removed", async () => {
    // Positions are what targeting counts, so a gap in them is not cosmetic.
    const env = new MockEnvironment(["First", "Second", "Third"]);
    await env.connect();
    const { subjects } = await env.snapshot();
    env.remove(subjects[0]!.id);
    expect((await env.snapshot()).subjects.map((s) => s.index)).toEqual([1, 2]);
  });

  it("reorders on a swap, which is the disagreement worth demonstrating", async () => {
    const env = new MockEnvironment(["First", "Second"]);
    await env.connect();
    env.swap(0, 1);
    const { subjects } = await env.snapshot();
    expect(subjects.map((s) => [s.name, s.index])).toEqual([
      ["Second", 1],
      ["First", 2],
    ]);
  });

  it("ignores a swap that names a position it does not have", async () => {
    const env = new MockEnvironment(["Only"]);
    await env.connect();
    env.swap(0, 5);
    expect((await env.snapshot()).subjects.map((s) => s.name)).toEqual(["Only"]);
  });

  it("writes a label back onto the thing itself", async () => {
    const env = new MockEnvironment(["Before"]);
    await env.connect();
    const { subjects } = await env.snapshot();
    await env.applyLabel(subjects[0]!.id, "After [SLD]");
    expect((await env.snapshot()).subjects[0]!.name).toBe("After [SLD]");
  });

  it("does nothing when asked to label something it does not have", async () => {
    const env = new MockEnvironment(["Only"]);
    await env.connect();
    await expect(env.applyLabel("nonexistent", "x")).resolves.toBeUndefined();
  });

  it("satisfies the port", () => {
    expect(asLink.id).toBe("mock");
    expect(typeof asLink.subscribe).toBe("function");
  });
});
