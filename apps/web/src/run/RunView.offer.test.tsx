// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import type { Api } from "../sync/client.ts";
import { RunView } from "./RunView.tsx";
import { memoryRunStore } from "./store.ts";
import { syncBus } from "../sync/bus.ts";

/**
 * The offer rides along with the snapshot.
 *
 * `RunView` publishes to the server through `useApi()`, a hook rather than a
 * prop, so it is mocked module-wide the way `ChatPanel.test.tsx` mocks it.
 * The run itself is a real, hydrated one-event log in a memory store: the
 * engine's own `reduce` has to accept it, so this is the shortest log that
 * does. `bench` keeps the race, asks and members panels off the tree; none
 * of the three touch the offer, and each would otherwise want its own slice
 * of the API double.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;
const mode = Object.keys(kiln.modes)[0]!;

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));

afterEach(() => {
  current.api = null;
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

async function renderRunView({
  putSnapshot,
  shared,
  decksAttached = 0,
}: {
  putSnapshot: Api["putSnapshot"];
  shared: boolean;
  decksAttached?: number;
}) {
  current.api = { putSnapshot, myRaces: async () => [] } as unknown as Api;
  const store = memoryRunStore();
  const runId = "run1";
  const at = "2026-09-14T00:00:00.000Z";
  const events = [{ id: "e1", t: "RunStarted" as const, at, packId: kiln.id, packVersion: kiln.version, runId, mode }];
  await store.saveRun({
    runId,
    packId: kiln.id,
    packVersion: kiln.version,
    packTitle: kiln.title,
    events,
    updatedAt: at,
    role: "player",
    shared,
  });
  store.setActiveRunFor(kiln.id, runId);

  // Fake timers are on before the first render, so the debounce's own
  // setTimeout is one this test can wind forward rather than a real one
  // already ticking by the time it asks.
  vi.useFakeTimers();
  render(<RunView pack={kiln} store={store} bench={{ from: "test", onLeave: () => {} }} />);
  await flush();

  if (decksAttached > 0) {
    act(() => {
      syncBus.emit({ t: "gesture", id: runId, kind: "tools", data: { tools: [], count: 0, decks: decksAttached }, at });
    });
  }
}

describe("the offer rides along with the snapshot", () => {
  it("publishes an offer beside the snapshot", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: true });
    await vi.advanceTimersByTimeAsync(900);
    expect(putSnapshot.mock.calls[0]![1]).toMatchObject({ offer: { seq: expect.any(Number) } });
  });

  it("publishes for a deck even when the run is not shared", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: false, decksAttached: 1 });
    await vi.advanceTimersByTimeAsync(900);
    expect(putSnapshot).toHaveBeenCalled();
  });
});
