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

/** The same panel once the run has found the account a watch key. */
const painted = (control?: unknown, seats?: string[]) =>
  renderToStaticMarkup(
    <ControlSettings
      pack={kiln}
      record={record(control)}
      reachable={{ link: null, key: "watchkey", working: false }}
      {...(seats ? { seats } : {})}
    />,
  );

/**
 * That a name field points at a list that is actually on the page.
 *
 * The id itself is the editor's own and generated, so asserting the
 * literal would be asserting React's counter. What matters is the
 * relationship: every `list=` resolves to a `<datalist>` that exists.
 * It did not, on the page where a run starts, for as long as the
 * datalists were drawn by the settings panel alone.
 */
const listedAgainst = (html: string, which: string): boolean => {
  const field = new RegExp(`list="([^"]*-${which})"`).exec(html);
  return field !== null && html.includes(`id="${field[1]}"`);
};

describe("the control panel", () => {
  it("says a run with no rules sends nothing", () => {
    const html = paint();
    expect(html).toContain("None. Nothing is sent.");
    expect(html).toContain("plays exactly as it always has");
  });

  it("shows no address at all until there is a key to put in one", () => {
    /*
     * It used to print the address with REPLACE-WITH-YOUR-WATCH-KEY where
     * the key goes, in the same box a finished one appears in, with a
     * Copy button beside it. That is something that looks copyable and
     * is not, and the panel already says in words what is missing.
     */
    const html = paint();
    expect(html).not.toContain("REPLACE-WITH-YOUR-WATCH-KEY");
    expect(html).toContain("once it has a key");
    // Whatever the origin turns out to be, it is never spoken as http:
    // the socket's scheme is the one thing a copied address must get right.
    expect(html).not.toContain("http");
  });

  it("names the run, so a tool cannot be moved to a different one behind its back", () => {
    // A watch key on its own reaches whichever run moved most recently and
    // is open to watchers. For a browser source that is the point; for a
    // tool reaching into a game it means a run ending quietly hands the
    // tool to another run, whose pack has nothing to say to it.
    expect(painted()).toContain("run=r1");
    // Every seat's line carries it too, or a race moves one runner and not
    // the rest the first time somebody's run ends.
    const withRoster = painted(undefined, ["Mira", "Kel"]);
    for (const seat of ["Mira", "Kel"]) expect(withRoster).toContain(`run=r1&amp;as=control&amp;seat=${seat}`);
  });

  it("offers to make the key, rather than sending anybody to another panel for it", () => {
    // No API in a static render, so the button is absent here; what is
    // under test is that the copy no longer tells anyone to go to Chat.
    expect(paint()).not.toContain("under Chat");
  });

  it("draws a saved rule in the pack's own words", () => {
    const html = paint({
      tool: "TarnishedTool",
      rows: [{ table: "check", entry: "check-recent", ops: [{ op: "speffect.apply", args: { id: 6900 } }] }],
    });
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
    const html = paint({
      tool: "TarnishedTool",
      rows: [{ tag: "setback", ops: [{ op: "warp.grace", args: { name: "Church of Elleh" } }] }],
    });
    // The field points at a list; the list itself is fetched, so a
    // static render has the one without the other, which is the state
    // the panel is in for the moment before it arrives.
    expect(listedAgainst(html, "graces")).toBe(true);
  });

  it("offers a weapon with an ash on it, which is the one gift that is three things at once", () => {
    const html = paint({
      tool: "TarnishedTool",
      rows: [
        {
          tag: "boon",
          ops: [{ op: "weapon.named", args: { name: "Godskin Peeler", upgrade: 25, ash: "Bloody Slash", affinity: "Blood", count: 2 } }],
        },
      ],
    });
    expect(listedAgainst(html, "ashes")).toBe(true);
    expect(html).toContain('value="Godskin Peeler"');
    expect(html).toContain('value="Bloody Slash"');
  });

  it("offers a weapon at a level, which an item with a count could never be", () => {
    const html = paint({
      tool: "TarnishedTool",
      rows: [{ tag: "boon", ops: [{ op: "weapon.named", args: { name: "Wing of Astel", upgrade: 10 } }] }],
    });
    expect(listedAgainst(html, "weapons")).toBe(true);
    expect(html).toContain('value="Wing of Astel"');
    expect(html).not.toContain("never heard of");
  });

  it("names a boss to warp to, rather than a block and three coordinates", () => {
    const html = paint({
      tool: "TarnishedTool",
      rows: [{ tag: "setback", ops: [{ op: "warp.boss", args: { name: "Godrick the Grafted" } }] }],
    });
    expect(listedAgainst(html, "bosses")).toBe(true);
    expect(html).toContain('value="Godrick the Grafted"');
  });

  it("names an ash of war, which was the last id with a name sitting behind it", () => {
    const html = paint({
      tool: "TarnishedTool",
      rows: [{ tag: "boon", ops: [{ op: "item.give", args: { id: 1, ashOfWar: "Bloody Slash" } }] }],
    });
    expect(listedAgainst(html, "ashes")).toBe(true);
  });

  it("carries no list for a tool that has none", () => {
    expect(paint({ rows: [{ tag: "setback", ops: [{ op: "x", args: {} }] }] })).not.toContain("<datalist");
  });

  it("puts loading a profile from a file above the rules, not below all of them", () => {
    // Reported from play: with a hundred and eleven rules loaded, the
    // Import button was under every one of them and nobody found it.
    const rows = Array.from({ length: 30 }, () => ({ tag: "setback", ops: [{ op: "x", args: {} }] }));
    const html = paint({ tool: "TarnishedTool", rows });
    const importAt = html.indexOf(">Import<");
    const firstRule = html.indexOf("What this rule matches");
    expect(importAt).toBeGreaterThan(-1);
    expect(firstRule).toBeGreaterThan(-1);
    expect(importAt).toBeLessThan(firstRule);
  });

  it("offers the file buttons even where no profile ships for this pack", () => {
    expect(paint()).toContain(">Import<");
  });

  it("uses the pack's own word for a unit when offering how long an effect lasts", () => {
    expect(paint({ rows: [{ tag: "setback", ops: [{ op: "x", args: {} }] }] })).toContain(
      `Until this ${kiln.vocabulary.unit.one.toLowerCase()} closes`,
    );
  });
});
