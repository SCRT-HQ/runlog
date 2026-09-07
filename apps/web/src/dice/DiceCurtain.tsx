import { useEffect, useState } from "react";
import { DiceTray } from "./DiceTray.tsx";
import type { RolledDie } from "../rolling.ts";

/**
 * A roll that happened at the table, played for someone who was not the
 * one throwing: the same tray, the same tumble, the same dice, then the
 * total. Arrives as a gesture over the socket and is kept for a few
 * seconds; the log line behind it is the record.
 */
export interface RolledGesture {
  at: string;
  from?: string;
  label: string | null;
  notation: string | null;
  total: number | null;
  dice: RolledDie[];
  /** The throw's seed, when the table sent one: the same tumble here as there. */
  seed?: number;
}

/** The `rolled` gesture's payload, as the run view sends it; null when it is not one. */
export function rolledOf(gesture: { kind: string; data: Record<string, unknown>; from?: string; at: string }): RolledGesture | null {
  if (gesture.kind !== "rolled") return null;
  const dice = Array.isArray(gesture.data["dice"]) ? (gesture.data["dice"] as unknown[]) : [];
  const shaped = dice
    .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
    .map((d) => ({
      faces: typeof d["faces"] === "number" ? d["faces"] : 6,
      display: typeof d["display"] === "string" ? d["display"] : "?",
      label: typeof d["label"] === "string" ? d["label"] : "die",
      ...(d["variant"] === "challenge" ? { variant: "challenge" as const } : {}),
    }))
    .slice(0, 12);
  if (shaped.length === 0) return null;
  return {
    at: gesture.at,
    ...(gesture.from ? { from: gesture.from } : {}),
    label: typeof gesture.data["label"] === "string" ? gesture.data["label"] : null,
    notation: typeof gesture.data["notation"] === "string" ? gesture.data["notation"] : null,
    total: typeof gesture.data["total"] === "number" ? gesture.data["total"] : null,
    dice: shaped,
    ...(typeof gesture.data["seed"] === "number" ? { seed: gesture.data["seed"] } : {}),
  };
}

const SHOWN_MS = 6000;

export function DiceCurtain({ roll }: { roll: RolledGesture | null }) {
  const [shown, setShown] = useState<RolledGesture | null>(null);
  const [rollId, setRollId] = useState(0);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!roll) return;
    setShown(roll);
    setSettled(false);
    setRollId((n) => n + 1);
    const t = setTimeout(() => setShown(null), SHOWN_MS);
    return () => clearTimeout(t);
  }, [roll]);
  if (!shown) return null;
  return (
    <aside className={`diceCurtain ${settled ? "settled" : "inAir"}`} aria-live="polite">
      <div className="diceCurtainHead muted small">
        {shown.from ? `${shown.from} rolls` : "Rolling"}
        {shown.label ? ` · ${shown.label}` : ""}
      </div>
      <DiceTray dice={shown.dice} rollId={rollId} {...(shown.seed !== undefined ? { seed: shown.seed } : {})} onSettled={() => setSettled(true)} />
      {shown.total !== null && (
        <div className={`rollTotal ${settled ? "" : "pending"}`}>
          <span className="big">{settled ? shown.total : "…"}</span>
          {shown.notation && <span className="how">{shown.notation}</span>}
        </div>
      )}
    </aside>
  );
}
