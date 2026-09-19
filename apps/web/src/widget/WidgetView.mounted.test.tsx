// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { WidgetView } from "./WidgetView.tsx";
import { WIDGET_KINDS, type WidgetKind } from "./route.ts";
import type { LiveSnapshot } from "../live/snapshot.ts";
import { setDeviceAppearance } from "../theme/useAppearance.ts";
import { snapshotForBuiltin } from "../theme/appearance.ts";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { AccountContext } from "../auth/Account.tsx";
import { applyTheme } from "../theme/theme.ts";

const publicRun = vi.hoisted(() => ({
  got: undefined as unknown,
  snapshot: undefined as unknown,
  offline: false,
  gesture: null,
  calls: [] as Array<[string, string]>,
}));
const localRun = vi.hoisted(() => ({
  run: undefined as unknown,
  pack: undefined as unknown,
  runIds: [] as string[],
  packIds: [] as string[],
}));

vi.mock("../live/usePublic.ts", () => ({
  usePublicRun: (runId: string, token: string) => {
    publicRun.calls.push([runId, token]);
    return publicRun;
  },
}));
vi.mock("../storage/db.ts", () => ({
  loadRun: (runId: string) => {
    localRun.runIds.push(runId);
    return localRun.run;
  },
  loadPack: (packId: string) => {
    localRun.packIds.push(packId);
    return localRun.pack;
  },
}));

const snapshot: LiveSnapshot = {
  v: 1,
  at: "2026-01-01T00:00:00Z",
  packId: "kiln",
  packTitle: "The Long Kiln",
  runName: null,
  mode: "Standard",
  words: { run: "Firing", unit: "Stage", units: "Stages" },
  status: "active",
  ending: null,
  unit: 2,
  where: "Throw the Piece",
  step: "Throw it.",
  phases: [{ id: "work", label: "Throw the Piece", state: "current" }],
  constraints: ["The wall must be thin enough to admit light."],
  quoted: true,
  standings: [{ name: "Mira", points: 4, place: 1, states: [] }],
  contestants: 1,
  subjects: [{ id: 1, name: "Piece 1", type: "A cup", states: [], finalized: true }],
  counters: [{ id: "heat", label: "Heat", value: 3 }],
  resources: [{ id: "clay", label: "Clay", value: 2, max: 6 }],
  clocks: [{ id: "clock", label: "Kiln clock", kind: "stopwatch", seconds: null, status: "paused", elapsedMs: 90_000, expired: false }],
  progress: { unitsDone: 1, elapsedMs: 90_000, timed: true },
  score: { label: "Stages closed", text: "1 stage", value: 1, better: "higher" },
  forcedUnits: 0,
  log: [{ n: 3, unit: 2, where: "Stage 2, Form", hit: null, text: "A wide bowl" }],
  unitResults: [{ table: "Form", text: "A wide bowl", hit: null }],
  latest: { where: "Stage 2, Form", text: "A wide bowl" },
  race: {
    name: "Kiln race",
    ended: false,
    racing: 1,
    standings: [{ name: "Mira", place: 1, owner: false, line: "Stage 2 · 1 done", elapsedMs: 90_000 }],
  },
};
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

afterEach(() => {
  cleanup();
  setDeviceAppearance({ schemaVersion: 1, mode: "system" });
  publicRun.got = undefined;
  publicRun.snapshot = undefined;
  publicRun.offline = false;
  publicRun.calls = [];
  localRun.run = undefined;
  localRun.pack = undefined;
  localRun.runIds = [];
  localRun.packIds = [];
  localStorage.clear();
  delete document.documentElement.dataset.widget;
  delete document.documentElement.dataset.theme;
  document.documentElement.style.fontSize = "";
  for (const property of [...document.documentElement.style]) {
    if (property.startsWith("--") || property === "color-scheme") document.documentElement.style.removeProperty(property);
  }
});

describe("a linked widget while its run is loading", () => {
  it("announces that it is loading without inventing a run", () => {
    render(<WidgetView route={{ kind: "clock", runId: "run-1", bg: "clear", scale: 1, token: "live-token" }} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Loading…");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Nothing written to the run yet.")).toBeNull();
    expect(publicRun.calls).toEqual([["run-1", "live-token"]]);
  });
});

describe("linked widget states", () => {
  it.each([
    ["offline", { got: {}, snapshot: undefined, offline: true }, "A widget by link needs the hosted copy of Runlog."],
    ["expired", { got: null, snapshot: undefined, offline: false }, "This link is not open any more."],
    ["without a snapshot", { got: {}, snapshot: undefined, offline: false }, "Nothing written to the run yet."],
    ["outside a race", { got: {}, snapshot: { ...snapshot, race: undefined }, offline: false }, "This run is not in a race."],
  ])("explains the %s boundary", (_state, value, message) => {
    Object.assign(publicRun, value);
    render(
      <WidgetView
        route={{ kind: _state === "outside a race" ? "race" : "clock", runId: "run-1", bg: "clear", scale: 1, token: "live-token" }}
      />,
    );

    expect(screen.getByText(message)).toBeTruthy();
  });

  it("mounts every declared widget kind with its distinct machine and numeric output", () => {
    Object.assign(publicRun, { got: {}, snapshot, offline: false });
    const expected: Record<WidgetKind, string[]> = {
      scoreboard: ["Mira", "#1", "4"],
      race: ["Race · Kiln race · 1 racing", "Stage 2 · 1 done", "#1"],
      clock: ["Kiln clock", "1:30"],
      step: ["Throw it.", "The wall must be thin enough to admit light."],
      stats: ["Stages done", "1:30", "1 stage"],
      trackers: ["Heat", "Clay", "2 / 6"],
      ticker: ["Just now", "Nothing yet. The next move shows here."],
      column: ["Kiln clock", "Trackers", "Mira"],
    };
    expect(WIDGET_KINDS.map(({ kind }) => kind)).toEqual(Object.keys(expected));
    for (const [kind, text] of Object.entries(expected) as Array<[WidgetKind, string[]]>) {
      const page = render(<WidgetView route={{ kind, runId: "run-1", bg: "none", scale: 1, token: "live-token" }} />);
      for (const value of text) expect(page.getAllByText(value).length).toBeGreaterThan(0);
      page.unmount();
    }
  });

  it.each(["clear", "solid", "none"] as const)("installs %s capture look and restores this machine's theme on unmount", (bg) => {
    Object.assign(publicRun, { got: {}, snapshot, offline: false });
    setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("daylight") });
    const page = render(<WidgetView route={{ kind: "stats", runId: "run-1", bg, scale: 1.5, theme: "ember", token: "live-token" }} />);

    expect(document.documentElement.dataset.widget).toBe(bg);
    expect(document.documentElement.style.fontSize).toBe("24px");
    expect(document.documentElement.dataset.theme).toBe("ember");
    expect(document.documentElement.style.getPropertyValue("--text")).toBe("#f1e4d3");
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe('system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
    page.unmount();
    expect(document.documentElement.dataset.widget).toBeUndefined();
    expect(document.documentElement.style.fontSize).toBe("");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--text")).toBe("#1c1a17");
    expect(document.documentElement.style.fontSize).toBe("");
  });

  it("uses widget roles for an unpinned route and restores app roles on cleanup", () => {
    Object.assign(publicRun, { got: {}, snapshot, offline: false });
    setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("ember") });

    const page = render(<WidgetView route={{ kind: "stats", runId: "run-1", bg: "clear", scale: 1.25, token: "live-token" }} />);

    expect(document.documentElement.style.fontSize).toBe("20px");
    expect(document.documentElement.style.getPropertyValue("--widget-text")).toBe("#f1e4d3");
    expect(document.documentElement.style.getPropertyValue("--text")).toBe("#f1e4d3");
    page.unmount();
    expect(document.documentElement.dataset.widget).toBeUndefined();
    expect(document.documentElement.style.fontSize).toBe("");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--text")).toBe("#f1e4d3");
  });

  it("keeps the current in-memory appearance for an unpinned widget when storage reads are unavailable", () => {
    Object.assign(publicRun, { got: {}, snapshot, offline: false });
    setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("ember") });
    const storage = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    const page = render(<WidgetView route={{ kind: "stats", runId: "run-1", bg: "none", scale: 1, token: "live-token" }} />);

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#1a1210");
    page.unmount();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#1a1210");
    storage.mockRestore();
  });

  it("keeps a legacy URL pin authoritative while remembering the latest device Apply for cleanup", () => {
    Object.assign(publicRun, { got: {}, snapshot, offline: false });
    setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("daylight") });
    const page = render(
      <WidgetView route={{ kind: "stats", runId: "run-1", bg: "solid", scale: 1, theme: "ember", token: "live-token" }} />,
    );
    expect(document.documentElement.dataset.theme).toBe("ember");

    act(() => setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("rainbow-road") }));
    expect(document.documentElement.dataset.theme).toBe("ember");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#1a1210");

    page.unmount();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#ededeb");
  });

  it("claims widget root ownership before a parent ThemeProvider layout effect can replace the booted pin", () => {
    Object.assign(publicRun, { got: {}, snapshot, offline: false });
    setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("daylight") });
    applyTheme("ember", document.documentElement, "widget");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let firstCommitBackground = "not observed";
    function FirstCommitProbe({ children }: { children: ReactNode }) {
      useLayoutEffect(() => {
        firstCommitBackground = document.documentElement.style.getPropertyValue("--bg");
      }, []);
      return children;
    }

    flushSync(() => {
      root.render(
        <FirstCommitProbe>
          <AccountContext.Provider value={{ status: "checking", signIn: vi.fn() }}>
            <ThemeProvider>
              <WidgetView route={{ kind: "stats", runId: "run-1", bg: "solid", scale: 1, theme: "ember", token: "live-token" }} />
            </ThemeProvider>
          </AccountContext.Provider>
        </FirstCommitProbe>,
      );
    });

    const committedWidget = document.documentElement.dataset.widget;
    const committedTheme = document.documentElement.dataset.theme;
    const committedBackground = document.documentElement.style.getPropertyValue("--bg");
    flushSync(() => root.unmount());
    container.remove();

    expect(firstCommitBackground).toBe("#1a1210");
    expect(committedWidget).toBe("solid");
    expect(committedTheme).toBe("ember");
    expect(committedBackground).toBe("#1a1210");
  });

  it("follows a newer device Apply in widget scope and restores that same appearance on cleanup", () => {
    Object.assign(publicRun, { got: {}, snapshot, offline: false });
    setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("ember") });
    const page = render(<WidgetView route={{ kind: "stats", runId: "run-1", bg: "none", scale: 1, token: "live-token" }} />);

    act(() => setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("daylight") }));
    expect(document.documentElement.style.getPropertyValue("--widget-text")).toBe("#1c1a17");

    page.unmount();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--text")).toBe("#1c1a17");
  });
});

describe("local widget states", () => {
  it("announces loading until the literal local run and pack reads resolve", async () => {
    let resolveRun!: (value: unknown) => void;
    localRun.run = new Promise<unknown>((resolve) => {
      resolveRun = resolve;
    });
    localRun.pack = { source: readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), format: "yaml" };
    render(<WidgetView route={{ kind: "clock", runId: "run-1", bg: "solid", scale: 1 }} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Loading…");
    expect(status.getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(localRun.runIds).toEqual(["run-1"]));

    resolveRun({ runId: "run-1", packId: "kiln", events: [] });
    await waitFor(() => expect(screen.getByText("Not started yet.")).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
    expect(localRun.packIds).toEqual(["kiln"]);
  });

  it("explains a missing local run and missing local pack", async () => {
    localRun.run = null;
    const missingRun = render(<WidgetView route={{ kind: "clock", runId: "run-1", bg: "solid", scale: 1 }} />);
    await waitFor(() => expect(screen.getByText("This run is not on this device. Open it in the app first.")).toBeTruthy());
    missingRun.unmount();

    localRun.run = { runId: "run-1", packId: "kiln", events: [] };
    localRun.pack = null;
    render(<WidgetView route={{ kind: "clock", runId: "run-1", bg: "solid", scale: 1 }} />);
    await waitFor(() => expect(screen.getByText("The run's pack is not on this device.")).toBeTruthy());
  });

  it("says a local run with no events has not started", async () => {
    localRun.run = { runId: "run-1", packId: "kiln", events: [] };
    localRun.pack = { source: readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), format: "yaml" };
    render(<WidgetView route={{ kind: "clock", runId: "run-1", bg: "solid", scale: 1 }} />);

    await waitFor(() => expect(screen.getByText("Not started yet.")).toBeTruthy());
  });
});
