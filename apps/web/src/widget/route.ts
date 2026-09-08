import { isThemeId, type ThemeId } from "../theme/theme.ts";

/**
 * A widget's address: `#widget/<kind>/<runId>`, with the look after a
 * question mark inside the hash so the app's own query string stays what
 * it is: `?bg=clear&scale=1.5&theme=ember`. A stream capture opens the
 * address as a browser source; a person opens it as a pop-out from the run.
 */
export const WIDGET_KINDS = [
  { kind: "scoreboard", label: "Scoreboard", what: "Standings in a moderated run: places, points, marks.", size: { w: 480, h: 440 } },
  { kind: "race", label: "Race", what: "The race leaderboard, as the racers' devices report it.", size: { w: 560, h: 440 } },
  { kind: "clock", label: "Clock", what: "The unit's stopwatch or timer, large.", size: { w: 480, h: 200 } },
  { kind: "step", label: "Step", what: "The current step, the constraints in play, and the latest result.", size: { w: 520, h: 380 } },
  { kind: "stats", label: "Stats", what: "Where the run stands: unit, units done, time, step, constraints, score.", size: { w: 520, h: 560 } },
  { kind: "trackers", label: "Trackers", what: "Resources and counters, as bars and boxes.", size: { w: 480, h: 420 } },
  { kind: "ticker", label: "Ticker", what: "The last few things that happened, one line each, newest on top: dice, results, points, clocks, the unit closing.", size: { w: 520, h: 300 } },
  { kind: "column", label: "Everything, stacked", what: "Clock, step, ticker, stats, scoreboard, race and trackers in one column, leaving out what the run has nothing for.", size: { w: 460, h: 1080 } },
] as const;

/** The size a browser source wants for a kind, in pixels, as the address scales it: the numbers in the docs are at 1.25×. */
export function widgetSize(kind: WidgetKind, scale: number): { w: number; h: number } {
  const spec = WIDGET_KINDS.find((k) => k.kind === kind)!.size;
  const by = scale / 1.25;
  return { w: Math.round(spec.w * by), h: Math.round(spec.h * by) };
}

export type WidgetKind = (typeof WIDGET_KINDS)[number]["kind"];

/** The page's ground, as the address names it. */
export const WIDGET_BACKGROUNDS = [
  { bg: "clear", label: "Clear", what: "The panel on nothing: the scene shows through around it." },
  { bg: "solid", label: "Solid", what: "The theme's own ground, as a window of the app." },
  { bg: "none", label: "None", what: "Neither ground nor panel: the words and numbers alone, for a scene that frames them itself." },
] as const;

export type WidgetBackground = (typeof WIDGET_BACKGROUNDS)[number]["bg"];

export interface WidgetRoute {
  kind: WidgetKind;
  runId: string;
  /** Clear lets the capture show through around the panel; solid paints the theme's ground; none paints nothing at all. */
  bg: WidgetBackground;
  /** Type size, 1 = the app's. */
  scale: number;
  /** A live link's token: the widget reads the run by its link instead of this device's storage. */
  token?: string;
  /**
   * A theme pinned in the address, so a capture looks the same whatever the
   * streaming machine has chosen for itself. Absent, the widget follows the
   * device like any page; "system" is that absence, so it is never carried.
   */
  theme?: Exclude<ThemeId, "system">;
}

const KINDS = new Set<string>(WIDGET_KINDS.map((k) => k.kind));
const BACKGROUNDS = new Set<string>(WIDGET_BACKGROUNDS.map((b) => b.bg));

export function widgetFromHash(hash: string): WidgetRoute | null {
  const m = /^#widget\/([a-z]+)\/([A-Za-z0-9_-]+)(?:\?(.*))?$/.exec(hash);
  if (!m || !KINDS.has(m[1]!)) return null;
  const q = new URLSearchParams(m[3] ?? "");
  const scale = Number(q.get("scale") ?? "1");
  const token = q.get("t") ?? "";
  const bg = q.get("bg") ?? "";
  const theme = q.get("theme");
  return {
    kind: m[1] as WidgetKind,
    runId: m[2]!,
    bg: BACKGROUNDS.has(bg) ? (bg as WidgetBackground) : "solid",
    scale: Number.isFinite(scale) && scale >= 0.5 && scale <= 4 ? scale : 1,
    ...(token ? { token } : {}),
    ...(isThemeId(theme) && theme !== "system" ? { theme } : {}),
  };
}

export function widgetHash(route: WidgetRoute): string {
  const q = new URLSearchParams();
  if (route.bg !== "solid") q.set("bg", route.bg);
  if (route.scale !== 1) q.set("scale", String(route.scale));
  if (route.theme) q.set("theme", route.theme);
  if (route.token) q.set("t", route.token);
  const query = q.toString();
  return `#widget/${route.kind}/${route.runId}${query ? `?${query}` : ""}`;
}

/** The full address, for a browser source in a stream. */
export function widgetHref(route: WidgetRoute, base: string = location.href): string {
  const url = new URL(base);
  url.hash = widgetHash(route);
  url.search = "";
  return url.toString();
}
