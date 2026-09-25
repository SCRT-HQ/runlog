import { useEffect, useRef, useState } from "react";
import { usePlan } from "../sync/usePlan.ts";
import { THEMES, type ThemeId } from "../theme/theme.ts";
import {
  WIDGET_BACKGROUNDS,
  WIDGET_KINDS,
  widgetHref,
  widgetSize,
  type WidgetBackground,
  type WidgetKind,
  type WidgetRoute,
} from "../widget/route.ts";
import { liveLinkOf } from "../live/route.ts";
import { dockHref } from "../dock/route.ts";
import { canFloat } from "./ControlPanel.tsx";
import { useAppearance } from "../theme/useAppearance.ts";
import { pinFromAppearance } from "../widget/look.ts";
import { useLookChannel, type LookChannelView } from "../theme/follow/LookChannelProvider.tsx";
import type { LookActionResult } from "../theme/follow/publisher.ts";

/** The themes an address may pin: every look but "system", which is the choice not to pin one. */
const PINNABLE = THEMES.filter((t): t is (typeof THEMES)[number] & { id: Exclude<ThemeId, "system"> } => t.id !== "system");
type CopyTarget = WidgetKind | "dock";
type CopyOutcome = { target: CopyTarget; kind: "success" | "failure" };
/** "" follows the device; "pin" carries the current theme's values; "follow" carries a theme link's key; a built-in id names that built-in. */
type ThemeChoice = "" | "pin" | "follow" | Exclude<ThemeId, "system">;

const FOLLOW_PROBLEMS: Record<Exclude<LookActionResult, "ok">, string> = {
  plan: "Following this device from anywhere is part of Plus.",
  full: "This account has as many theme links as it can hold. Revoke one on your profile, under Streaming.",
  gone: "Could not make the theme link. Try again.",
  error: "Could not make the theme link. Try again.",
};

/** The words beside the choice, from the link's state. */
export function followStatus(view: Pick<LookChannelView, "state">): string {
  switch (view.state.kind) {
    case "following":
      return "Following";
    case "offline":
      return "Offline, showing the last look";
    case "elsewhere":
      return "Published from another device";
    case "gone":
      return "This theme link was revoked";
    default:
      return "Not published yet";
  }
}

/**
 * The pop-outs this page opened with a pinned theme, by run and kind, so
 * "Update pinned theme" can move them to the new pin. Kept outside the
 * panel so closing and reopening Settings still reaches them.
 */
const pinnedWindows = new Map<string, { win: Window; route: WidgetRoute }>();

/** Drops the windows the person has closed, of every run, so the map holds only open ones. */
function pruneClosedWindows() {
  for (const [key, { win }] of pinnedWindows) if (win.closed) pinnedWindows.delete(key);
}

/** How many pop-outs the map holds, closed or not; for tests. */
export function pinnedWindowCount(): number {
  return pinnedWindows.size;
}

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
  const [theme, setTheme] = useState<ThemeChoice>("");
  // The pinned values, taken when "Pin the current theme" is chosen and again only on Update.
  const [pin, setPin] = useState<string | null>(null);
  const [pinUpdated, setPinUpdated] = useState(false);
  const appearance = useAppearance();
  const follow = useLookChannel();
  // A problem with the last theme link action, and the action Try again repeats.
  const [followProblem, setFollowProblem] = useState<{ text: string; retry: () => Promise<LookActionResult> } | null>(null);
  // An address follows the link only once a look has landed on it, and only on a device that knows its key.
  const followKey = follow.channel !== null && follow.channel.published ? follow.channel.readKey : null;
  const held = theme === "follow" && followKey === null;
  const followAction = async (run: () => Promise<LookActionResult>) => {
    setFollowProblem(null);
    let result: LookActionResult;
    try {
      result = await run();
    } catch {
      result = "error";
    }
    setFollowProblem(result === "ok" ? null : { text: FOLLOW_PROBLEMS[result], retry: run });
  };
  const makeLink = () => followAction(() => follow.create());
  const [copyOutcome, setCopyOutcome] = useState<CopyOutcome | null>(null);
  const copyAttempt = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planAccess = plan.access("hostTables");
  const allowed = planAccess === "available";
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

  const route = (kind: WidgetKind): WidgetRoute => ({
    kind,
    runId,
    bg,
    scale,
    ...(theme === "pin"
      ? pin === null
        ? {}
        : { pin }
      : theme === "follow"
        ? followKey === null
          ? {}
          : { ch: followKey }
        : theme
          ? { theme }
          : {}),
    ...(elsewhere && token ? { token } : {}),
  });
  const open = (kind: WidgetKind) => {
    const { w, h } = widgetSize(kind, scale);
    const target = route(kind);
    const win = window.open(widgetHref(target), `runlog-widget-${kind}`, `popup=yes,width=${w},height=${h}`);
    pruneClosedWindows();
    if (win && target.pin !== undefined) pinnedWindows.set(`${runId}:${kind}`, { win, route: target });
    else pinnedWindows.delete(`${runId}:${kind}`);
  };
  const chooseTheme = (value: ThemeChoice) => {
    setTheme(value);
    setPinUpdated(false);
    setPin(value === "pin" ? pinFromAppearance(appearance) : null);
    setFollowProblem(null);
    // The first time: this device's link is made here, and its first look goes out at once.
    if (value === "follow" && follow.channel === null && follow.state.kind !== "gone") void makeLink();
  };
  // A new pin from what the app shows now. Copied addresses are text somewhere else and keep the
  // old one; windows this page opened are moved to the new one.
  const updatePin = () => {
    const next = pinFromAppearance(appearance);
    setPin(next);
    setPinUpdated(true);
    pruneClosedWindows();
    for (const [key, { win, route: was }] of pinnedWindows) {
      if (!key.startsWith(`${runId}:`)) continue;
      const now = { ...was, pin: next };
      try {
        win.location.replace(widgetHref(now));
        pinnedWindows.set(key, { win, route: now });
      } catch {
        pinnedWindows.delete(key);
      }
    }
  };
  const clearCopyTimer = () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    copyTimer.current = null;
  };
  useEffect(() => {
    copyAttempt.current++;
    clearCopyTimer();
    setCopyOutcome(null);
    return () => {
      copyAttempt.current++;
      clearCopyTimer();
    };
  }, [runId]);
  const copy = async (target: CopyTarget) => {
    const attempt = ++copyAttempt.current;
    clearCopyTimer();
    setCopyOutcome(null);
    try {
      await navigator.clipboard.writeText(target === "dock" ? dockHref({ kind: "controls", runId }) : widgetHref(route(target)));
      if (attempt !== copyAttempt.current) return;
      setCopyOutcome({ target, kind: "success" });
      copyTimer.current = setTimeout(() => {
        if (attempt === copyAttempt.current) setCopyOutcome(null);
      }, 1500);
    } catch {
      if (attempt === copyAttempt.current) setCopyOutcome({ target, kind: "failure" });
    }
  };

  return (
    <div className="streamSettings">
      {!allowed ? (
        <div className="muted small">
          {planAccess === "upgrade" ? (
            <p>
              Pop-out widgets for a stream, the scoreboard, the clock, the race, are part of Plus, like hosting a table. Subscribe from your
              profile, under Plan.
            </p>
          ) : planAccess === "checking" ? (
            <p>Checking your plan…</p>
          ) : planAccess === "sign-in" ? (
            <p>Sign in to use stream widgets.</p>
          ) : (
            <p>
              The plan could not be checked.{" "}
              <button className="linkButton" onClick={() => void plan.refresh()}>
                Try again
              </button>
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="muted small">
            Each opens on a page of its own, following this run as it moves. Add the address as a browser source in your streaming app, or
            keep the window on a second screen.
            {token
              ? " A streaming app needs the address with the live link's token in it, since its own browser holds none of this device's runs; the plain address is for a window here."
              : " Share link under People at the table first: a streaming app needs the address with the link's token in it, since its own browser holds none of this device's runs."}
          </p>
          <div className="padRow">
            <label className="toggle" title={WIDGET_BACKGROUNDS.find((b) => b.bg === bg)?.what}>
              <span>Background</span>
              <select
                className="chipAdd"
                value={bg}
                onChange={(e) => setBg(e.target.value as WidgetBackground)}
                aria-label="Widget background"
              >
                {WIDGET_BACKGROUNDS.map((b) => (
                  <option key={b.bg} value={b.bg}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="toggle"
              title={
                follow.available
                  ? "Follow the theme of the machine the widget opens on, pin the current theme's colors and fonts in the address, follow this device's theme from any machine through a theme link, or name a built-in theme"
                  : "Follow the theme of the machine the widget opens on, pin the current theme's colors and fonts in the address, or name a built-in theme"
              }
            >
              <span>Theme</span>
              <select
                className="chipAdd"
                value={theme}
                onChange={(e) => chooseTheme(e.target.value as ThemeChoice)}
                aria-label="Widget theme"
              >
                <option value="">Follow the device</option>
                <option value="pin">Pin the current theme</option>
                {follow.available && <option value="follow">Follow this device from anywhere</option>}
                <optgroup label="Built-in themes">
                  {PINNABLE.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            {token && (
              <label
                className="toggle"
                title="The address carries the live link's token, so it works in a streaming app and on a machine that is not this one"
              >
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
          {theme === "pin" && (
            <div className="padRow floatRow">
              <button className="ghost tiny" onClick={updatePin}>
                Update pinned theme
              </button>
              <span className="muted small" aria-live="polite">
                {pinUpdated
                  ? "Pinned theme updated. Windows opened here now show it. Addresses you copied before keep the old theme: copy the address again and replace it in your streaming app."
                  : "The address carries this theme's colors and fonts. It names no theme and no account, and does not change when you change the app's theme."}
              </span>
            </div>
          )}
          {theme === "follow" && (
            <div className="padRow floatRow">
              <span className="muted small" aria-live="polite">
                {followProblem?.text ?? followStatus(follow)}
              </span>
              {followProblem !== null && (
                <button className="ghost tiny" onClick={() => void followAction(followProblem.retry)}>
                  Try again
                </button>
              )}
              {follow.state.kind === "elsewhere" && follow.channel !== null && (
                <button className="ghost tiny" onClick={() => void followAction(() => follow.takeOver(follow.channel!.id))}>
                  Use this device
                </button>
              )}
              {follow.state.kind === "gone" && (
                <button className="ghost tiny" onClick={() => void makeLink()}>
                  Make a new link
                </button>
              )}
              {follow.channel !== null && follow.channel.readKey === null && (
                <button className="ghost tiny" onClick={() => void followAction(() => follow.relink())}>
                  New link
                </button>
              )}
            </div>
          )}
          <div className="padRow floatRow">
            <button
              className="ghost tiny"
              disabled={!canFloat() || !onControls}
              onClick={onControls}
              title="The run's next move, its last result and undo, in a small window that stays in front"
            >
              Float the controls
            </button>
            <span className="muted small">
              {canFloat()
                ? "A small window the browser keeps above everything else: the next move, the last result, undo."
                : "Floating a window above the others needs Chrome or Edge; this browser cannot keep one in front."}
            </span>
          </div>
          <div className="padRow floatRow">
            <button
              className="ghost tiny"
              onClick={() => void copy("dock")}
              title="The same controls on a page of their own, for a streaming app's custom browser dock; sign in there once and the run follows"
            >
              {copyOutcome?.kind === "success" && copyOutcome.target === "dock" ? "Copied" : "Copy dock address"}
            </button>
            <span className="muted small">
              The same controls as a page, for a dock beside your streaming app's preview: OBS calls it a Custom Browser Dock. Sign in there
              once; the run must be on that machine too.
            </span>
          </div>
          <p className="muted small" role="status">
            {copyOutcome?.kind === "success"
              ? "Copied."
              : copyOutcome?.target === "dock"
                ? "Couldn't copy the dock address. Try again."
                : copyOutcome
                  ? "Couldn't copy the widget address. Try again, or use Open to copy it."
                  : ""}
          </p>
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
                  <button className="ghost tiny" disabled={held} onClick={() => open(k.kind)}>
                    Open
                  </button>
                  <button className="ghost tiny" disabled={held} onClick={() => void copy(k.kind)}>
                    {copyOutcome?.kind === "success" && copyOutcome.target === k.kind ? "Copied" : "Copy address"}
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
