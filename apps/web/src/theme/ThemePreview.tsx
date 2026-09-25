import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { HexColor, PresentationSnapshotV1 } from "@runlog/themes";
import { WidgetPreviewPage } from "../widget/WidgetView.tsx";
import {
  WIDGET_BACKGROUNDS,
  WIDGET_KINDS,
  WIDGET_SCALE_MAX,
  WIDGET_SCALE_MIN,
  type WidgetBackground,
  type WidgetKind,
} from "../widget/route.ts";
import { applyBootAppearance } from "./appearance.ts";
import { THEME_PREVIEW_LINES, THEME_PREVIEW_SNAPSHOT } from "./themePreviewFixture.ts";

/**
 * What the widget sits on in the preview. `page` is the page background of
 * the theme being edited, first and the default: the nearest thing to how a
 * clear widget reads on its own theme, where plain white or black is a
 * harsh comparison. The others are fixed.
 */
type BackdropChoice = "page" | "light" | "dark" | "unknown";

const BACKDROPS: Readonly<Record<Exclude<BackdropChoice, "page">, HexColor | null>> = Object.freeze({
  light: "#ffffff" as HexColor,
  dark: "#111111" as HexColor,
  unknown: null,
});

export interface ThemePreviewProps {
  readonly snapshot: PresentationSnapshotV1;
  readonly onBackdropChange?: (backdrop: HexColor | null) => void;
}

/** Isolated app and real-widget examples compiled from the last valid draft. */
export function ThemePreview({ snapshot, onBackdropChange }: ThemePreviewProps) {
  const appHost = useRef<HTMLDivElement>(null);
  const widgetHost = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<WidgetKind>("scoreboard");
  const [background, setBackground] = useState<WidgetBackground>("solid");
  const [scale, setScale] = useState(1);
  const [backdrop, setBackdrop] = useState<BackdropChoice>("page");

  useLayoutEffect(() => {
    if (appHost.current) applyBootAppearance({ schemaVersion: 1, mode: "snapshot", snapshot }, appHost.current, "app");
    if (widgetHost.current) applyBootAppearance({ schemaVersion: 1, mode: "snapshot", snapshot }, widgetHost.current, "widget");
  }, [snapshot]);

  const scaleStyle = { "--theme-preview-scale": String(scale) } as CSSProperties;
  const pageColor = snapshot.colors["surface.page"];
  const backdropColor = backdrop === "page" ? pageColor : BACKDROPS[backdrop];
  // The contrast review measures against the backdrop in view, and the page
  // choice moves with the theme's own page color as it is edited.
  useEffect(() => {
    onBackdropChange?.(backdropColor);
  }, [backdropColor, onBackdropChange]);

  return (
    <section className="themePreview" aria-labelledby="themePreviewTitle">
      <h2 id="themePreviewTitle">Preview</h2>
      <div className="themeAppPreview" data-testid="theme-app-preview" ref={appHost}>
        <h3>App examples</h3>
        <p className="themePreviewProse">Readable prose shows how a longer explanation feels on this theme.</p>
        <p className="muted">Secondary text adds quieter context without disappearing.</p>
        <div className="padRow">
          <button type="button" className="primary">
            Primary action
          </button>
          <button type="button" className="ghost">
            Secondary action
          </button>
        </div>
        <label>
          <span>Example input</span>
          <input className="textInput" defaultValue="Editable text" />
        </label>
        <label className="radioLine selected">
          <input type="radio" defaultChecked name="themePreviewChoice" />
          <span>Selected control</span>
        </label>
        <dl className="themePreviewType">
          <div>
            <dt>Numeric</dt>
            <dd className="num">12:34</dd>
          </div>
          <div>
            <dt>Technical</dt>
            <dd className="technical">surface.page</dd>
          </div>
        </dl>
        <p className="notice">Status feedback uses theme warning roles.</p>
      </div>

      <div className="themePreviewControls">
        <label>
          <span>Widget kind</span>
          <select className="textInput" value={kind} onChange={(event) => setKind(event.target.value as WidgetKind)}>
            {WIDGET_KINDS.map((entry) => (
              <option value={entry.kind} key={entry.kind}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Widget background</span>
          <select className="textInput" value={background} onChange={(event) => setBackground(event.target.value as WidgetBackground)}>
            {WIDGET_BACKGROUNDS.map((entry) => (
              <option value={entry.bg} key={entry.bg}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Widget scale</span>
          <input
            type="range"
            min={WIDGET_SCALE_MIN}
            max={WIDGET_SCALE_MAX}
            step="0.25"
            value={scale}
            onChange={(event) => setScale(Number(event.target.value))}
          />
          <output>{scale.toFixed(2)}×</output>
        </label>
        <label>
          <span>Preview backdrop</span>
          <select className="textInput" value={backdrop} onChange={(event) => setBackdrop(event.target.value as BackdropChoice)}>
            <option value="page">This theme's page · {pageColor}</option>
            <option value="light">Light · #ffffff</option>
            <option value="dark">Dark · #111111</option>
            <option value="unknown">Unknown external background</option>
          </select>
        </label>
      </div>

      <div
        className={`themeWidgetViewport backdrop-${backdrop}`}
        role="region"
        aria-label="Widget preview scroll area"
        style={backdropColor === null ? undefined : { backgroundColor: backdropColor }}
      >
        <div className="themeWidgetScale" data-testid="theme-widget-scale" style={scaleStyle}>
          <div
            className="themeWidgetPreview"
            data-testid="theme-widget-preview"
            data-preview-widget-background={background}
            ref={widgetHost}
          >
            <WidgetPreviewPage kind={kind} snapshot={THEME_PREVIEW_SNAPSHOT} lines={THEME_PREVIEW_LINES} />
          </div>
        </div>
      </div>
    </section>
  );
}
