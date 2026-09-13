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

const paint = (control?: unknown, seats?: string[]) =>
  renderToStaticMarkup(<ControlSettings pack={kiln} record={record(control)} {...(seats ? { seats } : {})} />);

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

  it("gives each racer their own address, and only says to type one when there is no roster", () => {
    const html = paint(undefined, ["Ada", "Bo"]);
    expect(html).toContain("&amp;seat=Ada");
    expect(html).toContain("&amp;seat=Bo");
    expect(html).not.toContain("Add &amp;seat=Name");
    // The rule editor offers the same names, so a rule addressed to one
    // person cannot be addressed to a name that will never connect.
    expect(html).toContain('id="controlSeats"');
  });

  it("tells anybody playing alone to type a seat themselves, since there is no roster to take one from", () => {
    const html = paint();
    expect(html).toContain("Add &amp;seat=Name");
    expect(html).not.toContain("controlSeats");
  });

  it("escapes a racer's name into the address rather than putting it there as typed", () => {
    expect(paint(undefined, ["Bo & Co"])).toContain("&amp;seat=Bo%20%26%20Co");
  });

  it("asks for a grace by name against the tool's own list, not an empty box", () => {
    const html = paint({ tool: "TarnishedTool", rows: [{ tag: "setback", ops: [{ op: "warp.grace", args: { name: "Church of Elleh" } }] }] });
    // The field points at a list; the list itself is fetched, so a
    // static render has the one without the other, which is the state
    // the panel is in for the moment before it arrives.
    expect(html).toContain('list="controlNames-graces"');
    expect(html).toContain('id="controlNames-graces"');
  });

  it("offers a weapon at a level, which an item with a count could never be", () => {
    const html = paint({ tool: "TarnishedTool", rows: [{ tag: "boon", ops: [{ op: "weapon.named", args: { name: "Wing of Astel", upgrade: 10 } }] }] });
    expect(html).toContain('list="controlNames-weapons"');
    expect(html).toContain('value="Wing of Astel"');
    expect(html).not.toContain("never heard of");
  });

  it("carries no list for a tool that has none", () => {
    expect(paint({ rows: [{ tag: "setback", ops: [{ op: "x", args: {} }] }] })).not.toContain("controlNames-");
  });

  it("uses the pack's own word for a unit when offering how long an effect lasts", () => {
    expect(paint({ rows: [{ tag: "setback", ops: [{ op: "x", args: {} }] }] })).toContain(`Until this ${kiln.vocabulary.unit.one.toLowerCase()} closes`);
  });
});
