import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce } from "./reduce.ts";
import { exportRun, importRun, logFilename, mayQuote, renderLog } from "./export.ts";
import type { RunEvent } from "./events.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function loadPack(rel: string): Pack {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
}
const kiln = loadPack("packs/demo/pack.yaml");

/** The same pack, but with its author's words reserved. */
const closed: Pack = {
  ...kiln,
  title: "A Private Transcription",
  license: { ...kiln.license, redistributable: false },
};

const NOW = "2026-03-12T10:00:00.000Z";
const ev = (t: RunEvent["t"], props: Record<string, unknown> = {}): RunEvent =>
  ({ t, at: NOW, ...props }) as RunEvent;

/** A short but complete run: two stages, a setback, a journal entry, an end. */
const log: RunEvent[] = [
  ev("RunStarted", { packId: kiln.id, packVersion: kiln.version, mode: "standard", seed: "slow-salt-63" }),
  ev("UnitEntered"),
  ev("SubjectDeclared", { subjectType: "Tall vase" }),
  ev("JournalWritten", { unit: 1, text: "Taller than I meant.\nKept it." }),
  ev("UnitFinalized"),
  ev("UnitEntered"),
  ev("Rolled", { purpose: "check", dice: "d100", total: 74, values: [74], source: "physical" }),
  ev("OutcomeResolved", { table: "check", entryId: "check-recent", cause: "phase", targetSubject: 1 }),
  ev("StateApplied", { state: "sealed", subject: 1 }),
  ev("SubjectDeclared", { subjectType: "Lidded jar" }),
  ev("UnitFinalized"),
  ev("RunEnded", { ending: "kept" }),
];

describe("the archive", () => {
  it("carries the log and enough to find the pack again", () => {
    const archive = exportRun(kiln, log, NOW);
    expect(archive).toMatchObject({
      format: "runlog.run",
      formatVersion: 1,
      pack: { id: kiln.id, version: kiln.version },
      mode: "standard",
      seed: "slow-salt-63",
      exportedAt: NOW,
    });
    expect(archive.events).toHaveLength(log.length);
  });

  /**
   * The reason the archive is the event log and not a state dump: it has to
   * come back exactly, or it is a screenshot rather than a save.
   */
  it("round-trips through JSON to an identical state", () => {
    const written = JSON.stringify(exportRun(kiln, log, NOW));
    const read = importRun(JSON.parse(written));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(reduce(kiln, read.archive.events)).toEqual(reduce(kiln, log));
  });

  /**
   * A pack may be a private transcription of a book somebody sells. The
   * archive references results by id and never quotes them, so it is safe to
   * hand to anyone regardless of the pack's license.
   */
  it("never carries rules text, whatever the license", () => {
    const text = JSON.stringify(exportRun(closed, log, NOW));
    expect(text).not.toContain("The Kiln reaches for recent work");
    expect(text).toContain("check-recent");
  });

  it("records that a run is still going", () => {
    const open = exportRun(kiln, log.slice(0, -1), NOW);
    expect(open.endedAt).toBeNull();
    expect(exportRun(kiln, log, NOW).endedAt).not.toBeNull();
  });

  it("refuses what is not a run archive", () => {
    expect(importRun(null)).toMatchObject({ ok: false });
    expect(importRun({ format: "something-else" })).toMatchObject({ ok: false });
    expect(importRun({ format: "runlog.run", formatVersion: 1, pack: { id: "x" }, events: [] })).toMatchObject({
      ok: false,
      error: "the archive contains no events",
    });
  });

  it("refuses a log that does not begin with the start of a run", () => {
    const bad = { ...exportRun(kiln, log, NOW), events: log.slice(1) };
    expect(importRun(bad)).toMatchObject({ ok: false });
  });

  it("refuses an archive from a newer version rather than guessing", () => {
    const future = { ...exportRun(kiln, log, NOW), formatVersion: 99 };
    expect(importRun(future)).toMatchObject({ ok: false });
  });
});

describe("the write-up", () => {
  const md = renderLog(kiln, log);

  it("opens with the pack, the mode and the shape of the run", () => {
    expect(md).toContain("# The Long Kiln — Firing");
    expect(md).toContain("Standard Firing");
    expect(md).toContain("seed `slow-salt-63`");
  });

  it("gives each unit a heading named for what was made in it", () => {
    expect(md).toContain("## Stage 1 — Tall vase");
    expect(md).toContain("## Stage 2 — Lidded jar");
  });

  it("shows the roll that produced an outcome, and what it reached", () => {
    expect(md).toContain("**Kiln Check** (d100 → 74) → Piece 1 (Tall vase)");
  });

  it("says when a roll was not the player's own", () => {
    const auto = renderLog(kiln, [
      ...log.slice(0, 6),
      ev("Rolled", { purpose: "check", dice: "d100", total: 74, values: [74], source: "seeded" }),
      ...log.slice(7),
    ]);
    expect(auto).toContain("d100 → 74, seeded");
  });

  it("quotes the journal", () => {
    expect(md).toContain("> Taller than I meant. Kept it.");
  });

  it("finishes with the ending and the board", () => {
    expect(md).toContain("## The Shelf");
    expect(md).toContain("Piece 1: Tall vase — Sealed");
  });

  it("says so when the run has not been declared over", () => {
    expect(renderLog(kiln, log.slice(0, -1))).toContain("has not been declared over");
  });

  it("copes with a run that never entered a unit", () => {
    expect(renderLog(kiln, log.slice(0, 1))).toContain("No stages were entered.");
  });

  /**
   * An opening hand is dealt before anyone enters a unit, so it has no unit
   * heading to sit under. Without somewhere to go it rendered as a stray
   * bullet directly beneath the title, attached to nothing.
   */
  describe("what happens before the first unit", () => {
    const dealt: RunEvent[] = [
      log[0]!,
      ev("CardDrawn", { deck: "charms", cardId: kiln.decks?.charms?.kind === "cards" ? kiln.decks.charms.cards[0]!.id : "x" }),
      ...log.slice(1),
    ];

    it("gets a section of its own", () => {
      const md = renderLog(kiln, dealt);
      const before = md.indexOf("## Before Stage 1");
      const drew = md.indexOf("- Drew");
      const stage = md.indexOf("## Stage 1");
      expect(before).toBeGreaterThan(-1);
      expect(before).toBeLessThan(drew);
      expect(drew).toBeLessThan(stage);
    });

    it("is not invented for a run where nothing happened first", () => {
      // Bookkeeping events print nothing, so they must not open a section.
      expect(renderLog(kiln, log)).not.toContain("## Before Stage 1");
    });
  });

  /**
   * The license question, which is the whole reason this is not just
   * `JSON.stringify`. A run kept for yourself may quote a book you own; the
   * same run addressed to somebody else may not.
   */
  describe("a pack whose text is not redistributable", () => {
    it("still quotes it in a copy for yourself", () => {
      expect(mayQuote(closed, "self")).toBe(true);
      expect(renderLog(closed, log, { audience: "self" })).toContain(
        "The Kiln reaches for recent work",
      );
    });

    it("withholds the text in a copy meant for anyone else", () => {
      expect(mayQuote(closed, "share")).toBe(false);
      const shared = renderLog(closed, log, { audience: "share" });
      expect(shared).not.toContain("The Kiln reaches for recent work");
      expect(shared).toContain("Rules text withheld");
      // Still auditable: which result came up is a fact about the run, not
      // somebody's prose.
      expect(shared).toContain("`check-recent`");
      expect(shared).toContain("(d100 → 74)");
    });

    it("leaves an openly licensed pack alone", () => {
      expect(mayQuote(kiln, "share")).toBe(true);
      expect(renderLog(kiln, log, { audience: "share" })).toContain(
        "The Kiln reaches for recent work",
      );
    });
  });
});

describe("filenames", () => {
  it("leads with the date, so a folder of them reads chronologically", () => {
    expect(logFilename(kiln, reduce(kiln, log), "md")).toBe("2026-03-12-long-kiln-standard.md");
    expect(logFilename(kiln, reduce(kiln, log), "json")).toBe("2026-03-12-long-kiln-standard.json");
  });
});
