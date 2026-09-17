// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { Receipt, type RollReceipt } from "./Receipt.tsx";
import { toDisplayDice } from "../rolling.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

/** The Kiln Check's first entry, whatever it is called this week. */
const check = kiln.tables["check"]!;
const first = check.entries[0]!;

const kilnCheck: RollReceipt = {
  dice: toDisplayDice("d100", [70, 3], 73),
  total: 73,
  label: "Kiln Check",
  notation: "d100",
  machineRolled: true,
  outcomes: [{ unit: 2, table: "check", entryId: first.id, targetSubject: null, at: "" }],
};

afterEach(cleanup);

describe("the receipt", () => {
  it("shows the dice as they landed, the total, and what the table said", () => {
    const html = renderToStaticMarkup(<Receipt pack={kiln} settled onDismiss={() => {}} receipts={[kilnCheck]} />);
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
        settled
        onDismiss={() => {}}
        receipts={[
          {
            dice: null,
            total: 8,
            label: "Setback",
            notation: "d10",
            machineRolled: false,
            outcomes: [{ unit: 2, table: "setback", entryId: kiln.tables["setback"]!.entries[0]!.id, targetSubject: 1, at: "" }],
          },
        ]}
      />,
    );
    expect(html).toContain("your dice");
    expect(html).toContain("hit piece #1");
    expect(html).toContain('class="result heat"');
  });

  it("keeps every roll of a step on screen, and closes only once the step is done", () => {
    const form: RollReceipt = {
      dice: null,
      total: 4,
      label: "Form",
      notation: "d6",
      machineRolled: false,
      outcomes: [{ unit: 2, table: "form", entryId: kiln.tables["form"]!.entries[0]!.id, targetSubject: null, at: "" }],
    };
    const open = renderToStaticMarkup(<Receipt pack={kiln} settled={false} onDismiss={() => {}} receipts={[kilnCheck]} />);
    expect(open).toContain("73");
    expect(open).toContain("The next roll is below");
    expect(open).not.toContain("Carry on");

    const done = renderToStaticMarkup(<Receipt pack={kiln} settled onDismiss={() => {}} receipts={[kilnCheck, form]} />);
    expect(done).toContain("73");
    expect(done).toContain("Kiln Check");
    expect(done).toContain(">4<");
    expect(done).toContain("Form");
    expect(done.match(/class="entry"/g)?.length).toBe(2);
    expect(done.match(/Carry on/g)?.length).toBe(1);
  });

  it("offers to keep rolling only where it is asked to, after a roll the machine made", () => {
    const rolled: RollReceipt = { dice: null, total: 4, label: null, notation: "d6", machineRolled: true, outcomes: [] };
    const offered = renderToStaticMarkup(<Receipt pack={kiln} settled onDismiss={() => {}} onKeepRolling={() => {}} receipts={[rolled]} />);
    expect(offered).toContain("Keep rolling for me");
    const plain = renderToStaticMarkup(<Receipt pack={kiln} settled onDismiss={() => {}} receipts={[rolled]} />);
    expect(plain).not.toContain("Keep rolling for me");
  });

  /**
   * With a head the receipt is not a card above the step, it is the step's
   * own surface: the phase line, the title, the result, and a control at the
   * foot of it the size of the one the step had.
   */
  it("wears the step's head, and the step's size of control, where it stands in for one", () => {
    const head = { phase: "Kiln Check", label: "Roll the Kiln Check" };
    const html = renderToStaticMarkup(<Receipt pack={kiln} head={head} settled onDismiss={() => {}} receipts={[kilnCheck]} />);
    expect(html).toContain('<h3 class="sectionTitle">Kiln Check</h3>');
    expect(html).toContain('<h4 class="stepLabel">Roll the Kiln Check</h4>');
    expect(html).toContain('class="primary big"');
    // The head is the title now; the receipt does not say what it is twice.
    expect(html).not.toContain("What the dice did");
  });

  it("keeps the Finish shortcut beside Carry on, in the quieter look", () => {
    const head = { phase: "Fire", label: "Fire the Stage" };
    const html = renderToStaticMarkup(
      <Receipt
        pack={kiln}
        head={head}
        settled
        onDismiss={() => {}}
        onFinish={() => {}}
        finishWord="Finish the firing"
        receipts={[kilnCheck]}
      />,
    );
    expect(html).toContain('class="primary big"');
    expect(html).toContain('class="ghost big"');
    expect(html.indexOf("Carry on")).toBeLessThan(html.indexOf("Finish the firing"));
  });

  /**
   * Saying why a draw cannot be done used to open a form under the action
   * row, which put a second filled button in the surface and took the row's
   * place as the last thing in it, which is what holds the control at the
   * foot of the card.
   */
  it("asks why a draw cannot be done above the action row, not under it", () => {
    const head = { phase: "Kiln Check", label: "Roll the Kiln Check" };
    const shut = renderToStaticMarkup(
      <Receipt pack={kiln} head={head} settled onDismiss={() => {}} onDrawAgain={() => {}} receipts={[kilnCheck]} />,
    );
    expect(shut).toContain("Unmake this draw and roll again");
    expect(shut).not.toContain("drawAgain");

    // The same receipt with the form open, which is what pressing it does.
    const { container } = render(
      <Receipt pack={kiln} head={head} settled onDismiss={() => {}} onDrawAgain={() => {}} receipts={[kilnCheck]} />,
    );
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Can't do this one")!;
    fireEvent.click(open);

    const surface = container.querySelector("section.runStep")!;
    const row = surface.querySelector(":scope > .padRow.stepAction")!;
    const form = surface.querySelector(":scope > form.drawAgain")!;
    expect(form).toBeTruthy();
    // The row is still the last thing in the surface, and the form is above it.
    expect(surface.lastElementChild).toBe(row);
    expect(form.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And one filled button at a time: Carry on, with the form's own in the
    // quiet look beside its way out.
    expect(surface.querySelectorAll("button.primary").length).toBe(1);
    expect([...form.querySelectorAll("button")].map((b) => b.className)).toEqual(["ghost", "ghost"]);
  });

  it("still says something when a roll resolved nothing", () => {
    const html = renderToStaticMarkup(
      <Receipt
        pack={kiln}
        settled
        onDismiss={() => {}}
        receipts={[{ dice: null, total: 4, label: null, notation: "d6", machineRolled: false, outcomes: [] }]}
      />,
    );
    expect(html).toContain("It is recorded");
  });
});
