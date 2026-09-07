import { describe, expect, it } from "vitest";
import { diff, type Entry } from "./diff.ts";

const e = (id: string, updatedAt: string, hash = "h", deletedAt?: string): Entry => ({
  id,
  updatedAt,
  hash,
  ...(deletedAt ? { deletedAt } : {}),
});

describe("deciding what to do about each run", () => {
  it("sends what only I have and takes what only they have", () => {
    const plan = diff([e("a", "2026-01-02")], [e("b", "2026-01-02")]);
    expect(plan.push).toEqual(["a"]);
    expect(plan.pull).toEqual(["b"]);
  });

  it("does nothing when both sides hold the same bytes", () => {
    const plan = diff([e("a", "2026-01-02", "same")], [e("a", "2026-01-09", "same")]);
    expect(plan).toEqual({ push: [], pull: [], forgetLocal: [], deleteRemote: [], purge: [] });
  });

  it("lets the newer side win, whichever it is", () => {
    expect(diff([e("a", "2026-01-05", "x")], [e("a", "2026-01-02", "y")]).push).toEqual(["a"]);
    expect(diff([e("a", "2026-01-02", "x")], [e("a", "2026-01-05", "y")]).pull).toEqual(["a"]);
  });

  it("lets an undo travel: a shorter log with a newer stamp is newer, not less", () => {
    // The hash differs because the log is shorter; the stamp says it is the
    // later state. That is all the rule needs to know.
    const plan = diff([e("a", "2026-01-05T10:00", "short")], [e("a", "2026-01-05T09:00", "long")]);
    expect(plan.push).toEqual(["a"]);
  });

  it("pushes on a tie, so the outcome is deterministic", () => {
    expect(diff([e("a", "2026-01-05", "x")], [e("a", "2026-01-05", "y")]).push).toEqual(["a"]);
  });

  describe("deletions", () => {
    it("carry my deletion to them when nothing was written after it", () => {
      const plan = diff([e("a", "2026-01-05", "h", "2026-01-05")], [e("a", "2026-01-02")]);
      expect(plan.deleteRemote).toEqual(["a"]);
    });

    it("bring a run back if they kept working after I forgot it", () => {
      const plan = diff([e("a", "2026-01-05", "h", "2026-01-05")], [e("a", "2026-01-07", "new")]);
      expect(plan.pull).toEqual(["a"]);
      expect(plan.deleteRemote).toEqual([]);
    });

    it("drop my copy when they forgot it after my last write", () => {
      const plan = diff([e("a", "2026-01-02")], [e("a", "2026-01-05", "h", "2026-01-05")]);
      expect(plan.forgetLocal).toEqual(["a"]);
    });

    it("keep mine when I kept working after they forgot it", () => {
      const plan = diff([e("a", "2026-01-07", "new")], [e("a", "2026-01-05", "h", "2026-01-05")]);
      expect(plan.push).toEqual(["a"]);
    });

    it("purge a tombstone both sides already agree on", () => {
      const plan = diff([e("a", "2026-01-05", "h", "2026-01-05")], [e("a", "2026-01-05", "h", "2026-01-05")]);
      expect(plan.purge).toEqual(["a"]);
    });

    it("tell them about a deletion they never saw", () => {
      const plan = diff([e("a", "2026-01-05", "h", "2026-01-05")], []);
      expect(plan.deleteRemote).toEqual(["a"]);
    });
  });
});
