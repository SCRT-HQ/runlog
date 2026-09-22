// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import type { Api, Race } from "../sync/client.ts";
import { RunView } from "./RunView.tsx";
import { memoryRunStore } from "./store.ts";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";

/**
 * A race is one run played on several devices, so what its starter picks
 * for a mode that only bounds its length has to reach every racer: the
 * race carries the number, and joining takes it from the race rather than
 * settling for the most the mode allows.
 */

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));
// The shipped setups and profiles are read from disk by effects this suite
// is not about; the reading is stood down.
vi.mock("../control/setups.ts", async (original) => ({
  ...(await original<typeof import("../control/setups.ts")>()),
  setupsHere: async () => [],
}));
vi.mock("../control/builtin.ts", async (original) => ({
  ...(await original<typeof import("../control/builtin.ts")>()),
  builtins: async () => [],
}));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/sketches/forfeits.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the forfeits pack did not load");
const forfeits = loaded.pack;
/** A mode that only bounds its length, 1 to 20. */
const RANGED = "everyDeath";

const syncOff: Sync = {
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

afterEach(() => {
  cleanup();
  current.api = null;
  localStorage.clear();
});

async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function meta(over: Partial<Race["meta"]>): Race["meta"] {
  return {
    id: "R1",
    code: "ABCDEF",
    packId: forfeits.id,
    packVersion: forfeits.version,
    mode: RANGED,
    seed: "winter",
    ownerSub: "user_1",
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    seq: 0,
    ...over,
  };
}

/** The start screen of a pack nobody has run yet, with an account behind it. */
async function opened(api: Partial<Api>) {
  current.api = {
    myRaces: async () => [],
    getRace: async () => null,
    asks: async () => [],
    reactions: async () => [],
    listInvites: async () => [],
    people: async () => [],
    ...api,
  } as unknown as Api;
  const store = memoryRunStore();
  render(
    <SyncContext.Provider value={syncOff}>
      <RunView pack={forfeits} store={store} />
    </SyncContext.Provider>,
  );
  await flush();
  return store;
}

async function firstEvent(store: ReturnType<typeof memoryRunStore>) {
  const runs = await store.runsFor(forfeits.id);
  return runs[0]?.events[0];
}

describe("a race and the run's length", () => {
  it("carries the starter's pick to the race, and into their own run", async () => {
    const createRace = vi.fn<Api["createRace"]>(async (race) => ({
      meta: meta({ id: race.id, ...(race.plannedUnits !== undefined ? { plannedUnits: race.plannedUnits } : {}) }),
      entries: [],
    }));
    const store = await opened({ createRace });
    fireEvent.change(screen.getByLabelText(/Length/), { target: { value: "7" } });
    fireEvent.click(screen.getByText("Start a race"));
    await flush();
    expect(createRace.mock.calls[0]![0]).toMatchObject({ mode: RANGED, plannedUnits: 7 });
    expect(await firstEvent(store)).toMatchObject({ t: "RunStarted", mode: RANGED, plannedUnits: 7 });
  });

  it("joins at the length the race carries, not the most the mode allows", async () => {
    const joinRace = vi.fn<Api["joinRace"]>(async () => ({ meta: meta({ plannedUnits: 9 }), entries: [] }));
    const putRaceEntry = vi.fn<Api["putRaceEntry"]>(async () => null);
    const store = await opened({ joinRace, putRaceEntry });
    fireEvent.change(document.querySelector("input.code")!, { target: { value: "ABCDEF" } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    await flush();
    expect(joinRace).toHaveBeenCalledWith("ABCDEF");
    expect(await firstEvent(store)).toMatchObject({ t: "RunStarted", mode: RANGED, plannedUnits: 9 });
  });
});
