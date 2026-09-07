import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Die } from "./Die.tsx";
import type { RolledDie } from "../rolling.ts";
import { dice3dEnabled, loadDice3d } from "./settings.ts";
import type { Dice3DProps } from "./three/Dice3D.tsx";

/**
 * The tray the dice land in.
 *
 * The important thing about this component is what it does *not* do: it never
 * decides anything. The result arrives already determined by the engine's
 * random source, and the tumble is a presentation of a fact that is already
 * true. That ordering is what lets a shared seed reproduce a run exactly while
 * still looking like dice being thrown.
 *
 * Faces shown mid-tumble are cosmetic noise from `Math.random` — deliberately
 * not the seeded source, so watching the animation cannot leak or perturb it.
 */

const TUMBLE_MS = 620;
const STAGGER_MS = 90;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** A plausible face for a die mid-flight. Never the settled value. */
function scrambleFace(die: RolledDie): string {
  if (die.label === "tens") return String(Math.floor(Math.random() * 10) * 10).padStart(2, "0");
  if (die.label === "ones") return String(Math.floor(Math.random() * 10));
  return String(Math.floor(Math.random() * die.faces) + 1);
}

export interface DiceTrayProps {
  dice: RolledDie[];
  /** Bumped by the caller on every roll, so a repeat of the same result still animates. */
  rollId: number;
  /**
   * Fired when the last die stops.
   *
   * The caller uses this to hold the outcome back until the dice have actually
   * settled. Showing which entry was hit while they are still in the air
   * answers the question before the throw has finished asking it.
   */
  onSettled?: () => void;
  /**
   * The throw's seed: the shove, the spin, the bounce, never the value.
   * Given, so everyone watching sees the same tumble; absent, one is
   * drawn for this roll.
   */
  seed?: number;
}

export function DiceTray({ dice, rollId, onSettled, seed }: DiceTrayProps) {
  const [tumbling, setTumbling] = useState(false);
  const [faces, setFaces] = useState<string[]>(() => dice.map((d) => d.display));
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  // Three dimensions where switched on and drawable: the roller is fetched
  // once, and until it is here the flat tray waits rather than tumbles.
  const [three, setThree] = useState<ComponentType<Dice3DProps> | null | undefined>(() => (dice3dEnabled() ? undefined : null));
  useEffect(() => {
    if (three !== undefined) return;
    let live = true;
    void loadDice3d().then((m) => live && setThree(m ? () => m.Dice3D : null));
    return () => {
      live = false;
    };
  }, [three]);
  const throwSeed = useMemo(() => seed ?? Math.floor(Math.random() * 4294967296), [seed, rollId]);

  useEffect(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];

    if (dice.length === 0 || three !== null) return;

    if (prefersReducedMotion()) {
      setTumbling(false);
      setFaces(dice.map((d) => d.display));
      onSettled?.();
      return;
    }

    setTumbling(true);
    const scramble = setInterval(() => setFaces(dice.map(scrambleFace)), 60);

    // Each die settles a little after the one before it, which reads as a
    // handful thrown together rather than a row of counters flipping.
    dice.forEach((die, i) => {
      timers.current.push(
        setTimeout(
          () => setFaces((prev) => prev.map((f, j) => (j === i ? die.display : f))),
          TUMBLE_MS + i * STAGGER_MS,
        ),
      );
    });

    timers.current.push(
      setTimeout(
        () => {
          clearInterval(scramble);
          setTumbling(false);
          setFaces(dice.map((d) => d.display));
          onSettled?.();
        },
        TUMBLE_MS + dice.length * STAGGER_MS,
      ),
    );

    return () => {
      clearInterval(scramble);
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
    // rollId is the signal: the same dice rolled again must animate again.
    // onSettled is deliberately not a dependency -- a parent re-render must not
    // restart an animation that is already in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId, dice, three]);

  if (dice.length === 0) return null;

  if (three === undefined) return <div className="tray tray3d waiting" aria-live="polite" />;
  if (three) {
    const Roller = three;
    return (
      <div className="tray tray3d" aria-live="polite" aria-label={dice.map((d) => `${d.label} showing ${d.display}`).join(", ")}>
        <Roller dice={dice} rollId={rollId} seed={throwSeed} onSettled={onSettled} />
      </div>
    );
  }

  return (
    <div className="tray" aria-live="polite">
      {dice.map((die, i) => (
        <Die
          key={i}
          faces={die.faces}
          display={faces[i] ?? die.display}
          label={die.label}
          variant={die.variant}
          rolling={tumbling && faces[i] !== die.display}
          settleDelay={i * STAGGER_MS}
        />
      ))}
    </div>
  );
}
