// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { SetupPicker } from "./SetupPicker.tsx";

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

describe("choosing a setup", () => {
  it("calls itself what the pack calls it", async () => {
    render(<SetupPicker pack={withTool} chosen={null} onChoose={() => {}} />);
    // The pack says loadout; the document, the file and the marketplace
    // go on saying setup, and the player never sees that word.
    await screen.findByRole("heading", { name: /Loadout/ });
    expect(screen.queryByRole("heading", { name: /^Setup/ })).toBeNull();
  });

  it("offers the ones written for this run's tool, and None first", async () => {
    render(<SetupPicker pack={withTool} chosen={null} onChoose={() => {}} />);
    await screen.findByRole("button", { name: /Bare-handed/ });
    const offered = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(offered[0]).toContain("None");
    expect(offered.some((t) => t.includes("Well armed"))).toBe(true);
  });

  it("hands back the operations, not just a name, so the run keeps what it was given", async () => {
    const chosen = vi.fn();
    render(<SetupPicker pack={withTool} chosen={null} onChoose={chosen} />);
    (await screen.findByRole("button", { name: /Bare-handed/ })).click();
    expect(chosen).toHaveBeenCalledTimes(1);
    const arg = chosen.mock.calls[0]?.[0];
    expect(arg.title).toBe("Bare-handed");
    expect(arg.ops.length).toBeGreaterThan(0);
    // A gift, kept as one: what stops it being handed over again on
    // every reconnect is this flag surviving the trip.
    expect(arg.ops.some((o: { once?: boolean }) => o.once === true)).toBe(true);
  });

  it("says nothing at all where no tool plays this pack", async () => {
    const { container } = render(<SetupPicker pack={withoutTool} chosen={null} onChoose={() => {}} />);
    // Waited for rather than asserted immediately: the shelf is read in an
    // effect, so an empty container proves nothing until it has been read.
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
