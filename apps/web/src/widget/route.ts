/**
 * A widget's address: `#widget/<kind>/<runId>`, with the look after a
 * question mark inside the hash so the app's own query string stays what
 * it is: `?bg=clear&scale=1.5`. A stream capture opens the address as a
 * browser source; a person opens it as a pop-out from the run.
 */
export const WIDGET_KINDS = [
  { kind: "scoreboard", label: "Scoreboard", what: "Standings in a moderated run: places, points, marks." },
  { kind: "race", label: "Race", what: "The race leaderboard, as the racers' devices report it." },
  { kind: "clock", label: "Clock", what: "The unit's stopwatch or timer, large." },
  { kind: "stats", label: "Stats", what: "Where the run stands: unit, units done, time, points." },
  { kind: "trackers", label: "Trackers", what: "Resources and counters, as bars and boxes." },
  { kind: "column", label: "Everything, stacked", what: "Clock, stats, scoreboard, race and trackers in one column, leaving out what the run has nothing for." },
] as const;

export type WidgetKind = (typeof WIDGET_KINDS)[number]["kind"];

export interface WidgetRoute {
  kind: WidgetKind;
  runId: string;
  /** Clear lets the capture show through; solid paints the theme's ground. */
  bg: "clear" | "solid";
  /** Type size, 1 = the app's. */
  scale: number;
  /** A live link's token: the widget reads the run by its link instead of this device's storage. */
  token?: string;
}

const KINDS = new Set<string>(WIDGET_KINDS.map((k) => k.kind));

export function widgetFromHash(hash: string): WidgetRoute | null {
  const m = /^#widget\/([a-z]+)\/([A-Za-z0-9_-]+)(?:\?(.*))?$/.exec(hash);
  if (!m || !KINDS.has(m[1]!)) return null;
  const q = new URLSearchParams(m[3] ?? "");
  const scale = Number(q.get("scale") ?? "1");
  const token = q.get("t") ?? "";
  return {
    kind: m[1] as WidgetKind,
    runId: m[2]!,
    bg: q.get("bg") === "clear" ? "clear" : "solid",
    scale: Number.isFinite(scale) && scale >= 0.5 && scale <= 4 ? scale : 1,
    ...(token ? { token } : {}),
  };
}

export function widgetHash(route: WidgetRoute): string {
  const q = new URLSearchParams();
  if (route.bg === "clear") q.set("bg", "clear");
  if (route.scale !== 1) q.set("scale", String(route.scale));
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
