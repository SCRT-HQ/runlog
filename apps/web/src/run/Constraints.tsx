import type { ReactNode } from "react";
import type { ConstraintLine } from "@runlog/engine";

/**
 * The rules already drawn this unit, in front of the player while they work.
 *
 * `constraintsFor`, what to say, lives in the engine's flow.ts, since the
 * live view and its widgets need it with no page around them at all. This is
 * only how it is shown, and the page's step cards and the floating remote
 * share this one component so the two cannot render it differently.
 */
export function Constraints({ lines, action }: { lines: ConstraintLine[]; action?: (line: ConstraintLine) => ReactNode }) {
  if (lines.length === 0) return null;
  return (
    <div className="notice constraints">
      <span className="muted small">The game has already had its say</span>
      <ul>
        {lines.map((line, i) => {
          const move = action?.(line);
          return (
            <li key={i} className={move ? "owing" : ""}>
              <strong>{line.text}</strong>
              {/* A rule the game has not finished with carries the move it
                  is waiting on, rather than saying so again further down. */}
              {move}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
