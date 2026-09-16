import { describe, expect, it, vi } from "vitest";

/**
 * Which drawing a Metric key wears, which is the one thing about this
 * action that is not the same on every key it is placed on.
 *
 * The action imports the whole plugin for its store, so both are faked:
 * the SDK down to the decorator, which is what sets `manifestId` and so
 * what the base class picks a glyph by, and the plugin module to nothing
 * that opens a socket. Nothing here presses anything.
 */
vi.mock("@elgato/streamdeck", () => {
  class SingletonAction {}
  return {
    default: { logger: { info: () => {}, error: () => {} }, ui: { sendToPropertyInspector: async () => {} } },
    action:
      ({ UUID }: { UUID: string }) =>
      (target: { prototype: Record<string, unknown> }) => {
        target.prototype["manifestId"] = UUID;
        return target;
      },
    SingletonAction,
  };
});
vi.mock("../plugin.ts", () => ({
  store: { state: null, subscribe: () => () => {} },
  sayWho: async () => {},
  wire: { press: () => null },
}));

const { GLYPHS } = await import("../glyphs.ts");
const { faceImage } = await import("../face.ts");
const { initial } = await import("../state.ts");
const { Metric } = await import("./metric.ts");
import type { MetricSettings } from "./metric.ts";

/** The corner of a key set to this field, as the markup the face drew there. */
function corner(field: MetricSettings["field"]): string {
  const metric = new Metric();
  const settings: MetricSettings = field === undefined ? {} : { field };
  const reach = metric as unknown as { glyph(s: MetricSettings): string | undefined };
  const image = faceImage(metric.face(initial(), settings, 0), reach.glyph(settings));
  const svg = Buffer.from(image.split(",")[1]!, "base64").toString("utf8");
  return /<g transform="translate\(8 8\)[^>]*>(.*)<\/g>/.exec(svg)?.[1] ?? "";
}

/** The quiet ink a corner is drawn in on the tones a Metric key takes. */
const drawn = (name: string) => GLYPHS[name]!.replaceAll("#ffffff", "#8d958f");

describe("the drawing in a Metric key's corner", () => {
  it("is the stepper for a number somebody keeps by hand", () => {
    expect(corner({ counter: "calm" })).toBe(drawn("counter"));
    expect(corner({ resource: "glaze" })).toBe(drawn("counter"));
  });

  it("is the bars for a number the run works out", () => {
    for (const field of ["score", "unit", "clock", "latest", "leader"] as const) {
      expect(corner(field), field).toBe(drawn("metric"));
    }
  });

  it("draws the two differently, which is the whole point of the pair", () => {
    expect(corner({ counter: "calm" })).not.toBe(corner("score"));
  });
});
