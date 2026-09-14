// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import { StartScreen } from "./RunView.tsx";

/**
 * The seed is the only thing that decides whether a run is seeded.
 *
 * It used to take a seed *and* a mode declaring itself seeded, so two
 * people who had agreed on a seed met different runs depending on which
 * mode they picked, and a pack whose author had written no seeded mode
 * could not race at all. What a mode calling itself seeded still decides
 * is that it cannot be started without one.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

/** The demo pack's shared mode, which is the one that calls itself seeded. */
const shared = Object.entries(kiln.modes).find(([, m]) => m.seeded)![0];
const ordinary = Object.entries(kiln.modes).find(([, m]) => !m.seeded)![0];
const label = (id: string) => kiln.modes[id]!.label;

const seedBox = () => screen.getByPlaceholderText(/unseeded|long-kiln/) as HTMLInputElement;
const begin = () => screen.getByRole("button", { name: /^(Begin|Enter) the/i }) as HTMLButtonElement;

afterEach(cleanup);

describe("starting a run", () => {
  it("offers a seed on an ordinary mode, and starts with the one you typed", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={kiln} onStart={onStart} />);
    fireEvent.click(screen.getByText(label(ordinary)));
    fireEvent.change(seedBox(), { target: { value: "kiln-7" } });
    fireEvent.click(begin());
    expect(onStart.mock.calls[0]?.[1]).toBe("kiln-7");
  });

  it("still starts an ordinary mode with no seed at all", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={kiln} onStart={onStart} />);
    fireEvent.click(screen.getByText(label(ordinary)));
    expect(begin().disabled).toBe(false);
    fireEvent.click(begin());
    expect(onStart.mock.calls[0]?.[1]).toBe("");
  });

  /**
   * The one job left to the mode flag. Starting a shared mode unseeded
   * gives you a private run and no sign that nobody will ever match it.
   */
  it("will not start a mode meant to be shared without one", () => {
    render(<StartScreen pack={kiln} onStart={vi.fn()} />);
    fireEvent.click(screen.getByText(label(shared)));
    expect(begin().disabled).toBe(true);
    expect(begin().title).toContain("needs a seed");
    fireEvent.change(seedBox(), { target: { value: "kiln-7" } });
    expect(begin().disabled).toBe(false);
  });

  it("counts a box of spaces as no seed, since that is what it is", () => {
    render(<StartScreen pack={kiln} onStart={vi.fn()} />);
    fireEvent.click(screen.getByText(label(shared)));
    fireEvent.change(seedBox(), { target: { value: "   " } });
    expect(begin().disabled).toBe(true);
  });

  it("makes one on request, in both kinds of mode", () => {
    render(<StartScreen pack={kiln} onStart={vi.fn()} />);
    for (const mode of [ordinary, shared]) {
      fireEvent.click(screen.getByText(label(mode)));
      fireEvent.click(screen.getByRole("button", { name: "Make one" }));
      expect(seedBox().value.length).toBeGreaterThan(0);
    }
  });
});

describe("racing", () => {
  const race = () => ({ start: vi.fn(), join: vi.fn(), note: null });

  /** Which is what a pack with no seeded mode could not do before. */
  it("is offered from an ordinary mode", () => {
    const r = race();
    render(<StartScreen pack={kiln} onStart={vi.fn()} race={r} />);
    fireEvent.click(screen.getByText(label(ordinary)));
    fireEvent.change(seedBox(), { target: { value: "kiln-7" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a race" }));
    expect(r.start.mock.calls[0]?.[0]).toBe(ordinary);
    expect(r.start.mock.calls[0]?.[1]).toBe("kiln-7");
  });

  /** A race without one would be several people playing alone. */
  it("makes a seed where the box was left empty, rather than racing unseeded", () => {
    const r = race();
    render(<StartScreen pack={kiln} onStart={vi.fn()} race={r} />);
    fireEvent.click(screen.getByText(label(ordinary)));
    fireEvent.click(screen.getByRole("button", { name: "Start a race" }));
    expect(r.start.mock.calls[0]?.[1]).toBeTruthy();
  });

  it("says nothing about races where there is no account to hold one", () => {
    render(<StartScreen pack={kiln} onStart={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Start a race" })).toBeNull();
  });
});
