import { useEffect, useRef, useState } from "react";
import type { RunEvent } from "@runlog/engine";
import { DEFAULT_ALERTS, loadAlerts, saveAlerts, type AlertKind, type AlertSettings } from "./settings.ts";
import { play } from "./sounds.ts";

/**
 * Turn what just happened in the log into a sound, if the settings say so.
 *
 * Watches the tail of the event list: every event past the last one seen
 * is classified and, if its kind has a sound, played once. The first render
 * of a run seeds the watermark without playing anything, so opening an old
 * run does not replay a week of bells. `me` is the author this device
 * writes as, so another device's moves can ring and one's own do not.
 */
export function useAlertSettings(): [AlertSettings, (next: AlertSettings) => void] {
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_ALERTS);
  useEffect(() => {
    setSettings(loadAlerts());
    const onChange = (e: StorageEvent) => {
      if (e.key === "runlog:alerts") setSettings(loadAlerts());
    };
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, []);
  const update = (next: AlertSettings) => {
    setSettings(next);
    saveAlerts(next);
  };
  return [settings, update];
}

/** The alert an event is, or null when it is nobody's business. */
export function alertFor(event: RunEvent, me: string | null): AlertKind | null {
  if (me !== null && event.author && event.author !== me) return "othersMove";
  switch (event.t) {
    case "ClockStopped":
      return event.expired ? "timerDone" : null;
    case "TriggerFired":
      return event.key.startsWith("move:") ? null : "threshold";
    case "ObligationAdded":
      return "obligation";
    case "Awarded":
      return "award";
    case "UnitEntered":
      return "unitEntered";
    case "UnitFinalized":
      return "unitClosed";
    default:
      return null;
  }
}

export function useAlerts(events: RunEvent[], runId: string | null, me: string | null, settings: AlertSettings): void {
  const seen = useRef<{ run: string | null; count: number }>({ run: null, count: 0 });
  useEffect(() => {
    if (seen.current.run !== runId) {
      seen.current = { run: runId, count: events.length };
      return;
    }
    const fresh = events.slice(seen.current.count);
    seen.current.count = events.length;
    const kinds = new Set<AlertKind>();
    for (const e of fresh) {
      const k = alertFor(e, me);
      if (k) kinds.add(k);
    }
    // One sound per batch, the loudest kind first, so a unit closing with a
    // clock stopping and an award made does not play three things at once.
    const order: AlertKind[] = ["timerDone", "award", "threshold", "obligation", "othersMove", "unitClosed", "unitEntered"];
    const first = order.find((k) => kinds.has(k) && settings.kinds[k] !== "off");
    if (first) {
      const sound = settings.kinds[first];
      if (sound !== "off") play(sound, settings.volume);
    }
  }, [events, runId, me, settings]);
}
