import type { Pack } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import type { StoredRun } from "../storage/db.ts";

/**
 * One run, as a row: its name or when it began, when it was last played,
 * whose it is, and whether it is the one open on this device. The same
 * row wherever runs are listed — the library, the setup screen — so the
 * lists read alike.
 */
export function RunRow({
  run: r,
  vocabulary,
  open = false,
  onPick,
  onForget,
}: {
  run: StoredRun;
  vocabulary: Pack["vocabulary"];
  open?: boolean;
  onPick: () => void;
  /** Where forgetting belongs on the row; absent where it does not. */
  onForget?: () => void;
}) {
  const events = r.events as RunEvent[];
  const first = events[0];
  const named = events.reduce<string | null>((n, e) => (e.t === "RunRenamed" ? e.name.trim() || null : n), null);
  const began = first?.at ? onDay(first.at) : "";
  const ended = events.some((e) => e.t === "RunEnded");
  const people = r.members?.length ?? 0;
  return (
    <div className={`runRow ${open ? "open" : ""}`}>
      <button className="runRowMain" onClick={onPick} disabled={open}>
        <strong>{named ?? `${vocabulary.run.one} from ${began}`}</strong>
        <span className="muted small">
          {open ? "open here" : `last played ${onDay(r.updatedAt)}`}
          {ended && " · ended"}
          {people > 1 && ` · ${people} at the table`}
          {r.role && r.role !== "owner" && ` · you ${r.role === "viewer" ? "watch" : "play"}`}
        </span>
      </button>
      <span className="runRowActions">
        {!open && (
          <button className="ghost tiny" onClick={onPick}>
            Continue
          </button>
        )}
        {onForget && (
          <button className="ghost tiny danger" title={`Forget this ${vocabulary.run.one.toLowerCase()}`} onClick={onForget}>
            Forget
          </button>
        )}
      </span>
    </div>
  );
}

export function onDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
