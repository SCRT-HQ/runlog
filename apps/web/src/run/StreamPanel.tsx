import { useState } from "react";
import { usePlan } from "../sync/usePlan.ts";
import { THEMES, type ThemeId } from "../theme/theme.ts";
import { WIDGET_BACKGROUNDS, WIDGET_KINDS, widgetHref, widgetSize, type WidgetBackground, type WidgetKind, type WidgetRoute } from "../widget/route.ts";
import { liveLinkOf } from "../live/route.ts";
import { dockHref } from "../dock/route.ts";
import { canFloat } from "./ControlPanel.tsx";

/** The themes an address may pin: every look but "system", which is the choice not to pin one. */
const PINNABLE = THEMES.filter((t): t is (typeof THEMES)[number] & { id: Exclude<ThemeId, "system"> } => t.id !== "system");

/**
 * Pop-outs for a stream: one panel of this run on a page of its own, to
 * capture as a browser source or to keep on a second screen. Each opens
 * in a small window; the address is what a capture wants, so it can be
 * copied too. Part of Plus where plans are on, like hosting a table.
 * Lives in the run's Settings dialog.
 */
export function StreamSettings({ runId, race, onControls }: { runId: string; race: boolean; onControls?: () => void }) {
  const plan = usePlan();
  const [bg, setBg] = useState<WidgetBackground>("clear");
  const [scale, setScale] = useState(1.25);
  // "" is no pin: the widget follows the machine it opens on, like any page.
  const [theme, setTheme] = useState<WidgetRoute["theme"] | "">("");
  const [copied, setCopied] = useState<WidgetKind | "dock" | null>(null);
  const allowed = !plan.gates || plan.can("plus");
  // The live link's token, when the run is shared: a widget with it works on any machine.
  const token = (() => {
    const link = liveLinkOf(runId);
    if (!link) return null;
    try {
      return new URL(link).searchParams.get("t") || new URL(link).hash.split("?t=")[1]?.split("&")[0] || null;
    } catch {
      return null;
    }
  })();
  // On by default once there is a token: the address with it is the one a streaming app needs,
  // since its browser holds none of this device's runs; the plain address is for a pop-out here.
  const [elsewhere, setElsewhere] = useState(() => Boolean(token));

  const route = (kind: WidgetKind): WidgetRoute => ({ kind, runId, bg, scale, ...(theme ? { theme } : {}), ...(elsewhere && token ? { token } : {}) });
  const open = (kind: WidgetKind) => {
    const { w, h } = widgetSize(kind, scale);
    window.open(widgetHref(route(kind)), `runlog-widget-${kind}`, `popup=yes,width=${w},height=${h}`);
  };
  const copy = async (kind: WidgetKind | "dock") => {
    try {
      await navigator.clipboard.writeText(kind === "dock" ? dockHref({ kind: "controls", runId }) : widgetHref(route(kind)));
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* no clipboard: the window is still there to copy from */
    }
  };

  return (
    <div className="streamSettings">
      {!allowed ? (
        <p className="muted small">Pop-out widgets for a stream — the scoreboard, the clock, the race — are part of Plus, like hosting a table. Subscribe from your profile, under Plan.</p>
      ) : (
        <>
          <p className="muted small">Each opens on a page of its own, following this run as it moves. Add the address as a browser source in your streaming app, or keep the window on a second screen.{token ? " A streaming app needs the address with the live link's token in it, since its own browser holds none of this device's runs; the plain address is for a window here." : " Share a live link under People at the table first: a streaming app needs the address with the link's token in it, since its own browser holds none of this device's runs."}</p>
          <div className="padRow">
            <label className="toggle" title={WIDGET_BACKGROUNDS.find((b) => b.bg === bg)?.what}>
              <span>Background</span>
              <select className="chipAdd" value={bg} onChange={(e) => setBg(e.target.value as WidgetBackground)} aria-label="Widget background">
                {WIDGET_BACKGROUNDS.map((b) => (
                  <option key={b.bg} value={b.bg}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle" title="Pinned in the address, so the capture looks the same whatever the streaming machine has chosen">
              <span>Theme</span>
              <select className="chipAdd" value={theme} onChange={(e) => setTheme(e.target.value as WidgetRoute["theme"] | "")} aria-label="Widget theme">
                <option value="">Follow the device</option>
                {PINNABLE.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {token && (
              <label className="toggle" title="The address carries the live link's token, so it works in a streaming app and on a machine that is not this one">
                <input type="checkbox" checked={elsewhere} onChange={(e) => setElsewhere(e.target.checked)} />
                <span>For another machine</span>
              </label>
            )}
            <label className="toggle">
              <span>Size</span>
              <select className="chipAdd" value={String(scale)} onChange={(e) => setScale(Number(e.target.value))} aria-label="Widget size">
                <option value="1">1×</option>
                <option value="1.25">1.25×</option>
                <option value="1.5">1.5×</option>
                <option value="2">2×</option>
              </select>
            </label>
          </div>
          <div className="padRow floatRow">
            <button className="ghost tiny" disabled={!canFloat() || !onControls} onClick={onControls} title="The run's next move, its last result and undo, in a small window that stays in front">
              Float the controls
            </button>
            <span className="muted small">
              {canFloat()
                ? "A small window the browser keeps above everything else: the next move, the last result, undo."
                : "Floating a window above the others needs Chrome or Edge; this browser cannot keep one in front."}
            </span>
          </div>
          <div className="padRow floatRow">
            <button className="ghost tiny" onClick={() => void copy("dock")} title="The same controls on a page of their own, for a streaming app's custom browser dock; sign in there once and the run follows">
              {copied === "dock" ? "Copied" : "Copy dock address"}
            </button>
            <span className="muted small">The same controls as a page, for a dock beside your streaming app's preview: OBS calls it a Custom Browser Dock. Sign in there once; the run must be on that machine too.</span>
          </div>
          <ul className="widgetList">
            {WIDGET_KINDS.filter((k) => k.kind !== "race" || race).map((k) => (
              <li key={k.kind}>
                <div>
                  <strong>{k.label}</strong>
                  <p className="muted small">{k.what}</p>
                  <p className="muted small">
                    Suggested size {widgetSize(k.kind, scale).w} × {widgetSize(k.kind, scale).h}
                  </p>
                </div>
                <div className="padRow">
                  <button className="ghost tiny" onClick={() => open(k.kind)}>
                    Open
                  </button>
                  <button className="ghost tiny" onClick={() => void copy(k.kind)}>
                    {copied === k.kind ? "Copied" : "Copy address"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
