// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createThemeRecordFromPreset, parseOpaqueColor, resolveThemeRecord, type PresentationSnapshotV1 } from "@runlog/themes";

import { createBrowserColorSampler } from "./browserColorSampler.ts";

function makeSnapshot(): PresentationSnapshotV1 {
  const record = createThemeRecordFromPreset({ id: "browser", name: "Browser", presetId: "rainbow-road" });
  if (!record.ok) throw new Error("record fixture");
  const snapshot = resolveThemeRecord(record.value);
  if (!snapshot.ok) throw new Error("snapshot fixture");
  return snapshot.value;
}

interface FakeContext {
  fillStyle: string;
  globalAlpha: number;
  globalCompositeOperation: string;
  setTransform(): void;
  clearRect(): void;
  fillRect(): void;
  getImageData(): ImageData;
}

function canvasContext(rejectedFillStyle?: string): FakeContext {
  let painted = [0, 0, 0, 255];
  let fillStyle = "#000000";
  return {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value) {
      if (value !== rejectedFillStyle) fillStyle = value;
    },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    setTransform() {},
    clearRect() {
      painted = [0, 0, 0, 0];
    },
    fillRect() {
      const value = this.fillStyle;
      const hex = /^#([\da-f]{6})$/i.exec(value);
      const rgb = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/i.exec(value);
      if (hex)
        painted = [
          Number.parseInt(hex[1]!.slice(0, 2), 16),
          Number.parseInt(hex[1]!.slice(2, 4), 16),
          Number.parseInt(hex[1]!.slice(4, 6), 16),
          255,
        ];
      else if (rgb) painted = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), 255];
    },
    getImageData() {
      return { data: Uint8ClampedArray.from(painted) } as ImageData;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("the browser color sampler", () => {
  it("validates snapshots before creating DOM", () => {
    const snapshot = makeSnapshot();
    const create = vi.spyOn(document, "createElement");

    expect(() =>
      createBrowserColorSampler({ ...snapshot, colors: { ...snapshot.colors, "surface.page": "bad" as never } }, document),
    ).toThrow(TypeError);
    expect(create).not.toHaveBeenCalled();
  });

  it("owns isolated inert app/widget hosts and removes only those hosts", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext() as never);
    const sentinel = document.createElement("div");
    document.body.append(sentinel);
    const snapshot = makeSnapshot();
    const sampler = createBrowserColorSampler(snapshot, document);
    const hosts = [...document.querySelectorAll<HTMLElement>("[data-contrast-sampler-scope]")];

    expect(hosts.map((host) => host.dataset.contrastSamplerScope)).toEqual(["app", "widget"]);
    for (const host of hosts) {
      expect(host).not.toBe(document.documentElement);
      expect(host.getAttribute("aria-hidden")).toBe("true");
      expect(host.inert).toBe(true);
      expect(host.children).toHaveLength(1);
      expect(host.querySelectorAll("a,button,input,select,textarea,[tabindex]")).toHaveLength(0);
    }
    expect(hosts[0]?.style.getPropertyValue("--bg")).toBe(snapshot.colors["surface.page"]);
    expect(hosts[1]?.style.getPropertyValue("--bg")).toBe(snapshot.colors["widget.ground"]);

    sampler.dispose();
    expect(document.body.contains(sentinel)).toBe(true);
    expect(document.querySelectorAll("[data-contrast-sampler-scope]")).toHaveLength(0);
    expect(sampler.sample({ scope: "app", foregroundCss: "#000000", backgroundCss: "#ffffff", backdropCss: "#ffffff" })).toBeNull();
  });

  it("blocks inherited explicit feedback variables for derived snapshots without mutating the root", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext() as never);
    const rootStyle = document.documentElement.style.cssText;
    document.documentElement.style.setProperty("--warning-background", "#ff0000");
    document.documentElement.style.setProperty("--danger-background", "#00ff00");
    document.documentElement.style.setProperty("--success-background", "#0000ff");
    const pollutedStyle = document.documentElement.style.cssText;

    const sampler = createBrowserColorSampler(makeSnapshot(), document);
    for (const host of document.querySelectorAll<HTMLElement>("[data-contrast-sampler-scope]")) {
      expect(host.style.getPropertyValue("--warning-background")).toBe("initial");
      expect(host.style.getPropertyValue("--danger-background")).toBe("initial");
      expect(host.style.getPropertyValue("--success-background")).toBe("initial");
    }
    expect(document.documentElement.style.cssText).toBe(pollutedStyle);

    sampler.dispose();
    document.documentElement.style.cssText = rootStyle;
  });

  it("resolves accepted computed serialization through the canvas", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext() as never);
    const sampler = createBrowserColorSampler(makeSnapshot(), document);

    expect(getContext).toHaveBeenCalledWith("2d", { colorSpace: "srgb", willReadFrequently: false });
    expect(sampler.sample({ scope: "app", foregroundCss: "#010203", backgroundCss: "#aabbcc", backdropCss: "#ffffff" })).toEqual({
      foreground: "#010203",
      background: "#aabbcc",
    });
    expect(sampler.sample({ scope: "widget", foregroundCss: "not-a-color", backgroundCss: "#aabbcc", backdropCss: "#ffffff" })).toBeNull();
  });

  it("rejects unsupported mixing spaces after resolving variables without rejecting catalog mixtures", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext() as never);
    const sampler = createBrowserColorSampler(makeSnapshot(), document);

    expect(
      sampler.sample({
        scope: "app",
        foregroundCss: "#000000",
        backgroundCss: "color-mix(in unsupported-space, var(--accent) 85%, var(--text))",
        backdropCss: "#ffffff",
      }),
    ).toBeNull();
    expect(
      sampler.sample({
        scope: "app",
        foregroundCss: "#000000",
        backgroundCss: "color-mix(in oklab, var(--accent) 85%, var(--text))",
        backdropCss: "#ffffff",
      }),
    ).not.toBeNull();
    expect(
      sampler.sample({
        scope: "widget",
        foregroundCss: "#000000",
        backgroundCss: "color-mix(in srgb, var(--panel) 82%, transparent)",
        backdropCss: "#ffffff",
      }),
    ).not.toBeNull();
  });

  it("rejects computed colors that canvas fillStyle silently refuses", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext("rgb(170, 187, 204)") as never);
    const sampler = createBrowserColorSampler(makeSnapshot(), document);

    expect(sampler.sample({ scope: "app", foregroundCss: "#000000", backgroundCss: "#aabbcc", backdropCss: "#ffffff" })).toBeNull();
  });

  it("cleans partial setup and returns unsupported when canvas setup is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const sampler = createBrowserColorSampler(makeSnapshot(), document);

    expect(document.querySelectorAll("[data-contrast-sampler-scope]")).toHaveLength(0);
    expect(sampler.sample({ scope: "app", foregroundCss: "#000000", backgroundCss: "#ffffff", backdropCss: "#ffffff" })).toBeNull();
    expect(() => sampler.dispose()).not.toThrow();
  });

  it("turns readback failures into unsupported samples without tearing down owned hosts", () => {
    const context = canvasContext();
    vi.spyOn(context, "getImageData").mockImplementation(() => {
      throw new DOMException("tainted");
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    const sampler = createBrowserColorSampler(makeSnapshot(), document);

    expect(sampler.sample({ scope: "app", foregroundCss: "#000000", backgroundCss: "#ffffff", backdropCss: "#ffffff" })).toBeNull();
    expect(document.querySelectorAll("[data-contrast-sampler-scope]")).toHaveLength(2);
    sampler.dispose();
  });
});
