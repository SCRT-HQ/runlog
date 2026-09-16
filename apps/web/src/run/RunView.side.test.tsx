// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
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
vi.mock("./useReachable.ts", () => ({ useReachable: () => ({ link: null, key: "watchkey", working: false }) }));
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
async function column(): Promise<HTMLElement> {
  current.api = {
    putSnapshot: async () => {},
    myRaces: async () => [],
    getRace: async () => race,
    putRaceEntry: async () => race,
    asks: async () => [],
    reactions: async () => [],
    listInvites: async () => [],
    people: async () => [],
    me: async () => ({ profile: null }),
  } as unknown as Api;
  const store = memoryRunStore();
  const runId = "run1";
  await store.saveRun({
    runId,
    packId: kiln.id,
    packVersion: kiln.version,
    packTitle: kiln.title,
    events: [{ id: "e1", t: "RunStarted", at, packId: kiln.id, packVersion: kiln.version, runId, mode }] as RunEvent[],
    updatedAt: at,
    role: "owner",
    raceId,
    asks: { policy: "ask" },
  });
  store.setActiveRunFor(kiln.id, runId);
  const { container } = render(
    <SyncContext.Provider value={sync}>
      <RunView pack={kiln} store={store} />
    </SyncContext.Provider>,
  );
  await flush();
  const side = container.querySelector(".col.side");
  if (!side) throw new Error("the run screen drew no side column");
  return side as HTMLElement;
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
