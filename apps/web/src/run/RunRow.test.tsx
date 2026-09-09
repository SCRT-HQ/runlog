import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Pack } from "@runlog/rules-schema";
import type { StoredRun } from "../storage/db.ts";
import { RunRow } from "./RunRow.tsx";

/**
 * The row of the run that is open on this device.
 *
 * It used to be marked by being switched off: no Continue, the name not
 * pressable. In the library that read as a run you could not get back to,
 * with a label ("open here") that promised otherwise. Marked now means
 * marked; the row still opens the run.
 */

const vocabulary = { unit: { one: "Unit", many: "Units" }, subject: { one: "Piece", many: "Pieces" }, run: { one: "Run", many: "Runs" } } as Pack["vocabulary"];

const run: StoredRun = {
  runId: "01RUN",
  packId: "com.example.kiln",
  packVersion: "1.0.0",
  events: [{ t: "RunStarted", at: "2026-09-01T10:00:00Z", packId: "com.example.kiln", packVersion: "1.0.0" }, { t: "RunRenamed", at: "2026-09-01T10:01:00Z", name: "first firing" }],
  updatedAt: "2026-09-02T10:00:00Z",
};

const paint = (open: boolean) => renderToStaticMarkup(<RunRow run={run} vocabulary={vocabulary} open={open} onPick={() => {}} onForget={() => {}} />);

describe("the run open on this device", () => {
  it("is marked, and still a press away", () => {
    const html = paint(true);
    expect(html).toContain('class="runRow open"');
    expect(html).toContain("currently open");
    expect(html).not.toContain("disabled");
    expect(html).toContain(">Continue<");
    expect(html).toContain("first firing");
  });

  it("reads like any other row otherwise", () => {
    const html = paint(false);
    expect(html).not.toContain("currently open");
    expect(html).toContain("last played");
    expect(html).toContain(">Continue<");
  });
});
