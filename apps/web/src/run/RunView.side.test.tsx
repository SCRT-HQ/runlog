// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import type { Api, Race } from "../sync/client.ts";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";
import { memoryRunStore } from "./store.ts";
import { RunView } from "./RunView.tsx";

/**
 * The column down the right of a run: every panel in it folds.
 *
 * Two of them happened to be written as `details` and the rest were plain
 * sections, so a column longer than the screen could only be scrolled
 * past. They are all `details` now, open to begin with, and the order is
 * the one the run screen has always drawn.
 */

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));
vi.mock("./useReachable.ts", () => ({
  useReachable: () => ({ link: null, key: "watchkey", working: false, mint: async () => "watchkey" }),
}));
// The shipped setups and profiles are read from disk on a timer of their
// own, which outlives a test that only cares about the column's shape.
vi.mock("../control/setups.ts", async (original) => ({
  ...(await original<typeof import("../control/setups.ts")>()),
  setupsHere: async () => [],
}));
vi.mock("../control/builtin.ts", async (original) => ({
  ...(await original<typeof import("../control/builtin.ts")>()),
  builtins: async () => [],
}));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;
const mode = Object.keys(kiln.modes)[0]!;

const sync: Sync = {
  available: true,
  enabled: true,
  setEnabled: () => {},
  status: "idle",
  last: null,
  syncNow: () => {},
  setPackSync: async () => {},
  gesture: () => false,
  drove: () => {},
};

async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) await act(async () => await Promise.resolve());
}

afterEach(() => {
  current.api = null;
  cleanup();
});

const raceId = "race-1";
const at = "2026-09-14T00:00:00.000Z";

/** A race this run is in, so the race panel has a leaderboard to draw. */
const race: Race = {
  meta: {
    id: raceId,
    code: "ABCD",
    packId: kiln.id,
    packVersion: kiln.version,
    mode,
    seed: "seed",
    ownerSub: "user_ME",
    createdAt: at,
    updatedAt: at,
    seq: 1,
  },
  entries: [{ sub: "user_ME", name: "Nate", sessionId: "run1", joinedAt: at }],
};

/**
 * The run screen, with every panel a bench run keeps out.
 *
 * The record takes asks and names a race, because those two are the
 * panels this change altered most: one was a `details` that waited for a
 * question before it opened, the other a plain section.
 */
async function screen(opts: { pack?: Pack } = {}): Promise<HTMLElement> {
  const pack = opts.pack ?? kiln;
  current.api = {
    putSnapshot: async () => {},
    myRaces: async () => [],
    getRace: async () => race,
    putRaceEntry: async () => race,
    asks: async () => [],
    reactions: async () => [],
    listInvites: async () => [],
    people: async () => [],
    parties: async () => ({ parties: [], servers: [] }),
    me: async () => ({ profile: null }),
  } as unknown as Api;
  const store = memoryRunStore();
  const runId = "run1";
  await store.saveRun({
    runId,
    packId: pack.id,
    packVersion: pack.version,
    packTitle: pack.title,
    events: [{ id: "e1", t: "RunStarted", at, packId: pack.id, packVersion: pack.version, runId, mode }] as RunEvent[],
    updatedAt: at,
    role: "owner",
    raceId,
    asks: { policy: "ask" },
  });
  store.setActiveRunFor(pack.id, runId);
  const { container } = render(
    <SyncContext.Provider value={sync}>
      <RunView pack={pack} store={store} />
    </SyncContext.Provider>,
  );
  await flush();
  return container;
}

async function column(): Promise<HTMLElement> {
  const side = (await screen()).querySelector(".col.side");
  if (!side) throw new Error("the run screen drew no side column");
  return side as HTMLElement;
}

/** The panel whose fold reads like this, wherever it sits in the column. */
function panelTitled(root: HTMLElement, title: string): HTMLDetailsElement {
  const found = [...root.querySelectorAll("details.panel")].find((d) =>
    (d.querySelector("summary h3")?.textContent ?? "").startsWith(title),
  );
  if (!found) throw new Error(`no panel titled ${title}`);
  return found as HTMLDetailsElement;
}

describe("the side panels fold", () => {
  it("draws every one of them as a details, open, with its title to press", async () => {
    const side = await column();
    const panels = [...side.children];
    expect(panels.length).toBeGreaterThan(1);
    for (const panel of panels) {
      expect(panel.tagName).toBe("DETAILS");
      expect(panel.classList.contains("panel")).toBe(true);
      expect((panel as HTMLDetailsElement).open).toBe(true);
      expect(panel.querySelector(":scope > summary > h3.sectionTitle")).toBeTruthy();
    }
  });

  it("keeps the order the run screen has always drawn", async () => {
    const side = await column();
    const titles = [...side.children].map((p) => p.querySelector("summary h3")?.textContent ?? "");
    expect(titles[0]).toBe("People at the table");
    expect(titles).toContain(`${kiln.vocabulary.subject.many} the board`);
    expect(titles).toContain("Trackers");
    expect(titles.some((t) => t.startsWith("Race"))).toBe(true);
    expect(titles.at(-1)).toBe("Asks from chat");
  });

  /**
   * Asks used to open only once somebody had asked something, which left
   * the host with no way to see that the run was taking them at all.
   */
  it("opens Asks before anybody has asked anything", async () => {
    const side = await column();
    const asks = side.querySelector("details.asks") as HTMLDetailsElement | null;
    expect(asks).toBeTruthy();
    expect(asks!.open).toBe(true);
    expect(asks!.textContent).toContain("None yet.");
  });

  /** The race panel was a plain section, and folds like the rest now. */
  it("folds the race panel like the rest", async () => {
    const side = await column();
    const panel = side.querySelector("details.racePanel") as HTMLDetailsElement | null;
    expect(panel).toBeTruthy();
    expect(panel!.open).toBe(true);
    expect(panel!.querySelector(":scope > summary > h3.sectionTitle")).toBeTruthy();
  });
});

/**
 * A tracker's name is the pack author's, and some of them are sentences.
 *
 * No shipped pack has one long enough to wrap in the side column, so this
 * is a pack of our own: the demo pack with one more tally, named the way
 * the run that turned up F08 named its own.
 */
const wordy = "Rounds without a forfeit";
const wordyPack: Pack = {
  ...kiln,
  id: "com.example.wordy",
  counters: { ...(kiln.counters ?? {}), forfeits: { label: wordy, initial: 0, min: 0, per: "table", hidden: false } },
};

/** The dial heads and tally rows in the Trackers panel, in the order they are drawn. */
function counterRows(root: HTMLElement): HTMLElement[] {
  return [...panelTitled(root, "Trackers").querySelectorAll(".counterRow")] as HTMLElement[];
}

describe("a counter's name and the controls that turn it", () => {
  it("gives every row the same two cells, whatever the name costs", async () => {
    const rows = counterRows(await screen({ pack: wordyPack }));
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) {
      expect(row.children.length).toBe(2);
      expect(row.children[0]!.tagName).toBe("STRONG");
      expect(row.children[1]!.classList.contains("nudge")).toBe(true);
    }
    expect(rows.some((r) => r.children[0]!.textContent === wordy)).toBe(true);
  });

  it("puts the wrapping name in a tally row and a dial head alike", async () => {
    const rows = counterRows(await screen({ pack: wordyPack }));
    expect(rows.some((r) => r.classList.contains("trackerHead"))).toBe(true);
    expect(rows.some((r) => r.classList.contains("row") && r.classList.contains("spread"))).toBe(true);
  });

  it("still writes the correction when the long row is nudged", async () => {
    const container = await screen({ pack: wordyPack });
    const row = counterRows(container).find((r) => r.children[0]!.textContent === wordy)!;
    expect(row.querySelector(".num")!.textContent).toBe("0");
    const more = row.querySelector('button[title^="One more"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(more);
    });
    await flush();
    const again = counterRows(container).find((r) => r.children[0]!.textContent === wordy)!;
    expect(again.querySelector(".num")!.textContent).toBe("1");
  });
});
