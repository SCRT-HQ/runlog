// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { SetupPicker } from "./SetupPicker.tsx";

// The picker draws nothing until it has read the built-in profiles and the
// setups on the shelf, and every wait below is for that read. A second is
// the library's default and it is not enough of one on a busy worker: the
// whole suite running at once was already failing this file's first find.
configure({ asyncUtilTimeout: 5000 });

/**
 * Choosing what a run starts under, where the run starts.
 *
 * Two things are worth holding down here. The section calls itself
 * whatever the pack calls it, because "Setup" is what the format says and
 * not what anybody playing says. And it does not appear at all for a pack
 * whose game has no tool attached, so no one is shown a chooser of
 * nothing with a paragraph explaining the nothing.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const load = (rel: string): Pack => {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
};

// The one pack here with a shipped profile, which is what says a tool.
const withTool = load("packs/sketches/elden-ring-tarnishedtool.yaml");
const withoutTool = load("packs/demo/pack.yaml");

afterEach(cleanup);

/**
 * One row of the menu, rather than the summary button above it.
 *
 * Once something is chosen the summary names it, so "Give Runes" would
 * match both. The rows are the listbox's options; the summary is not.
 */
const choice = async (name: RegExp): Promise<HTMLElement> => {
  const rows = await screen.findAllByRole("option", { name });
  const row = rows[0];
  if (!row) throw new Error(`no option for ${name}`);
  return row;
};

describe("choosing a setup", () => {
  it("calls itself what the pack calls it", async () => {
    render(<SetupPicker pack={withTool} chosen={null} onChoose={() => {}} />);
    // The pack says loadout; the document, the file and the marketplace
    // go on saying setup, and the player never sees that word.
    await screen.findByRole("heading", { name: /Loadout/ });
    expect(screen.queryByRole("heading", { name: /^Setup/ })).toBeNull();
  });

  /**
   * The list is folded away, because it is eleven cards on a page that
   * also has a mode, a seed, a name and the requirements. What the fold
   * must never do is hide that there is anything to open: a button
   * reading "None" is a statement, so with nothing chosen it says what
   * pressing it is for instead.
   */
  it("keeps the list folded, behind a button that says what it opens", async () => {
    render(<SetupPicker pack={withTool} chosen={null} onChoose={() => {}} />);
    const summary = await screen.findByRole("button", { name: /Choose a Loadout/ });
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("option", { name: /Bare-handed/ })).toBeNull();
  });

  it("does not submit an enclosing form from its raw menu buttons", async () => {
    const submitted = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={submitted}>
        <SetupPicker pack={withTool} chosen={null} onChoose={() => {}} />
      </form>,
    );
    const summary = await screen.findByRole("button", { name: /Choose a Loadout/ });
    expect((summary as HTMLButtonElement).type).toBe("button");
    fireEvent.click(summary);
    const none = screen.getByRole("option", { name: /None/ });
    expect((none as HTMLButtonElement).type).toBe("button");
    fireEvent.click(none);
    expect(submitted).not.toHaveBeenCalled();
  });

  it("offers the ones written for this run's tool, and None first", async () => {
    render(<SetupPicker pack={withTool} chosen={null} onChoose={() => {}} />);
    (await screen.findByRole("button", { name: /Choose a Loadout/ })).click();
    await screen.findAllByRole("option", { name: /Bare-handed/ });
    const offered = screen.getAllByRole("option").map((b) => b.textContent ?? "");
    expect(offered.some((t) => t.includes("None"))).toBe(true);
    expect(offered.some((t) => t.includes("Well armed"))).toBe(true);
    // The leveling ones are written for the same tool, so they are here too.
    expect(offered.some((t) => t.includes("Give Smithing Stones"))).toBe(true);
  });

  it("hands back the operations, not just a name, so the run keeps what it was given", async () => {
    const chosen = vi.fn();
    render(<SetupPicker pack={withTool} chosen={null} onChoose={chosen} />);
    (await screen.findByRole("button", { name: /Choose a Loadout/ })).click();
    (await choice(/Bare-handed/)).click();
    expect(chosen).toHaveBeenCalledTimes(1);
    const arg = chosen.mock.calls[0]?.[0];
    expect(arg.from.map((f: { title: string }) => f.title)).toEqual(["Bare-handed"]);
    expect(arg.ops.length).toBeGreaterThan(0);
    // A gift, kept as one: what stops it being handed over again on
    // every reconnect is this flag surviving the trip.
    expect(arg.ops.some((o: { once?: boolean }) => o.once === true)).toBe(true);
  });

  /**
   * Wanting two is the ordinary case. A loadout says what you are
   * wearing and another says what you are carrying, and the run is the
   * two of them together.
   */
  it("takes more than one, and keeps both names and both lots of operations", async () => {
    const chosen = vi.fn();
    const { rerender } = render(<SetupPicker pack={withTool} chosen={null} onChoose={chosen} />);
    (await screen.findByRole("button", { name: /Choose a Loadout/ })).click();
    (await choice(/Bare-handed/)).click();

    const first = chosen.mock.calls[0]?.[0];
    rerender(<SetupPicker pack={withTool} chosen={first} onChoose={chosen} />);
    (await choice(/Give Runes/)).click();

    const both = chosen.mock.calls[1]?.[0];
    expect(both.from.map((f: { title: string }) => f.title)).toEqual(["Bare-handed", "Give Runes"]);
    expect(both.ops.length).toBe(first.ops.length + 1);
    // Ticking it again takes it back off.
    rerender(<SetupPicker pack={withTool} chosen={both} onChoose={chosen} />);
    (await choice(/Give Runes/)).click();
    expect(chosen.mock.calls[2]?.[0].from.map((f: { title: string }) => f.title)).toEqual(["Bare-handed"]);
  });

  /**
   * The point of the editor being here: a loadout that is almost right
   * is more common than one that is exactly right, and the alternative
   * is starting the run and then going to fix it.
   */
  it("shows what was handed over, so it can be changed before the run starts", async () => {
    const chosen = vi.fn();
    const { rerender } = render(<SetupPicker pack={withTool} chosen={null} onChoose={chosen} />);
    (await screen.findByRole("button", { name: /Choose a Loadout/ })).click();
    (await choice(/Bare-handed/)).click();

    rerender(<SetupPicker pack={withTool} chosen={chosen.mock.calls[0]?.[0]} onChoose={chosen} />);
    await screen.findByRole("heading", { name: /What that hands over/ });
    // Every operation is a row with a way to take it off the list.
    expect(screen.getAllByRole("button", { name: /Remove this/ }).length).toBeGreaterThan(0);
  });

  /**
   * "None" is an empty list, not the absence of one.
   *
   * Terms without a loadout behind them are an ordinary thing to want:
   * one line, written here, with nothing else attached. If the editor
   * only appeared once something was ticked there would be no way to
   * write that without picking a loadout first and then emptying it.
   */
  it("offers the editor under None too, as an empty list to add to", async () => {
    render(<SetupPicker pack={withTool} chosen={null} onChoose={() => {}} />);
    await screen.findByRole("heading", { name: /What that hands over/ });
    await screen.findByRole("button", { name: /Add custom loadout/i });
    // Nothing is on the list yet, so there is nothing to remove from it.
    expect(screen.queryAllByRole("button", { name: /Remove this/ })).toEqual([]);
  });

  it("says nothing at all where no tool plays this pack", async () => {
    const { container } = render(<SetupPicker pack={withoutTool} chosen={null} onChoose={() => {}} />);
    // Waited for rather than asserted immediately: the shelf is read in an
    // effect, so an empty container proves nothing until it has been read.
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
