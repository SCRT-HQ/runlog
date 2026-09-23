// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Pack } from "@runlog/rules-schema";
import { loadMarketplace, shippedIds } from "../library/marketplace.ts";
import { WelcomeView, DEMO_NOW } from "./WelcomeView.tsx";
import { PERSONAS, personaById, type PersonaId } from "./personas.ts";
import { loadDemoPack } from "./demoPacks.ts";
import { generateDemoExample, type DemoExample } from "./demoScenario.ts";

/**
 * The landing page says one thing, and stays short, and its examples are
 * one generated run at a time.
 *
 * The word count is the guard against the page growing a section at a
 * time: the four sections between the headline and the pack shelf are a
 * budget. The rest is the example's state machine: the loader and the
 * generator are wrapped at the module boundary, so a test can hold a load
 * open, fail it, or hand back a model of its own, and every other test
 * runs the real bundled packs through the real generator.
 */

vi.mock("./demoPacks.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./demoPacks.ts")>();
  return { ...actual, loadDemoPack: vi.fn(actual.loadDemoPack) };
});
vi.mock("./demoScenario.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./demoScenario.ts")>();
  return { ...actual, generateDemoExample: vi.fn(actual.generateDemoExample) };
});

const actualPacks = await vi.importActual<typeof import("./demoPacks.ts")>("./demoPacks.ts");
const actualScenario = await vi.importActual<typeof import("./demoScenario.ts")>("./demoScenario.ts");
const load = vi.mocked(loadDemoPack);
const generate = vi.mocked(generateDemoExample);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
// The page remembers the persona on the device, so one test's chip would be
// the next test's opening example.
beforeEach(() => {
  localStorage.clear();
  load.mockReset();
  load.mockImplementation(actualPacks.loadDemoPack);
  generate.mockReset();
  generate.mockImplementation(actualScenario.generateDemoExample);
});

/**
 * The words of the four sections between the hero and the pack shelf.
 *
 * The page's own prose only: the example figures in them are a generated
 * run, as long as the pack's rolls make it, and are not what the budget
 * is for.
 */
function bodyWords(root: HTMLElement): number {
  return [...root.querySelectorAll(".welcomeSection")]
    .map((s) => {
      const prose = s.cloneNode(true) as HTMLElement;
      for (const figure of prose.querySelectorAll("figure")) figure.remove();
      return prose.textContent ?? "";
    })
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

/** A promise the test resolves or rejects when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A stand-in pack: the fake generator below never reads it. */
const fakePack = (id: PersonaId) => ({ id }) as unknown as Pack;

/** A hand-built model whose every string names its persona and generation, so a mix of two would show. */
function fakeExample(personaId: PersonaId, generation: number, signature = `${personaId}:${generation}`): DemoExample {
  const tag = `${personaId} g${generation}`;
  const line = (n: number) => ({
    id: `outcome:${n}`,
    where: `Where ${tag} ${n}`,
    roll: `d6 → ${n}`,
    text: `Text ${tag} line ${n}`,
    heat: n === 2,
    provenance: { eventIndex: n, outcomeIndex: n, tableId: "t", entryId: `e${n}`, roll: { dice: "d6", total: n, eventIndex: n } },
  });
  return {
    personaId,
    generation,
    signature,
    packId: `pack.${personaId}`,
    packTitle: `Pack ${tag}`,
    modeId: "mode",
    modeLabel: `Mode ${tag}`,
    at: `Unit ${tag}`,
    participant: null,
    lines: [line(1), line(2)],
    historyLineIds: ["outcome:1", "outcome:2"],
    state: [{ label: `Label ${tag}`, value: "1" }],
    widgets: [
      { kind: "ticker", title: `Ticker ${tag}`, lineId: "outcome:2" },
      { kind: "clock", title: `Clock ${tag}`, value: "0:01" },
    ],
    widgetCaption: `Caption ${tag}`,
  };
}

/** Wire the fake generator: each call returns `fakeExample` unless a signature is given for that generation. */
function fakeGenerator(signatures: Record<number, string> = {}) {
  load.mockImplementation(async (id) => fakePack(id));
  generate.mockImplementation((persona, _pack, { generation }) => fakeExample(persona.id, generation, signatures[generation]));
}

const hero = (c: HTMLElement) => c.querySelector(".welcomeHero .specimen")?.textContent ?? "";
const widgets = (c: HTMLElement) => c.querySelector(".welcomeWidget")?.textContent ?? "";
const history = (c: HTMLElement) => c.querySelector(".welcomeExcerpt")?.textContent ?? "";
const exampleText = (c: HTMLElement) => [hero(c), widgets(c), history(c)].join(" ");
const another = () => screen.getByRole("button", { name: "Another example" });

/** Render the page and wait until the first example is on it. */
async function renderLoaded() {
  const view = render(<WelcomeView />);
  await waitFor(() => expect(view.container.querySelector(".welcomeHero .specimenLog")).not.toBeNull());
  return view;
}

describe("the welcome page", () => {
  it("says what Runlog is once, and says it the same way every time", async () => {
    const { container } = await renderLoaded();
    const text = container.textContent ?? "";
    expect(text.split("Runlog is a constraint engine.")).toHaveLength(2);
    expect(text.split("Runlog controls the rules. You control the outcome.")).toHaveLength(2);
    // Nothing in the headline turns with the persona.
    expect(container.querySelector("h2")?.textContent).toBe("Runlog is a constraint engine.");
  });

  it("keeps the body between the headline and the packs under 320 words", async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll(".welcomeSection")).toHaveLength(4);
    // The prose is about 233 words; the limit leaves room to reword, not to add a paragraph.
    expect(bodyWords(container)).toBeLessThan(255);
  });

  it("offers one button to play, and one way to the packs, in the hero", async () => {
    const { container } = await renderLoaded();
    const heroSection = container.querySelector(".welcomeHero");
    if (!heroSection) throw new Error("no hero");
    const labels = [...heroSection.querySelectorAll("a")].map((a) => a.textContent);
    expect(labels).toContain("Play");
    expect(labels).toContain("See the packs");
    expect(labels).not.toContain("Read the guide");
  });

  it("gives each pack a card of its title and its first sentence, and no more", async () => {
    const { container } = await renderLoaded();
    // Wait for the real lazy pack source, not the default one-second DOM-query
    // deadline: instrumented CI can take longer to import and parse the YAML.
    await act(async () => {
      await Promise.all([loadMarketplace({ testing: false }), shippedIds()]);
    });
    expect(screen.getByText("A penalty wheel for any stream.")).toBeTruthy();
    expect(container.querySelectorAll(".welcomePack")).toHaveLength(9);
    expect(container.textContent).not.toContain("Every round spins what it is worth");
  });

  it("leaves the eight reasons, the second stream list and the closing line behind", async () => {
    const { container } = await renderLoaded();
    const text = container.textContent ?? "";
    for (const gone of ["Why Runlog", "Paper included", "Sell it your way", "Dice you can read", "A table with company", "What it costs"])
      expect(text).not.toContain(gone);
  });
});

describe("the example, from the real packs", () => {
  it("loads one example for the first persona, and the hero, the widgets and the history all show it", async () => {
    const { container } = await renderLoaded();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("streamer");
    expect(generate).toHaveBeenCalledTimes(1);
    const shown = generate.mock.results[0]!.value as DemoExample;
    expect(shown.generation).toBe(0);
    expect(hero(container)).toContain(`Example · ${shown.packTitle} · ${shown.modeLabel} · ${shown.at}`);
    for (const line of shown.lines) expect(hero(container)).toContain(line.text);
    expect(widgets(container)).toContain(shown.widgetCaption);
    for (const id of shown.historyLineIds) expect(history(container)).toContain(shown.lines.find((l) => l.id === id)!.text);
    // The streamer's board and its trackers are the same run's standings and counters.
    const board = shown.widgets.find((w) => w.kind === "scoreboard");
    if (board?.kind !== "scoreboard") throw new Error("the streamer example has no scoreboard");
    const rows = [...container.querySelectorAll(".welcomeWidget .widgetBoard li")].map((li) => li.textContent);
    expect(rows).toEqual(board.rows.map((r) => `#${r.place}${r.name}${r.points}`));
    for (const entry of shown.state) {
      expect(hero(container)).toContain(`${entry.label} ${entry.value}`);
      expect(widgets(container)).toContain(`${entry.label}${entry.value}`);
    }
    // Generated at the fixed time, never the clock on the wall.
    expect(generate.mock.calls[0]![2]).toEqual({ generation: 0, now: DEMO_NOW });
  });

  it.each(["dj", "learner", "elden-lord", "rlcs-champion"] as const)(
    "shows %s's own pack and mode, with no scoreboard and nobody racing",
    async (id) => {
      const { container } = await renderLoaded();
      const persona = personaById(id);
      fireEvent.click(screen.getByRole("button", { name: persona.noun }));
      await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
      expect(load).toHaveBeenLastCalledWith(id);
      const shown = generate.mock.results[1]!.value as DemoExample;
      await waitFor(() => expect(hero(container)).toContain(shown.packTitle));
      expect(shown.packId).toBe(persona.packId);
      expect(shown.modeId).toBe(persona.modeId);
      expect(hero(container)).toContain(shown.modeLabel);
      expect(container.querySelector(".welcomeWidget .widgetBoard")).toBeNull();
      expect(exampleText(container)).not.toMatch(/scoreboard|racing/i);
    },
  );

  it("names at most one learner, and only an ordinary first name", async () => {
    localStorage.setItem("runlog:persona", "learner");
    const { container } = await renderLoaded();
    const text = container.querySelector(".welcomeMain")?.textContent ?? "";
    const names = ["Alex", "Sam", "Jordan", "Casey", "Riley"].filter((n) => new RegExp(`\\b${n}\\b`).test(text));
    expect(names.length).toBeLessThanOrEqual(1);
    expect(container.querySelector(".widgetBoard")).toBeNull();
  });

  it("labels the content as an example, not as live activity", async () => {
    const { container } = await renderLoaded();
    expect(hero(container)).toMatch(/^Example · /);
    expect(container.querySelector(".welcomeHero .specimen")?.getAttribute("aria-label")).toMatch(/^An example run/);
    expect(container.querySelector(".welcomeWidget")?.getAttribute("aria-label")).toMatch(/^Example widgets/);
    const excerpt = container.querySelector(".welcomeExcerpt");
    expect(excerpt?.getAttribute("aria-label")).toBe("Lines from this example run");
    expect(excerpt?.querySelector("figcaption")?.textContent).toBe("Example");
  });
});

describe("choosing a persona", () => {
  it("opens on the first persona for a retired, unknown or unreadable choice", async () => {
    for (const stored of ["lifter", "nobody"]) {
      localStorage.setItem("runlog:persona", stored);
      await renderLoaded();
      expect(screen.getByRole("button", { name: PERSONAS[0]!.noun }).getAttribute("aria-pressed")).toBe("true");
      expect(load).toHaveBeenLastCalledWith("streamer");
      cleanup();
    }
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await renderLoaded();
    expect(screen.getByRole("button", { name: PERSONAS[0]!.noun }).getAttribute("aria-pressed")).toBe("true");
  });

  it("still switches when the device will not remember the choice", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    fakeGenerator();
    const { container } = await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: personaById("dj").noun }));
    await waitFor(() => expect(hero(container)).toContain("Pack dj g0"));
  });

  it("remembers the choice on the device", async () => {
    fakeGenerator();
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: personaById("elden-lord").noun }));
    expect(localStorage.getItem("runlog:persona")).toBe("elden-lord");
  });

  it("shows the newest choice when two loads finish out of order", async () => {
    fakeGenerator();
    const { container } = await renderLoaded();
    const dj = deferred<Pack>();
    const learner = deferred<Pack>();
    load.mockImplementation((id) => (id === "dj" ? dj.promise : learner.promise));
    fireEvent.click(screen.getByRole("button", { name: personaById("dj").noun }));
    fireEvent.click(screen.getByRole("button", { name: personaById("learner").noun }));
    await act(async () => learner.resolve(fakePack("learner")));
    await act(async () => dj.resolve(fakePack("dj")));
    expect(hero(container)).toContain("Pack learner g0");
    expect(exampleText(container)).not.toContain("dj g0");
    expect(screen.getByRole("button", { name: personaById("learner").noun }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the old example whole, and never relabels it, while the new one loads", async () => {
    fakeGenerator();
    const { container } = await renderLoaded();
    const pending = deferred<Pack>();
    load.mockImplementation(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: personaById("dj").noun }));
    expect(screen.getByRole("button", { name: personaById("dj").noun }).getAttribute("aria-pressed")).toBe("true");
    expect(hero(container)).toContain("Pack streamer g0");
    expect(widgets(container)).toContain("Caption streamer g0");
    expect(history(container)).toContain("Text streamer g0 line 1");
    expect(exampleText(container)).not.toMatch(/dj|Soundclash/);
    expect(screen.getByText("Loading…")).toBeTruthy();
    await act(async () => pending.resolve(fakePack("dj")));
    expect(hero(container)).toContain("Pack dj g0");
    expect(widgets(container)).toContain("Caption dj g0");
    expect(history(container)).toContain("Text dj g0 line 1");
    expect(exampleText(container)).not.toContain("streamer g0");
    expect(screen.queryByText("Loading…")).toBeNull();
  });
});

describe("going back to a persona", () => {
  it("shows the same example again after another persona failed, without trying a new generation", async () => {
    fakeGenerator();
    const { container } = await renderLoaded();
    load.mockRejectedValue(new Error("no pack"));
    fireEvent.click(screen.getByRole("button", { name: personaById("dj").noun }));
    await screen.findByText("Example unavailable");
    load.mockImplementation(async (id) => fakePack(id));
    generate.mockClear();
    fireEvent.click(screen.getByRole("button", { name: personaById("streamer").noun }));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(hero(container)).toContain("Pack streamer g0");
    expect(generate.mock.calls.map((c) => c[2].generation).filter((g) => g > 0)).toEqual([]);
    expect(screen.queryByText("Example unavailable")).toBeNull();
  });

  it("shows the same example again after another persona's load was left pending", async () => {
    fakeGenerator();
    const { container } = await renderLoaded();
    const pending = deferred<Pack>();
    load.mockImplementation(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: personaById("dj").noun }));
    load.mockImplementation(async (id) => fakePack(id));
    generate.mockClear();
    fireEvent.click(screen.getByRole("button", { name: personaById("streamer").noun }));
    await act(async () => pending.resolve(fakePack("dj")));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(hero(container)).toContain("Pack streamer g0");
    expect(generate.mock.calls.map((c) => c[2].generation).filter((g) => g > 0)).toEqual([]);
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("does not skip a repeated signature when a persona is chosen, only when another example is asked for", async () => {
    // streamer g0 and the returning streamer g0 share a signature; a retry would move to g1.
    fakeGenerator({ 0: "same", 1: "other" });
    const { container } = await renderLoaded();
    const pending = deferred<Pack>();
    load.mockImplementation((id) => (id === "dj" ? pending.promise : Promise.resolve(fakePack(id))));
    fireEvent.click(screen.getByRole("button", { name: personaById("dj").noun }));
    fireEvent.click(screen.getByRole("button", { name: personaById("streamer").noun }));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(hero(container)).toContain("Pack streamer g0");
  });
});

describe("when an example cannot be made", () => {
  it("tries again when the chip of a persona that failed is pressed again", async () => {
    fakeGenerator();
    const { container } = await renderLoaded();
    load.mockRejectedValue(new Error("no pack"));
    const dj = screen.getByRole("button", { name: personaById("dj").noun });
    fireEvent.click(dj);
    await screen.findByText("Example unavailable");
    load.mockImplementation(async (id) => fakePack(id));
    fireEvent.click(dj);
    await waitFor(() => expect(hero(container)).toContain("Pack dj g0"));
    expect(screen.queryByText("Example unavailable")).toBeNull();
  });

  it("says so plainly on the first load, claims nothing about a pack, and leaves the page usable", async () => {
    load.mockRejectedValue(new Error("no pack"));
    const { container } = render(<WelcomeView />);
    await screen.findByText("Example unavailable");
    expect(container.querySelector(".specimenLog")).toBeNull();
    expect(container.querySelector(".welcomeWidget .widgetBody")).toBeNull();
    expect(hero(container)).not.toMatch(/Forfeits|Round/);
    expect(screen.getAllByRole("link", { name: "Play" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("checkbox", { name: "Skip this page next time" })).toBeTruthy();
    // The chips still work, and a good load clears the status.
    fakeGenerator();
    fireEvent.click(screen.getByRole("button", { name: personaById("dj").noun }));
    await waitFor(() => expect(hero(container)).toContain("Pack dj g0"));
    expect(screen.queryByText("Example unavailable")).toBeNull();
  });

  it("keeps the example it has when a replacement fails, and says the new one is unavailable", async () => {
    fakeGenerator();
    const { container } = await renderLoaded();
    load.mockRejectedValue(new Error("no pack"));
    fireEvent.click(screen.getByRole("button", { name: personaById("dj").noun }));
    await screen.findByText("Example unavailable");
    expect(hero(container)).toContain("Pack streamer g0");
    expect(widgets(container)).toContain("Caption streamer g0");
    expect(screen.getByRole("button", { name: personaById("streamer").noun })).toBeTruthy();
  });

  it("treats a generator that throws as an unavailable example", async () => {
    load.mockImplementation(async (id) => fakePack(id));
    generate.mockImplementation(() => {
      throw new Error("bad run");
    });
    render(<WelcomeView />);
    await screen.findByText("Example unavailable");
  });

  it("announces nothing: the status is plain text, not a live region", async () => {
    load.mockRejectedValue(new Error("no pack"));
    const { container } = render(<WelcomeView />);
    await screen.findByText("Example unavailable");
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });
});

describe("another example", () => {
  it("is the only way to vary the example, and keeps focus while it loads the next", async () => {
    fakeGenerator();
    const { container } = await renderLoaded();
    expect(screen.getAllByRole("button", { name: /example/i })).toHaveLength(1);
    const button = another();
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(hero(container)).toContain("Pack streamer g1"));
    expect(another()).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(generate.mock.calls.at(-1)![2]).toEqual({ generation: 1, now: DEMO_NOW });
    expect(exampleText(container)).not.toContain("streamer g0");
  });

  it("does nothing while its request is pending, and keeps focus", async () => {
    fakeGenerator();
    const { container } = await renderLoaded();
    const pending = deferred<Pack>();
    load.mockImplementation(() => pending.promise);
    const button = another();
    button.focus();
    fireEvent.click(button);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(fakePack("streamer")));
    expect(hero(container)).toContain("Pack streamer g1");
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    expect(document.activeElement).toBe(button);
  });

  it("skips a signature it just showed, trying at most four generations and then taking the repeat", async () => {
    // Generations 1 and 2 would repeat what generation 0 showed; 3 is new.
    // From 4 on, every candidate repeats.
    fakeGenerator({ 0: "same", 1: "same", 2: "same", 4: "stuck", 5: "stuck", 6: "stuck", 7: "stuck", 8: "stuck", 9: "stuck" });
    const { container } = await renderLoaded();
    fireEvent.click(another());
    await waitFor(() => expect(hero(container)).toContain("Pack streamer g3"));
    expect(generate.mock.calls.map((c) => c[2].generation)).toEqual([0, 1, 2, 3]);
    // The next press carries on from the generation shown, not the one asked for.
    fireEvent.click(another());
    await waitFor(() => expect(hero(container)).toContain("Pack streamer g4"));

    // Four tries, then the repeat stands rather than looping.
    generate.mockClear();
    fireEvent.click(another());
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(hero(container)).toContain("Pack streamer g8"));
    expect(generate.mock.calls.map((c) => c[2].generation)).toEqual([5, 6, 7, 8]);
  });

  it("never varies on its own: no timer, and no rerender, theme or viewport change makes a new one", async () => {
    fakeGenerator();
    const { container, rerender } = await renderLoaded();
    // Spied from here on: Testing Library's own waitFor polls on an interval.
    const intervals = vi.spyOn(window, "setInterval");
    const calls = generate.mock.calls.length;
    rerender(<WelcomeView />);
    act(() => {
      document.documentElement.setAttribute("data-theme", "dark");
      document.documentElement.classList.add("reduced-motion");
      window.dispatchEvent(new Event("resize"));
    });
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(generate.mock.calls.length).toBe(calls);
    expect(hero(container)).toContain("Pack streamer g0");
    expect(intervals).not.toHaveBeenCalled();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("reduced-motion");
  });

  it("does not reload when the chosen persona's chip is pressed again", async () => {
    fakeGenerator();
    await renderLoaded();
    fireEvent.click(another());
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: PERSONAS[0]!.noun }));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
