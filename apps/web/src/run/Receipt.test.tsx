import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { Receipt } from "./Receipt.tsx";
import { toDisplayDice } from "../rolling.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

/** The Kiln Check's first entry, whatever it is called this week. */
const check = kiln.tables["check"]!;
const first = check.entries[0]!;

describe("the receipt", () => {
  it("shows the dice as they landed, the total, and what the table said", () => {
    const html = renderToStaticMarkup(
      <Receipt
        pack={kiln}
        onDismiss={() => {}}
        receipt={{
          dice: toDisplayDice("d100", [70, 3], 73),
          total: 73,
          label: "Kiln Check",
          notation: "d100",
          machineRolled: true,
          outcomes: [{ unit: 2, table: "check", entryId: first.id, targetSubject: null, at: "" }],
        }}
      />,
    );
    expect(html).toContain("73");
    expect(html).toContain("rolled for you");
    expect(html).toContain(check.title);
    expect(html).toContain(first.title ?? first.text!);
    expect(html).toContain("Carry on");
  });

  it("names the piece a consequence reached back for", () => {
    const html = renderToStaticMarkup(
      <Receipt
        pack={kiln}
        onDismiss={() => {}}
        receipt={{
          dice: null,
          total: 8,
          label: "Setback",
          notation: "d10",
          machineRolled: false,
          outcomes: [{ unit: 2, table: "setback", entryId: kiln.tables["setback"]!.entries[0]!.id, targetSubject: 1, at: "" }],
        }}
      />,
    );
    expect(html).toContain("your dice");
    expect(html).toContain("hit piece #1");
    expect(html).toContain('class="result heat"');
  });

  it("offers to keep rolling only where it is asked to, after a roll the machine made", () => {
    const rolled = { dice: null, total: 4, label: null, notation: "d6", machineRolled: true, outcomes: [] };
    const offered = renderToStaticMarkup(<Receipt pack={kiln} onDismiss={() => {}} onKeepRolling={() => {}} receipt={rolled} />);
    expect(offered).toContain("Keep rolling for me");
    const plain = renderToStaticMarkup(<Receipt pack={kiln} onDismiss={() => {}} receipt={rolled} />);
    expect(plain).not.toContain("Keep rolling for me");
  });

  it("still says something when a roll resolved nothing", () => {
    const html = renderToStaticMarkup(
      <Receipt
        pack={kiln}
        onDismiss={() => {}}
        receipt={{ dice: null, total: 4, label: null, notation: "d6", machineRolled: false, outcomes: [] }}
      />,
    );
    expect(html).toContain("It is recorded");
  });
});
