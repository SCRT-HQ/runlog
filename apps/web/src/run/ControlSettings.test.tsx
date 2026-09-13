import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import type { StoredRun } from "../storage/db.ts";
import { ControlSettings } from "./ControlSettings.tsx";

/**
 * The panel at first paint. What matters here is what it says before
 * anyone has done anything: a run with no rules must read as a run that
 * is unchanged, not as one with something switched off, and the address a
 * tool dials must carry a placeholder rather than anybody's key.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

const record = (control?: unknown): StoredRun => ({
  runId: "r1",
  packId: kiln.id,
  packVersion: kiln.version,
  events: [],
  updatedAt: "",
  role: "owner",
  ...(control ? { control } : {}),
});

const paint = (control?: unknown) => renderToStaticMarkup(<ControlSettings pack={kiln} record={record(control)} />);

describe("the control panel", () => {
  it("says a run with no rules sends nothing", () => {
    const html = paint();
    expect(html).toContain("None. Nothing is sent.");
    expect(html).toContain("plays exactly as it always has");
  });

  it("leaves a placeholder in the address until there is a key to put there", () => {
    const html = paint();
    expect(html).toContain("/ws?k=REPLACE-WITH-YOUR-WATCH-KEY&amp;as=control");
    // Whatever the origin turns out to be, it is never spoken as http:
    // the socket's scheme is the one thing a copied address must get right.
    expect(html).not.toContain("http");
  });

  it("offers to make the key, rather than sending anybody to another panel for it", () => {
    // No API in a static render, so the button is absent here; what is
    // under test is that the copy no longer tells anyone to go to Chat.
    expect(paint()).not.toContain("under Chat");
  });

  it("draws a saved rule in the pack's own words", () => {
    const html = paint({ tool: "TarnishedTool", rows: [{ table: "check", entry: "check-recent", ops: [{ op: "speffect.apply", args: { id: 6900 } }] }] });
    expect(html).toContain(kiln.tables.check!.title);
    expect(html).not.toContain("None. Nothing is sent.");
  });

  it("says what is wrong with a rule that can never fire", () => {
    const html = paint({ tool: "TarnishedTool", rows: [{ tag: "curse", ops: [{ op: "speffect.apply", args: { id: 1 } }] }] });
    expect(html).toContain("No entry in this pack is tagged curse");
  });

  it("uses the pack's own word for a unit when offering how long an effect lasts", () => {
    expect(paint({ rows: [{ tag: "setback", ops: [{ op: "x", args: {} }] }] })).toContain(`Until this ${kiln.vocabulary.unit.one.toLowerCase()} closes`);
  });
});
