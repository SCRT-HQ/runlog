import type { SoundId } from "./sounds.ts";

/**
 * Which moments in a run make a sound, and which sound.
 *
 * Per device, in localStorage, because whether a phone should ring in a
 * studio is a fact about the phone. Every kind can be off. The defaults
 * ring for the things that happen while you are not looking at the screen
 * - a timer running out, a threshold crossed, an award in a race, and
 * stay quiet for the things you did yourself.
 */

export type AlertKind = "timerDone" | "threshold" | "obligation" | "award" | "unitEntered" | "unitClosed" | "othersMove";

export const ALERT_KINDS: ReadonlyArray<{ id: AlertKind; label: string; what: string }> = [
  { id: "timerDone", label: "A timer runs out", what: "The moment you set a clock for." },
  { id: "threshold", label: "A threshold fires", what: "A tally reaches a number the pack watches for, or a rule fires on its own." },
  { id: "obligation", label: "Something is owed", what: "A result reaches forward: a note to keep, a debt to settle." },
  { id: "award", label: "An award is made", what: "In a moderated run, a contestant is awarded a challenge." },
  { id: "unitEntered", label: "A unit begins", what: "Each new room, stage, match." },
  { id: "unitClosed", label: "A unit closes", what: "Each one finalized." },
  { id: "othersMove", label: "Somebody else moves", what: "In a shared run, another device made a move." },
];

export type AlertChoice = SoundId | "off";

export interface AlertSettings {
  volume: number;
  kinds: Record<AlertKind, AlertChoice>;
}

export const DEFAULT_ALERTS: AlertSettings = {
  volume: 0.6,
  kinds: {
    timerDone: "chime",
    threshold: "bell",
    obligation: "tick",
    award: "pulse",
    unitEntered: "off",
    unitClosed: "off",
    othersMove: "tick",
  },
};

const KEY = "runlog:alerts";

export function loadAlerts(): AlertSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_ALERTS;
    const parsed = JSON.parse(raw) as Partial<AlertSettings>;
    return {
      volume: typeof parsed.volume === "number" ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULT_ALERTS.volume,
      kinds: { ...DEFAULT_ALERTS.kinds, ...(parsed.kinds ?? {}) },
    };
  } catch {
    return DEFAULT_ALERTS;
  }
}

export function saveAlerts(settings: AlertSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode, or storage full: the defaults will do */
  }
}
