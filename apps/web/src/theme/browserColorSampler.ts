import { presentationSnapshotKey, snapshotToResolvedColors, type HexColor, type PresentationSnapshotV1 } from "@runlog/themes";

import { applyPresentation, compilePresentation, type PresentationScope } from "./presentation.ts";

export interface ContrastSamplingRequest {
  readonly scope: "app" | "widget";
  readonly foregroundCss: string;
  readonly backgroundCss: string;
  readonly backdropCss: string;
}

export interface BrowserColorSampler {
  readonly snapshotKey: string;
  sample(request: ContrastSamplingRequest): { readonly foreground: HexColor; readonly background: HexColor } | null;
  dispose(): void;
}

const OPTIONAL_BACKGROUND_PROPERTIES = ["--success-background", "--warning-background", "--danger-background"] as const;
const SENTINEL_ONE = "rgb(1, 2, 3)";
const SENTINEL_TWO = "rgb(4, 5, 6)";

interface SamplingHost {
  readonly host: HTMLDivElement;
  readonly sample: HTMLDivElement;
}

function unsupported(snapshotKey: string): BrowserColorSampler {
  return Object.freeze({
    snapshotKey,
    sample: () => null,
    dispose() {},
  });
}

function createHost(ownerDocument: Document, scope: PresentationScope, presentation: ReturnType<typeof compilePresentation>): SamplingHost {
  const host = ownerDocument.createElement("div");
  host.setAttribute("data-contrast-sampler-scope", scope);
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;contain:strict;";
  applyPresentation(presentation, host);
  for (const property of OPTIONAL_BACKGROUND_PROPERTIES) {
    if (presentation[property] === null) host.style.setProperty(property, "initial");
  }
  const sample = ownerDocument.createElement("div");
  sample.style.cssText = "width:1px;height:1px;";
  host.append(sample);
  return { host, sample };
}

function channelHex(channel: number): string {
  return channel.toString(16).padStart(2, "0");
}

function readOpaquePixel(context: CanvasRenderingContext2D): HexColor | null {
  const data = context.getImageData(0, 0, 1, 1).data;
  if (data.length < 4 || data[3] !== 255) return null;
  return `#${channelHex(data[0]!)}${channelHex(data[1]!)}${channelHex(data[2]!)}` as HexColor;
}

function resetCanvas(context: CanvasRenderingContext2D): void {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, 1, 1);
}

function acceptedStyleColor(sample: HTMLElement, css: string, getComputedStyle: (element: Element) => CSSStyleDeclaration): string | null {
  sample.style.backgroundColor = SENTINEL_ONE;
  sample.style.backgroundColor = css;
  const first = sample.style.backgroundColor;
  sample.style.backgroundColor = SENTINEL_TWO;
  sample.style.backgroundColor = css;
  const second = sample.style.backgroundColor;
  if (first === "" || second === "" || first !== second) return null;
  const computed = getComputedStyle(sample).backgroundColor;
  return computed === "" ? null : computed;
}

function acceptedCanvasColor(context: CanvasRenderingContext2D, css: string): boolean {
  context.fillStyle = SENTINEL_ONE;
  context.fillStyle = css;
  const first = String(context.fillStyle);
  context.fillStyle = SENTINEL_TWO;
  context.fillStyle = css;
  const second = String(context.fillStyle);
  return first !== "" && first === second;
}

function paint(
  context: CanvasRenderingContext2D,
  sample: HTMLElement,
  css: string,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
): boolean {
  const computed = acceptedStyleColor(sample, css, getComputedStyle);
  if (computed === null || !acceptedCanvasColor(context, computed)) return false;
  context.fillRect(0, 0, 1, 1);
  return true;
}

export function createBrowserColorSampler(snapshot: PresentationSnapshotV1, ownerDocument: Document = document): BrowserColorSampler {
  const snapshotKey = presentationSnapshotKey(snapshot);
  const colors = snapshotToResolvedColors(snapshot);
  const appPresentation = compilePresentation(colors, snapshot.fonts, snapshot.colorScheme, "app");
  const widgetPresentation = compilePresentation(colors, snapshot.fonts, snapshot.colorScheme, "widget");
  const owned: HTMLElement[] = [];

  try {
    const view = ownerDocument.defaultView;
    if (view === null || ownerDocument.body === null) throw new TypeError("Document is not ready for color sampling");
    const canvas = ownerDocument.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: false });
    if (context === null || typeof context.getImageData !== "function") throw new TypeError("Canvas color sampling is unavailable");

    const app = createHost(ownerDocument, "app", appPresentation);
    const widget = createHost(ownerDocument, "widget", widgetPresentation);
    owned.push(app.host, widget.host);
    ownerDocument.body.append(app.host, widget.host);
    const hosts = { app, widget } as const;
    const getComputedStyle = view.getComputedStyle.bind(view);
    let disposed = false;

    return Object.freeze({
      snapshotKey,
      sample(request: ContrastSamplingRequest) {
        if (disposed) return null;
        try {
          const target = hosts[request.scope];
          if (target === undefined) return null;
          resetCanvas(context);
          if (!paint(context, target.sample, request.backdropCss, getComputedStyle)) return null;
          if (!paint(context, target.sample, request.backgroundCss, getComputedStyle)) return null;
          const background = readOpaquePixel(context);
          if (background === null) return null;
          if (!paint(context, target.sample, request.foregroundCss, getComputedStyle)) return null;
          const foreground = readOpaquePixel(context);
          return foreground === null ? null : Object.freeze({ foreground, background });
        } catch {
          return null;
        } finally {
          hosts.app.sample.style.backgroundColor = "";
          hosts.widget.sample.style.backgroundColor = "";
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const element of owned) element.remove();
      },
    });
  } catch {
    for (const element of owned) element.remove();
    return unsupported(snapshotKey);
  }
}
