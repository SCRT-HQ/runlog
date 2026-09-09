import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import type { RunState } from "@runlog/engine";
import { RemoteControls } from "./ControlPanel.tsx";
import type { RollReceipt } from "./Receipt.tsx";
import type { useRun } from "./useRun.ts";

/**
 * The floating remote at first paint: whichever of its sections apply to a
 * given moment in the run, stacked in the order it lists them. Static
 * markup, against a small fake `run`, the same style as ClockPanel.test.tsx
 * and SettingsDialog.test.tsx, plus the real demo pack, for real phases,
 * tables and endings to point at.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

const state = (over: Partial<RunState> = {}): RunState =>
  ({
    status: "active",
    unit: 1,
    name: null,
    journal: {},
    checks: [],
    outcomes: [],
    clocks: [],
    ...over,
  }) as unknown as RunState;

const run = (over: Partial<ReturnType<typeof useRun>> = {}): ReturnType<typeof useRun> =>
  ({
    readOnly: false,
    pending: null,
    activeStep: null,
    due: [],
    notes: [],
    moves: [],
    blockingObligations: [],
    canUndo: false,
    canEnd: { ok: false, reason: "not there yet" },
    undo: vi.fn(),
    abandonPending: vi.fn(),
    begin: vi.fn(),
    check: vi.fn(),
    completeStep: vi.fn(),
    declareSubject: vi.fn(),
    finalizeUnit: vi.fn(),
    enterUnit: vi.fn(),
    writeJournal: vi.fn(),
    endRun: vi.fn(),
    resolveObligation: vi.fn(),
    takeMove: vi.fn(),
    pauseClock: vi.fn(),
    resumeClock: vi.fn(),
    stopClock: vi.fn(),
    startUnitClock: vi.fn(),
    ...over,
  }) as unknown as ReturnType<typeof useRun>;

const panel = (props: Partial<Parameters<typeof RemoteControls>[0]> = {}) =>
  renderToStaticMarkup(
    <RemoteControls pack={kiln} run={run()} state={state()} receipt={null} onCarryOn={() => {}} onAnswer={() => {}} {...props} />,
  );

describe("the floating remote", () => {
  it("shows the pad and Roll for me while the game waits on a roll", () => {
    const html = panel({
      run: run({ pending: { request: { kind: "roll", key: "k", dice: "d100", purpose: "check", label: "Roll the Kiln Check" } } as never }),
    });
    expect(html).toContain("Roll for me");
    expect(html).toContain('class="pad"');
    expect(html).toContain("Table");
  });

  it("offers Yes and No for a pending ask", () => {
    const html = panel({
      run: run({ pending: { request: { kind: "ask", key: "k", question: "Did the surface take a texture?" } } as never }),
    });
    expect(html).toContain("Did the surface take a texture?");
    expect(html).toContain(">Yes<");
    expect(html).toContain(">No<");
  });

  it("between units, offers Enter and the endings once the run may end", () => {
    const html = panel({
      run: run({ activeStep: null, canEnd: { ok: true } }),
      state: state({ unit: 2 }),
    });
    expect(html).toContain("Enter Stage 3");
    for (const ending of kiln.endings ?? []) expect(html).toContain(ending.label);
  });

  it("does not offer the endings while the run may not end yet", () => {
    const html = panel({ run: run({ activeStep: null, canEnd: { ok: false, reason: "too soon" } }) });
    for (const ending of kiln.endings ?? []) expect(html).not.toContain(ending.label);
  });

  it("shows the clock with Pause, the same as the page's margin", () => {
    const clock = {
      id: "u1:unit",
      kind: "stopwatch",
      label: "Stage 1",
      seconds: null,
      unit: 1,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      runningSince: "2026-01-01T00:00:00.000Z",
      accumulatedMs: 0,
      elapsedMs: null,
    };
    const html = panel({ state: state({ clocks: [clock] as never }) });
    expect(html).toContain("Pause");
  });

  it("lists what is owed and the moves on offer, with a move's description on its title", () => {
    const html = panel({
      run: run({
        due: [{ id: "o1", text: "Roll the Cooling", on: "onRunEnd" } as never],
        moves: [{ id: "salvage", move: { label: "Salvage a Piece", description: "Repair one fired Stage." } } as never],
      }),
    });
    expect(html).toContain("Owed");
    expect(html).toContain("Roll the Cooling");
    expect(html).toContain("Your move");
    expect(html).toContain("Salvage a Piece");
    expect(html).toContain('title="Repair one fired Stage."');
    expect(html).not.toContain("Repair one fired Stage.<");
  });

  it("puts Undo last, disabled until there is something to undo", () => {
    const undoButton = (html: string) => html.match(/<button[^>]*>Undo<\/button>/)?.[0] ?? "";

    const disabled = panel({
      run: run({ canUndo: false, due: [{ id: "o1", text: "Owed thing", on: "onRunEnd" } as never] }),
    });
    expect(disabled).toContain("Owed");
    expect(disabled.indexOf("Owed")).toBeLessThan(disabled.indexOf(">Undo<"));
    expect(undoButton(disabled)).toContain("disabled");

    const enabled = panel({ run: run({ canUndo: true }) });
    expect(undoButton(enabled)).not.toContain("disabled");
  });

  it("shows nothing for a watcher but the receipt and the clock's digits", () => {
    const clock = {
      id: "u1:unit",
      kind: "stopwatch",
      label: "Stage 1",
      seconds: null,
      unit: 1,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      runningSince: "2026-01-01T00:00:00.000Z",
      accumulatedMs: 0,
      elapsedMs: 45_000,
    };
    const receipt: RollReceipt = {
      dice: null,
      total: 4,
      label: "Form",
      notation: "d6",
      machineRolled: false,
      outcomes: [],
    };
    const html = panel({
      run: run({
        readOnly: true,
        pending: { request: { kind: "roll", key: "k", dice: "d6", purpose: "form" } } as never,
        activeStep: { phase: kiln.phases[0]!, step: kiln.phases[0]!.steps[0]!, index: 0 } as never,
        due: [{ id: "o1", text: "Owed thing", on: "onRunEnd" } as never],
        moves: [{ id: "m", move: { label: "A move", description: "d" } } as never],
        canUndo: true,
        canEnd: { ok: true },
      }),
      state: state({ unit: 1, clocks: [clock] as never }),
      receipt,
    });
    expect(html).toContain("0:45");
    expect(html).toContain("Carry on");
    expect(html).not.toContain("Roll for me");
    expect(html).not.toContain("Owed thing");
    expect(html).not.toContain("Your move");
    expect(html).not.toContain("Pause");
    expect(html).not.toContain(">Undo<");
    expect(html).not.toContain("Enter Stage");
  });
});
