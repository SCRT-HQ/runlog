// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import type { Api } from "../sync/client.ts";
import { RunView } from "./RunView.tsx";
import { memoryRunStore } from "./store.ts";
import { syncBus } from "../sync/bus.ts";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";
import { liveLinkKey } from "../live/route.ts";

/**
 * What rides along with the snapshot for a watch party.
 *
 * The page is the one writer, so it is the page that hands the server the
 * run's live link and says which snapshot is the run's first: the session
 * row keeps only the token's hash, and the first word is where a server
 * set to open a party on its own gets its chance.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;
const mode = Object.keys(kiln.modes)[0]!;

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));

/**
 * The shipped setups are read off disk by an effect that outlives a short
 * test, which leaves a rejection behind once the environment is torn down.
 * Nothing here is about a setup, so the reading is stood down.
 */
vi.mock("../control/setups.ts", async (original) => ({
  ...(await original<typeof import("../control/setups.ts")>()),
  setupsHere: async () => [],
}));

const RUN = "run1";
const LINK = "https://runlog.test/r/run1?t=tok";

afterEach(() => {
  current.api = null;
  localStorage.clear();
  cleanup();
  vi.useRealTimers();
});

/** A handful of microtask turns: enough for the store's promise chain to settle. */
async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

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

async function renderRunView(putSnapshot: Api["putSnapshot"]) {
  current.api = {
    putSnapshot,
    myRaces: async () => [],
    asks: async () => [],
    reactions: async () => [],
    listInvites: async () => [],
    people: async () => [],
  } as unknown as Api;
  const store = memoryRunStore();
  const at = "2026-09-16T00:00:00.000Z";
  const events = [{ id: "e1", t: "RunStarted" as const, at, packId: kiln.id, packVersion: kiln.version, runId: RUN, mode }] as RunEvent[];
  await store.saveRun({
    runId: RUN,
    packId: kiln.id,
    packVersion: kiln.version,
    packTitle: kiln.title,
    events,
    updatedAt: at,
    role: "player",
    shared: true,
  });
  store.setActiveRunFor(kiln.id, RUN);

  vi.useFakeTimers();
  render(
    <SyncContext.Provider value={syncOff}>
      <RunView pack={kiln} store={store} bench={{ from: "test", onLeave: () => {} }} />
    </SyncContext.Provider>,
  );
  await flush();
}

/** Something the run's page notices, so the debounced publish comes round again. */
function stirred(decks: number) {
  act(() => {
    syncBus.emit({ t: "gesture", id: RUN, kind: "tools", data: { tools: [], count: 0, decks }, at: "2026-09-16T00:00:01.000Z" });
  });
}

describe("what the snapshot carries for a watch party", () => {
  it("marks the run's first snapshot, and only the first", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView(putSnapshot);
    await vi.advanceTimersByTimeAsync(900);
    expect(putSnapshot.mock.calls[0]![2]).toMatchObject({ first: true });

    stirred(1);
    await vi.advanceTimersByTimeAsync(900);
    expect(putSnapshot.mock.calls.length).toBeGreaterThan(1);
    expect(putSnapshot.mock.calls.at(-1)![2]?.first).toBeUndefined();
  });

  it("sends the live link this device remembers", async () => {
    localStorage.setItem(liveLinkKey(RUN), LINK);
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView(putSnapshot);
    await vi.advanceTimersByTimeAsync(900);
    expect(putSnapshot.mock.calls[0]![2]).toMatchObject({ link: LINK });
  });

  it("sends no link where the device has none", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView(putSnapshot);
    await vi.advanceTimersByTimeAsync(900);
    expect(putSnapshot.mock.calls[0]![2]?.link).toBeUndefined();
  });
});
