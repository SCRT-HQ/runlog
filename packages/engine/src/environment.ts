import type { Pack } from "@runlog/rules-schema";
import { subjectLabel } from "./eligibility.ts";
import type { RunState, Subject } from "./types.ts";

/**
 * The world outside the app.
 *
 * "An ordered list of things I am making, which the app does not own" covers a
 * folder of drawings, a git worktree, a workout log and a session in a
 * recording program equally well. The port is named for that shape rather than
 * for whichever adapter happens to get written first — otherwise the first one
 * quietly becomes the interface, and every later environment has to pretend to
 * be it.
 *
 * The engine never talks to any of it. What lives here is the *contract* and
 * the pure reconciliation over it: given what the run believes and what the
 * environment reports, what disagrees? Everything that touches a socket is an
 * adapter in the app.
 */

/** One thing the environment is keeping: a track, a file, a layer. */
export interface ExternalSubject {
  /** Stable in the environment. A track id, a path — never the display name. */
  id: string;
  name: string;
  /** Position in the environment's own ordering, 1-based. */
  index: number;
  /** Whatever the environment calls its kinds: "audio", "midi", ".ts". */
  kind?: string;
  /** The environment considers it silent or disabled. */
  muted?: boolean;
}

export type ExternalEvent =
  | { t: "subjectAdded"; subject: ExternalSubject }
  | { t: "subjectRemoved"; id: string }
  | { t: "subjectRenamed"; id: string; name: string }
  /** Something changed that is cheaper to re-read than to describe. */
  | { t: "changed" };

export type LinkStatus = "disconnected" | "connecting" | "connected" | "unavailable";

export interface EnvironmentLink {
  readonly id: string;
  readonly label: string;
  /** What the adapter needs from the player to work, in one line. */
  readonly requires?: string;

  status(): LinkStatus;
  connect(): Promise<LinkStatus>;
  disconnect(): void;

  snapshot(): Promise<{ subjects: ExternalSubject[] }>;
  /** Returns its own unsubscribe, so a caller never has to keep a handle. */
  subscribe(listener: (event: ExternalEvent) => void): () => void;

  /**
   * Write the board's own name back onto the thing itself.
   *
   * Optional: plenty of environments are readable and not writable. Where one
   * can be written to, the board's label can live on the thing itself, which
   * saves the player copying state marks across by hand.
   */
  applyLabel?(subjectId: string, name: string): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Reconciliation
 * ------------------------------------------------------------------ */

/**
 * The name the app would have the player write on the thing itself.
 *
 * Matching is by name because it is the only identifier the two sides share:
 * the engine numbers its subjects and the environment has ids of its own, and
 * nothing links them but what the player typed.
 */
export const externalName = (pack: Pack, subject: Subject): string =>
  subjectLabel(pack, subject);

/** The part of a name that identifies it, with any state marks stripped off. */
export function baseName(name: string): string {
  const cut = name.indexOf("[");
  return (cut === -1 ? name : name.slice(0, cut)).trim().toLowerCase();
}

export type Difference =
  /** The run has it; the environment does not. */
  | { kind: "missingOutside"; subject: number; expected: string }
  /** The environment has it; the run has never heard of it. */
  | { kind: "unknownInside"; external: ExternalSubject }
  /**
   * Both have it, in different places. This is the one that actually costs a
   * player something: anchored-offset targeting counts positions, so a run
   * whose order disagrees with the session targets the wrong thing while
   * showing convincing working.
   */
  | { kind: "outOfOrder"; subject: number; external: ExternalSubject; at: number; expected: number }
  /** Both have it; the environment's name no longer says what it carries. */
  | { kind: "nameDrift"; subject: number; external: ExternalSubject; expected: string };

export interface Reconciliation {
  differences: Difference[];
  /** Subjects the two sides agree exist, run id to environment id. */
  matched: Array<{ subject: number; external: ExternalSubject }>;
}

/**
 * Compare what the run believes against what the environment reports.
 *
 * Reports rather than resolves. The app cannot know which side is right — the
 * player may have renamed a track for good reason, or forgotten to make one —
 * and silently "fixing" a session on their behalf is exactly the kind of help
 * nobody asked for. Same principle as contradictions in the rules: show the
 * disagreement, let the human rule on it.
 */
export function reconcile(
  pack: Pack,
  state: RunState,
  external: readonly ExternalSubject[],
): Reconciliation {
  const differences: Difference[] = [];
  const matched: Array<{ subject: number; external: ExternalSubject }> = [];

  // Removed subjects are gone from the game on purpose; an environment that
  // still holds one is not in disagreement about anything.
  const live = state.subjects.filter((s) => !s.removed);

  const outside = new Map<string, ExternalSubject[]>();
  for (const e of external) {
    const key = baseName(e.name);
    const bucket = outside.get(key);
    if (bucket) bucket.push(e);
    else outside.set(key, [e]);
  }

  const claimed = new Set<string>();
  /** Where each matched subject sits in the environment, in run order. */
  const positions: Array<{ subject: number; external: ExternalSubject }> = [];

  for (const subject of live) {
    const expected = externalName(pack, subject);
    // An undeclared subject has no name yet, so there is nothing to match on.
    if (!subject.type) continue;

    const bucket = outside.get(baseName(subject.type)) ?? [];
    const hit = bucket.find((e) => !claimed.has(e.id));
    if (!hit) {
      differences.push({ kind: "missingOutside", subject: subject.id, expected });
      continue;
    }
    claimed.add(hit.id);
    matched.push({ subject: subject.id, external: hit });
    positions.push({ subject: subject.id, external: hit });

    if (hit.name.trim() !== expected) {
      differences.push({ kind: "nameDrift", subject: subject.id, external: hit, expected });
    }
  }

  // Order is compared among the things both sides know about: a track the run
  // has never heard of should not make every subject after it look misplaced.
  const byEnvironment = [...positions].sort((a, b) => a.external.index - b.external.index);
  positions.forEach((entry, runOrder) => {
    const at = byEnvironment.findIndex((x) => x.subject === entry.subject);
    if (at !== runOrder) {
      differences.push({
        kind: "outOfOrder",
        subject: entry.subject,
        external: entry.external,
        at: at + 1,
        expected: runOrder + 1,
      });
    }
  });

  for (const e of external) {
    if (!claimed.has(e.id)) differences.push({ kind: "unknownInside", external: e });
  }

  return { differences, matched };
}

/** A one-line account of a difference, for a panel or a log. */
export function describeDifference(pack: Pack, d: Difference): string {
  const v = pack.vocabulary.subject.one;
  switch (d.kind) {
    case "missingOutside":
      return `${v} ${d.subject} is not out there. Expected something named “${d.expected}”.`;
    case "unknownInside":
      return `“${d.external.name}” is out there but not in this run.`;
    case "outOfOrder":
      return `${v} ${d.subject} sits at position ${d.at}, but the run has it ${d.expected}. Targeting counts positions, so this matters.`;
    case "nameDrift":
      return `${v} ${d.subject} is named “${d.external.name}”; the board says “${d.expected}”.`;
  }
}
