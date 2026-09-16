import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { faceImage } from "../face.ts";
import { GLYPHS } from "../glyphs.ts";
import { initial } from "../state.ts";
import type { MetricSettings } from "./metric.ts";

// `metric.ts` pulls in `../plugin.ts` (through `store`), which registers
// every action - a real import here would load the whole plugin just to
// reach a pure function. `nextField` touches none of it.
const mock = vi.hoisted(() => ({ pressed: [] as unknown[], snapshot: null as unknown }));
vi.mock("../plugin.ts", () => ({
  store: {
    get state() {
      return { runs: [], pinned: null, snapshot: mock.snapshot };
    },
    dispatch: () => {},
    subscribe: () => () => {},
  },
  sayWho: async () => {},
  wire: {
    press: (p: unknown) => {
      mock.pressed.push(p);
      return "r1";
    },
  },
}));

const { Metric, nextField } = await import("./metric.ts");

describe("turning the dial", () => {
  it("steps through the fields and wraps", () => {
    expect(nextField("score", 1)).toBe("unit");
    expect(nextField("leader", 1)).toBe("score");
    expect(nextField("score", -1)).toBe("leader");
  });
});

const key = (alerts: string[]) => ({
  id: "a1",
  isKey: () => true,
  isDial: () => false,
  showAlert: async () => {
    alerts.push("alert");
  },
  showOk: async () => {},
});

describe("pressing a metric key", () => {
  /** One press of the key, held for `ms`, with the software's own down and up. */
  async function pressFor(ms: number, settings: Record<string, unknown>, alerts: string[] = []): Promise<void> {
    const metric = new Metric();
    const action = key(alerts);
    metric.onKeyDown({ action, payload: { settings } } as never);
    vi.advanceTimersByTime(ms);
    await metric.onKeyUp({ action, payload: { settings } } as never);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    mock.pressed = [];
    mock.snapshot = { offer: { trackers: [{ id: "hits", kind: "counter", label: "Hits", value: 3, max: null }] } };
  });
  afterEach(() => vi.useRealTimers());

  it("steps its tracker up on a tap and back down on a hold", async () => {
    await pressFor(120, { field: { counter: "hits" } });
    await pressFor(700, { field: { counter: "hits" } });
    expect(mock.pressed).toEqual([
      { press: "answer", answer: { tracker: "hits", by: 1 } },
      { press: "answer", answer: { tracker: "hits", by: -1 } },
    ]);
  });

  it("puts it at a number where the key was set to one", async () => {
    await pressFor(120, { field: { counter: "hits" }, press: { kind: "set", value: 0 } });
    expect(mock.pressed).toEqual([{ press: "answer", answer: { tracker: "hits", to: 0 } }]);
  });

  it("sends nothing on the way down: a short press is the way back up", () => {
    const metric = new Metric();
    metric.onKeyDown({ action: key([]), payload: { settings: { field: { counter: "hits" } } } } as never);
    expect(mock.pressed).toEqual([]);
  });

  it("refuses the fields that are the run's own arithmetic", async () => {
    const alerts: string[] = [];
    await pressFor(120, { field: "score" }, alerts);
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });

  it("steps the tracker from a dial press, one up whatever the key was set to", async () => {
    const settings = { field: { counter: "hits" }, press: { kind: "set", value: 9 } };
    await new Metric().onDialDown({ action: key([]), payload: { settings } } as never);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { tracker: "hits", by: 1 } }]);
  });

  it("keeps the press setting when a dial rotates to another field", async () => {
    const written: unknown[] = [];
    const dial = {
      ...key([]),
      setSettings: async (s: unknown) => {
        written.push(s);
      },
      setFeedback: async () => {},
      isKey: () => false,
      isDial: () => true,
    };
    const settings = { field: "score", press: { kind: "set", value: 9 } };
    await new Metric().onDialRotate({ action: dial, payload: { settings, ticks: 1 } } as never);
    expect(written).toEqual([{ field: "unit", press: { kind: "set", value: 9 } }]);
  });
});

/** The corner of a key set to this field, as the markup the face drew there. */
function corner(field: MetricSettings["field"]): string {
  const metric = new Metric();
  const settings: MetricSettings = field === undefined ? {} : { field };
  // `glyph` is the base class's, protected because only an action calls it.
  const reach = metric as unknown as { glyph(s: MetricSettings): string | undefined };
  const image = faceImage(metric.face(initial(), settings, 0), reach.glyph(settings));
  const svg = Buffer.from(image.split(",")[1]!, "base64").toString("utf8");
  return /<g transform="translate\(8 8\)[^>]*>(.*)<\/g>/.exec(svg)?.[1] ?? "";
}

/** The quiet ink a corner is drawn in on the tones a Metric key takes. */
const drawn = (name: string) => GLYPHS[name]!.replaceAll("#ffffff", "#8d958f");

describe("the drawing in a Metric key's corner", () => {
  it("is the stepper for a number somebody keeps by hand", () => {
    expect(corner({ counter: "hits" })).toBe(drawn("counter"));
    expect(corner({ resource: "clay" })).toBe(drawn("counter"));
  });

  it("is the bars for a number the run works out", () => {
    for (const field of ["score", "unit", "clock", "latest", "leader"] as const) {
      expect(corner(field), field).toBe(drawn("metric"));
    }
  });

  it("draws the two differently, which is the whole point of the pair", () => {
    expect(corner({ counter: "hits" })).not.toBe(corner("score"));
  });
});
