// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { StartScreen } from "./StartScreen.tsx";

// The shipped setups and profiles are read from disk by SetupPicker's effect.
// This suite is about the parent screen and ends synchronously, so leave that
// separately tested I/O out rather than tearing its imports down mid-read.
vi.mock("../control/setups.ts", async (original) => ({
  ...(await original<typeof import("../control/setups.ts")>()),
  setupsHere: async () => [],
}));
vi.mock("../control/builtin.ts", async (original) => ({
  ...(await original<typeof import("../control/builtin.ts")>()),
  builtins: async () => [],
}));

/**
 * The order the setup asks in, and what it refuses to ask twice.
 *
 * What the screen is for is answered top to bottom: what this is, what kind
 * of run, what it takes to play one, who is playing, and the seed where the
 * mode cannot go without one. A preference waits under Advanced. A thing
 * the start button waits on never does, because a fold that hides a
 * requirement leaves somebody looking at a dead button with no way to find
 * out why.
 *
 * Underneath, nothing moved. `onStart` is called with the arguments it was
 * always called with, in every kind of mode.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const load = (rel: string): Pack => {
  const r = loadPackText(readFileSync(join(repoRoot, rel), "utf8"), "yaml");
  if (!r.ok) throw new Error(`could not load ${rel}`);
  return r.pack;
};

/**
 * One pack with all three kinds of mode in it: a solo default, a moderated
 * roster, and one that calls itself seeded. Its requirements have an
 * optional among them, which is the other thing this screen has to keep.
 */
const forfeits = load("packs/sketches/forfeits.yaml");
const demo = load("packs/demo/pack.yaml");
const SOLO = "everyDeath";
const MODERATED = "chats";
const SEEDED = "seeded";
const labelOf = (id: string) => forfeits.modes[id]!.label;

const ADVANCED_KEY = "runlog:disclosure.v1:setupAdvanced";

/** Every question the screen asks, in the order it asks it. */
const asked = () =>
  Array.from(document.querySelectorAll("h3.sectionTitle, label.fieldLabel")).map((el) => el.textContent?.replace(/\s+/g, " ").trim());

const fold = () => document.querySelector("details.setupAdvanced") as HTMLDetailsElement;
const seedBox = () => screen.getByPlaceholderText(/unseeded|long-kiln/) as HTMLInputElement;
const start = () => screen.getByRole("button", { name: /^Enter the/i }) as HTMLButtonElement;
const startForm = () => start().form as HTMLFormElement;
const pick = (id: string) => fireEvent.click(screen.getByText(labelOf(id)));
const imeEnters = [
  { key: "Enter", isComposing: true },
  { key: "Enter", isComposing: false, keyCode: 229 },
];

/** jsdom does not fire `toggle` off a click on the summary, so the press is spelled out. */
function press(details: HTMLDetailsElement) {
  details.open = !details.open;
  fireEvent(details, new Event("toggle", { bubbles: false }));
  return details;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the order the setup asks in", () => {
  it("leads with the pack, then asks for the mode, what it needs, and a name", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    const head = document.querySelector(".setupHead") as HTMLElement;
    expect(head.textContent).toContain(forfeits.title);
    expect(head.textContent).toContain("A penalty wheel for any stream");
    expect(asked()).toEqual(["Mode", "Length 1-20", "What it needs", "Advanced", "Seed optional", "Name it optional"]);
    expect(start()).toBeTruthy();
  });

  it("keeps Advanced folded, with the optional seed inside it", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    expect(fold().open).toBe(false);
    expect(fold().contains(seedBox())).toBe(true);
  });

  it("puts a required seed in the open, above Advanced, and marks it required", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    pick(SEEDED);
    const box = seedBox();
    expect(box.required).toBe(true);
    expect(fold().contains(box)).toBe(false);
    // Asked for before the fold is offered, not after it.
    expect(asked().indexOf("Seed required")).toBeLessThan(asked().indexOf("Advanced"));
  });

  it("asks who plays, with the range on the field that blocks the start", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    pick(MODERATED);
    expect(asked()).toContain("Who plays");
    expect(asked()).toContain("Contestants 2-12");

    const box = screen.getByPlaceholderText("a contestant's name") as HTMLInputElement;
    expect(start().disabled).toBe(true);
    const said = screen.getByText("Add 2 or more contestants first");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("aria-describedby")).toContain(said.id);

    for (const name of ["Ada", "Bo"]) {
      fireEvent.change(box, { target: { value: name } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    }
    expect(screen.queryByText("Add 2 or more contestants first")).toBeNull();
    expect(start().disabled).toBe(false);
  });

  /** Solo is solo: nobody is asked how many people are in the room. */
  it("says nothing about who plays for a mode that seats one", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    expect(asked()).not.toContain("Who plays");
  });
});

describe("choosing a mode", () => {
  it("is a radio group, with the chosen one marked and alone in the tab order", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    const group = screen.getByRole("radiogroup");
    expect(group.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading", { name: "Mode" }).id);
    const cards = screen.getAllByRole("radio");
    expect(cards.length).toBe(Object.keys(forfeits.modes).length);
    expect(cards.filter((c) => c.getAttribute("aria-checked") === "true").length).toBe(1);
    expect(cards.filter((c) => c.getAttribute("tabindex") === "0").length).toBe(1);
  });

  it("keeps the author's description under each title, whole", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    for (const m of Object.values(forfeits.modes)) {
      expect(screen.getByText(m.label)).toBeTruthy();
      if (m.description) expect(screen.getByText(m.description)).toBeTruthy();
    }
  });

  it("moves the choice on the arrow keys, and wraps at the ends", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    const ids = Object.keys(forfeits.modes);
    const checked = () => screen.getAllByRole("radio").findIndex((c) => c.getAttribute("aria-checked") === "true");
    const on = () => screen.getAllByRole("radio")[checked()]!;

    expect(ids[checked()]).toBe(SOLO);
    fireEvent.keyDown(on(), { key: "ArrowRight" });
    expect(ids[checked()]).toBe(ids[1]);
    fireEvent.keyDown(on(), { key: "ArrowDown" });
    expect(ids[checked()]).toBe(ids[2]);
    fireEvent.keyDown(on(), { key: "ArrowRight" });
    expect(ids[checked()]).toBe(ids[0]);
    fireEvent.keyDown(on(), { key: "ArrowUp" });
    expect(ids[checked()]).toBe(ids[2]);
  });

  it("leaves a key that is not an arrow to the browser", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    const before = screen.getAllByRole("radio").map((c) => c.getAttribute("aria-checked"));
    fireEvent.keyDown(screen.getAllByRole("radio")[0]!, { key: "a" });
    expect(screen.getAllByRole("radio").map((c) => c.getAttribute("aria-checked"))).toEqual(before);
  });
});

describe("the Advanced fold", () => {
  it("remembers that it was opened, under a namespaced versioned key", () => {
    const { unmount } = render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    expect(localStorage.getItem(ADVANCED_KEY)).toBeNull();
    press(fold());
    expect(localStorage.getItem(ADVANCED_KEY)).toBe("open");
    unmount();
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    expect(fold().open).toBe(true);
  });

  it("works on a device whose storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => render(<StartScreen pack={forfeits} onStart={vi.fn()} />)).not.toThrow();
    expect(fold().open).toBe(false);
    expect(() => press(fold())).not.toThrow();
    expect(fold().open).toBe(true);
  });
});

describe("the run's length", () => {
  /** SOLO ("everyDeath") and MODERATED ("chats") both give a range, {min: 1, max: 20}, with no fixed and no roll. */
  it("offers a length box for a mode that only gives a range, defaulting to the max", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    const box = screen.getByLabelText(/Length/) as HTMLInputElement;
    expect(box.value).toBe("20");
  });

  it("says nothing about length for a fixed or rolled mode", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    pick(SEEDED);
    expect(asked()).not.toContain("Length 1-20");
    expect(screen.queryByLabelText(/Length/)).toBeNull();
  });

  it("carries the chosen length to onStart, clamped to the range", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={forfeits} onStart={onStart} />);
    const box = screen.getByLabelText(/Length/) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "7" } });
    fireEvent.click(start());
    expect(onStart.mock.calls[0]![6]).toEqual({ plannedUnits: 7 });

    fireEvent.change(box, { target: { value: "999" } });
    fireEvent.click(start());
    expect(onStart.mock.calls[1]![6]).toEqual({ plannedUnits: 20 });
  });

  it("hands the chosen length to a race as well, since every racer plays the same run", () => {
    const race = { start: vi.fn(), join: vi.fn(), note: null };
    render(<StartScreen pack={forfeits} onStart={vi.fn()} race={race} />);
    fireEvent.change(screen.getByLabelText(/Length/), { target: { value: "7" } });
    fireEvent.click(screen.getByText("Start a race"));
    expect(race.start.mock.calls[0]![4]).toBe(7);

    // A fixed or rolled mode has no length to hand over.
    pick(SEEDED);
    fireEvent.click(screen.getByText("Start a race"));
    expect(race.start.mock.calls[1]![4]).toBeUndefined();
  });
});

describe("what the start button hands over", () => {
  /** The lifecycle did not move: the same call, with the same arguments, in every kind of mode. */
  it("starts a solo mode with the count, the empty roster and no setup", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={forfeits} onStart={onStart} />);
    fireEvent.click(start());
    expect(onStart.mock.calls[0]).toEqual([SOLO, "", 1, "", [], [], { plannedUnits: 20 }]);
  });

  it("starts a seeded mode with the seed that was typed", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={forfeits} onStart={onStart} />);
    pick(SEEDED);
    fireEvent.change(seedBox(), { target: { value: "long-kiln-42" } });
    fireEvent.click(start());
    expect(onStart.mock.calls[0]).toEqual([SEEDED, "long-kiln-42", 1, "", [], [], {}]);
  });

  it("starts a moderated mode with its roster, in the order it was typed", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={forfeits} onStart={onStart} />);
    pick(MODERATED);
    const box = screen.getByPlaceholderText("a contestant's name");
    for (const name of ["Ada", "Bo"]) {
      fireEvent.change(box, { target: { value: name } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    }
    fireEvent.click(start());
    expect(onStart.mock.calls[0]).toEqual([MODERATED, "", 1, "", ["Ada", "Bo"], [], { plannedUnits: 20 }]);
  });

  it("carries the name, and whatever the player said they do not have", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={forfeits} onStart={onStart} />);
    const optional = forfeits.requires!.find((r) => r.optional)!;
    fireEvent.click(screen.getByLabelText(new RegExp(optional.label)));
    fireEvent.change(screen.getByPlaceholderText(/^e\.g\. the winter/), { target: { value: "the winter one" } });
    fireEvent.click(start());
    expect(onStart.mock.calls[0]).toEqual([SOLO, "", 1, "the winter one", [], [optional.id], { plannedUnits: 20 }]);
  });
});

describe("submitting the start form from the keyboard", () => {
  it("associates the run name with the native start form and submits the same arguments", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={forfeits} onStart={onStart} />);
    const name = screen.getByPlaceholderText(/^e\.g\. the winter/) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "the winter one" } });

    expect(name.form).toBe(startForm());
    fireEvent.submit(startForm());
    expect(onStart.mock.calls[0]).toEqual([SOLO, "", 1, "the winter one", [], [], { plannedUnits: 20 }]);
  });

  it("associates the seed with the form but refuses a seeded run until the seed is valid", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={forfeits} onStart={onStart} />);
    pick(SEEDED);

    expect(seedBox().form).toBe(startForm());
    fireEvent.submit(startForm());
    expect(onStart).not.toHaveBeenCalled();

    fireEvent.change(seedBox(), { target: { value: "long-kiln-42" } });
    fireEvent.submit(startForm());
    expect(onStart.mock.calls[0]).toEqual([SEEDED, "long-kiln-42", 1, "", [], [], {}]);
  });

  it("refuses form submission until a moderated roster is valid", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={forfeits} onStart={onStart} />);
    pick(MODERATED);
    fireEvent.submit(startForm());
    expect(onStart).not.toHaveBeenCalled();

    const box = screen.getByPlaceholderText("a contestant's name");
    for (const name of ["Ada", "Bo"]) {
      fireEvent.change(box, { target: { value: name } });
      const entered = fireEvent.keyDown(box, { key: "Enter" });
      expect(entered).toBe(false);
    }
    fireEvent.submit(startForm());
    expect(onStart.mock.calls[0]).toEqual([MODERATED, "", 1, "", ["Ada", "Bo"], [], { plannedUnits: 20 }]);
  });

  it("does not turn composing Enter in the run name into a start", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={forfeits} onStart={onStart} />);
    const name = screen.getByPlaceholderText(/^e\.g\. the winter/);
    for (const enter of imeEnters) expect(fireEvent.keyDown(name, enter)).toBe(false);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("does not turn composing Enter in the seed into a start", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={forfeits} onStart={onStart} />);
    pick(SEEDED);
    fireEvent.change(seedBox(), { target: { value: "long-kiln-42" } });
    for (const enter of imeEnters) expect(fireEvent.keyDown(seedBox(), enter)).toBe(false);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("does not turn composing Enter into a contestant", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={forfeits} onStart={onStart} />);
    pick(MODERATED);
    const contestant = screen.getByPlaceholderText("a contestant's name");
    fireEvent.change(contestant, { target: { value: "Ada" } });
    for (const enter of imeEnters) fireEvent.keyDown(contestant, enter);
    expect(screen.queryByText("Ada", { selector: ".roster span" })).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("race keyboard boundaries", () => {
  it("joins on Enter only at six characters, without starting a local run", () => {
    const onStart = vi.fn();
    const race = { start: vi.fn(), join: vi.fn(), note: null };
    render(<StartScreen pack={forfeits} onStart={onStart} race={race} />);
    const code = screen.getByLabelText("Race code");

    fireEvent.change(code, { target: { value: "ABCDE" } });
    expect(fireEvent.keyDown(code, { key: "Enter" })).toBe(false);
    expect(race.join).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();

    fireEvent.change(code, { target: { value: "ABCDEF" } });
    expect(fireEvent.keyDown(code, { key: "Enter" })).toBe(false);
    expect(race.join).toHaveBeenCalledWith("ABCDEF", null);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("does not join or start while race-code Enter is composing", () => {
    const onStart = vi.fn();
    const race = { start: vi.fn(), join: vi.fn(), note: null };
    render(<StartScreen pack={forfeits} onStart={onStart} race={race} />);
    const code = screen.getByLabelText("Race code");
    fireEvent.change(code, { target: { value: "ABCDEF" } });
    for (const enter of imeEnters) fireEvent.keyDown(code, enter);
    expect(race.join).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("keeps mode and race controls from submitting the local start form", () => {
    const onStart = vi.fn();
    const race = { start: vi.fn(), join: vi.fn(), note: null };
    render(<StartScreen pack={forfeits} onStart={onStart} race={race} />);
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(labelOf(MODERATED)) }));
    fireEvent.click(screen.getByRole("button", { name: "Start a race" }));
    fireEvent.click(screen.getByRole("button", { name: "Make one" }));
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Race code").closest("form")).toBeNull();
  });

  it("makes player-count controls explicit non-submit buttons", () => {
    const onStart = vi.fn();
    render(<StartScreen pack={demo} onStart={onStart} />);
    fireEvent.click(screen.getByRole("radio", { name: /Pairs/ }));
    const two = screen.getByRole("button", { name: "2" }) as HTMLButtonElement;
    expect(two.type).toBe("button");
    fireEvent.click(two);
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("chosen setup, without color", () => {
  it("presses and rings the seated player count", () => {
    render(<StartScreen pack={demo} onStart={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /Pairs/ }));
    const group = screen.getByRole("group", { name: "Players" });
    const two = within(group).getByRole("button", { name: "2", pressed: true });
    expect(two.classList.contains("pickOne")).toBe(true);
    fireEvent.click(within(group).getByRole("button", { name: "3", pressed: false }));
    expect(within(group).getByRole("button", { name: "3", pressed: true })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "2", pressed: false })).toBeTruthy();
  });

  it("rings the checked mode card through the shared class", () => {
    render(<StartScreen pack={forfeits} onStart={vi.fn()} />);
    const radios = screen.getAllByRole("radio");
    for (const radio of radios) expect(radio.classList.contains("pickOne"), radio.textContent ?? "").toBe(true);
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
    expect(radios.some((r) => r.classList.contains("on"))).toBe(false);
  });
});
