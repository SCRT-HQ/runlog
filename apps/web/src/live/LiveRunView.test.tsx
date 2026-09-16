// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import { AccountContext, type Account } from "../auth/Account.tsx";
import type { LiveSnapshot } from "./snapshot.ts";
import { LiveRunView } from "./LiveRunView.tsx";

/**
 * The row of tools above a watched run.
 *
 * Docs and a Documents menu sat side by side in it and opened the same
 * drawer, so the page asked the same question twice.
 */

vi.mock("../sync/useApi.ts", () => ({ useApi: () => null }));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

const snapshot: LiveSnapshot = {
  v: 1,
  at: "2026-01-01T00:00:00Z",
  packId: kiln.id,
  packTitle: kiln.title,
  runName: null,
  mode: "Standard",
  words: { run: "Firing", unit: "Stage", units: "Stages" },
  status: "active",
  ending: null,
  unit: 1,
  where: "Shape",
  step: "Throw the piece",
  phases: [{ id: "shape", label: "Shape", state: "current" }],
  quoted: true,
  standings: [],
  contestants: 0,
  subjects: [],
  counters: [],
  resources: [],
  clocks: [],
  progress: { unitsDone: 0, elapsedMs: 0, timed: false },
  score: { label: "Stages closed", text: "0 stages", value: 0, better: "higher" },
  forcedUnits: 0,
  log: [],
};

vi.mock("./usePublic.ts", () => ({
  usePublicRun: () => ({
    got: {
      run: {
        id: "run-1",
        packId: kiln.id,
        packVersion: kiln.version,
        packTitle: kiln.title,
        name: null,
        seq: 1,
        updatedAt: "2026-01-01T00:00:00Z",
        endedAt: null,
      },
      access: "full",
    },
    pack: kiln,
    snapshot,
    stale: false,
    offline: false,
    gesture: null,
  }),
}));

const signedOut: Account = { status: "signed-out", signIn: () => {} } as unknown as Account;

afterEach(cleanup);

describe("the watcher page's tools", () => {
  it("has one way to the documents, and it is Docs", () => {
    const { container } = render(
      <AccountContext.Provider value={signedOut}>
        <LiveRunView route={{ id: "run-1", token: "tok" }} />
      </AccountContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "Docs" })).toBeTruthy();
    expect(container.querySelector(".docMenu")).toBeNull();
    expect(container.textContent).not.toContain("Documents");
  });
});
