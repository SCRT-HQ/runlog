import type { Pack } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import type { StoredRun } from "../storage/db.ts";

/**
 * One run, as a row: its name or when it began, when it was last played,
 * whose it is, and whether it is the one open on this device. The same
 * row wherever runs are listed, the library, the setup screen, so the
 * lists read alike. The open run is marked, not locked: from the library
 * it is still a press away, and a row that says it is open but does
 * nothing when pressed reads as broken.
 *
 * A run that has ended says View results rather than Continue. The press
 * is the same press and it opens the same run; what it opens is the
 * result, and a button promising play that cannot happen is a lie the
 * row tells before the page corrects it.
 */
export function RunRow({
  run: r,
  vocabulary,
  open = false,
  score,
  onPick,
  onForget,
}: {
  run: StoredRun;
  vocabulary: Pack["vocabulary"];
  open?: boolean;
  /** The run's score, already formatted, where it has one: an ended run only. */
  score?: string;
  onPick: () => void;
  /** Where forgetting belongs on the row; absent where it does not. */
  onForget?: () => void;
}) {
  const events = r.events as RunEvent[];
  const first = events[0];
  const named = events.reduce<string | null>((n, e) => (e.t === "RunRenamed" ? e.name.trim() || null : n), null);
  const began = first?.at ? onDay(first.at) : "";
  const ended = hasEnded(r);
  const people = r.members?.length ?? 0;
  return (
    <div className={`runRow ${open ? "open" : ""}`}>
      <button className="runRowMain" onClick={onPick}>
        <strong>{named ?? `${vocabulary.run.one} from ${began}`}</strong>
        <span className="muted small runRowMeta">
          <span>
            {open ? "currently open" : `last played ${onDay(r.updatedAt)}`}
            {ended && " · ended"}
            {people > 1 && ` · ${people} at the table`}
            {r.role && r.role !== "owner" && ` · you ${r.role === "viewer" ? "watch" : "play"}`}
          </span>
          {score && <span className="num">{score}</span>}
        </span>
      </button>
      <span className="runRowActions">
        <button className="ghost tiny" onClick={onPick}>
          {ended ? "View results" : "Continue"}
        </button>
        {onForget && (
          <button className="ghost tiny danger" title={`Forget this ${vocabulary.run.one.toLowerCase()}`} onClick={onForget}>
            Forget
          </button>
        )}
      </span>
    </div>
  );
}

/** Whether a run is over: the shelf asks, to know what to offer on it. */
export function hasEnded(run: StoredRun): boolean {
  return (run.events as RunEvent[]).some((e) => e.t === "RunEnded");
}

export function onDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
