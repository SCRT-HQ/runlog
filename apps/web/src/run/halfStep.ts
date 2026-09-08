import type { Pack } from "@runlog/rules-schema";
import { reduce, type ResolvedOutcome, type RunEvent } from "@runlog/engine";
import type { Pending } from "./useRun.ts";

/**
 * A step half answered, kept on this device.
 *
 * A block of work that asks the player something commits nothing until it
 * finishes; the answers so far live only in memory. Leaving the run for the
 * rules page and coming back used to put the block back to its first
 * question, and a roll that had already shown its number was gone. So the
 * answers are written here, beside the run, keyed by the run and stamped
 * with how long the log was when they were given. On return the block is
 * run again from the top with the same answers, which is how the engine
 * resumes anyway; the log itself is not touched.
 *
 * The record is only good against the log it was made for. If the log has
 * moved (an undo, a pull from another device, a different run) it is dropped.
 */

export interface StoredHalfStep {
  runId: string;
  eventCount: number;
  block: Omit<Pending, "request" | "partial" | "completes"> & {
    completes?: { phaseId: string; index: number };
  };
}

const keyFor = (runId: string) => `runlog:halfstep:${runId}`;

export function saveHalfStep(runId: string, eventCount: number, pending: Pending): void {
  const { request: _r, partial: _p, completes, ...rest } = pending;
  const stored: StoredHalfStep = {
    runId,
    eventCount,
    block: { ...rest, ...(completes ? { completes: { phaseId: completes.phase.id, index: completes.index } } : {}) },
  };
  try {
    localStorage.setItem(keyFor(runId), JSON.stringify(stored));
  } catch {
    /* a private window: the step lasts the tab */
  }
}

export function loadHalfStep(runId: string): StoredHalfStep | null {
  try {
    const raw = localStorage.getItem(keyFor(runId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredHalfStep;
    return parsed && parsed.runId === runId && typeof parsed.eventCount === "number" && parsed.block ? parsed : null;
  } catch {
    return null;
  }
}

export function clearHalfStep(runId: string): void {
  try {
    localStorage.removeItem(keyFor(runId));
  } catch {
    /* nothing to clear */
  }
}

/**
 * The stored block as the run store holds it, or null when the pack no
 * longer has the phase it belonged to.
 */
export function toPending(pack: Pack, stored: StoredHalfStep): Pending | null {
  const { completes, ...block } = stored.block;
  if (!completes) return { ...block };
  const phase = pack.phases.find((p) => p.id === completes.phaseId);
  if (!phase) return null;
  return { ...block, completes: { phase, index: completes.index } };
}

/**
 * What a block has resolved so far, ahead of the log.
 *
 * The engine hands back the events a block produced before it stopped to
 * ask. Folding them over the log shows what the answers so far did: the
 * table line a d100 landed on, before the d6 it led to is thrown. Nothing
 * here is committed; it is the same fold the log will do once the block ends.
 */
export function outcomesAhead(pack: Pack, events: RunEvent[], partial: RunEvent[] | undefined): ResolvedOutcome[] {
  if (!partial || partial.length === 0 || events.length === 0) return [];
  const before = reduce(pack, events).outcomes.length;
  return reduce(pack, [...events, ...partial]).outcomes.slice(before);
}
