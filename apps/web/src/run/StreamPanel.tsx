import { useState } from "react";
import { usePlan } from "../sync/usePlan.ts";
import { WIDGET_KINDS, widgetHref, type WidgetKind } from "../widget/route.ts";
import { liveLinkOf } from "../live/route.ts";
import { canFloat } from "./ControlPanel.tsx";

/**
 * Pop-outs for a stream: one panel of this run on a page of its own, to
 * capture as a browser source or to keep on a second screen. Each opens
 * in a small window; the address is what a capture wants, so it can be
 * copied too. Part of Plus where plans are on, like hosting a table.
 * Lives in the run's Settings dialog.
 */
export function StreamSettings({ runId, race, onControls }: { runId: string; race: boolean; onControls?: () => void }) {
  const plan = usePlan();
  const [clear, setClear] = useState(true);
  const [scale, setScale] = useState(1.25);
  const [copied, setCopied] = useState<WidgetKind | null>(null);
  const [elsewhere, setElsewhere] = useState(false);
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

  const route = (kind: WidgetKind) => ({ kind, runId, bg: clear ? ("clear" as const) : ("solid" as const), scale, ...(elsewhere && token ? { token } : {}) });
  const open = (kind: WidgetKind) => {
    window.open(widgetHref(route(kind)), `runlog-widget-${kind}`, "popup=yes,width=520,height=340");
  };
  const copy = async (kind: WidgetKind) => {
    try {
      await navigator.clipboard.writeText(widgetHref(route(kind)));
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
          <p className="muted small">Each opens on a page of its own, following this run as it moves. Add the address as a browser source in your streaming app, or keep the window on a second screen.{token ? " With a live link shared, an address can carry its token and work on a machine that is not this one." : " Share a live link under People at the table and the addresses can work on another machine too."}</p>
          <div className="padRow">
            <label className="toggle">
              <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
              <span>Clear background</span>
            </label>
            {token && (
              <label className="toggle" title="The address carries the live link's token, so it works on a machine that is not this one">
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
          <ul className="widgetList">
            {WIDGET_KINDS.filter((k) => k.kind !== "race" || race).map((k) => (
              <li key={k.kind}>
                <div>
                  <strong>{k.label}</strong>
                  <p className="muted small">{k.what}</p>
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
