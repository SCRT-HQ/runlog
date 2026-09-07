/**
 * A single die, drawn as the polyhedron it actually is.
 *
 * The silhouettes matter more than they might seem to: someone reaching for a
 * d10 at the table recognizes the shape before they read the number, and the
 * whole appeal of these games is that the dice feel like objects rather than a
 * number generator. A d6 gets real pips for the same reason.
 */

export interface DieProps {
  faces: number;
  /** What to show on the face. Not always the raw value: percentile tens read 00–90. */
  display: string;
  /** True while tumbling, so the face is cosmetic and the die is in motion. */
  rolling?: boolean;
  /** Milliseconds to delay the settle, so a handful of dice do not stop as one. */
  settleDelay?: number;
  /** Marks a die as the opposition in an opposed roll. */
  variant?: "normal" | "challenge";
  label?: string;
}

/** Pip positions for a d6, in a 100×100 box. */
const PIPS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [
    [30, 30],
    [70, 70],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [30, 30],
    [70, 30],
    [30, 70],
    [70, 70],
  ],
  5: [
    [30, 30],
    [70, 30],
    [50, 50],
    [30, 70],
    [70, 70],
  ],
  6: [
    [30, 26],
    [70, 26],
    [30, 50],
    [70, 50],
    [30, 74],
    [70, 74],
  ],
};

/** The outline for each familiar die, plus a fallback for anything unusual. */
function silhouette(faces: number): { points?: string; rounded?: boolean; facets?: string[] } {
  switch (faces) {
    case 4:
      return { points: "50,10 93,84 7,84", facets: ["50,10 50,84", "50,10 7,84", "50,10 93,84"] };
    case 6:
      return { rounded: true };
    case 8:
      return { points: "50,6 92,50 50,94 8,50", facets: ["8,50 92,50", "50,6 50,94"] };
    case 10:
      // A kite, not a pentagon. A pentagonal trapezohedron reads as a tall
      // four-cornered shape with a zigzag equator, and drawing it as a pentagon
      // makes it indistinguishable from a d12 at a glance -- which defeats the
      // point of drawing real dice at all.
      return {
        points: "50,3 92,36 50,97 8,36",
        facets: ["8,36 29,50 50,36 71,50 92,36", "29,50 50,97 71,50", "50,3 50,36"],
      };
    case 12:
      return {
        points: "50,5 94,37 77,90 23,90 6,37",
        facets: ["50,28 74,45 65,73 35,73 26,45"],
      };
    case 20:
      return {
        points: "50,4 91,27 91,73 50,96 9,73 9,27",
        facets: ["50,26 74,66 26,66", "50,4 50,26", "9,27 26,66", "91,27 74,66"],
      };
    default:
      return { rounded: true };
  }
}

export function Die({ faces, display, rolling, settleDelay = 0, variant, label }: DieProps) {
  const shape = silhouette(faces);
  const isPipped = faces === 6 && /^[1-6]$/.test(display);

  return (
    <figure
      className={`die ${rolling ? "tumbling" : "settled"} ${variant === "challenge" ? "challenge" : ""}`}
      style={{ animationDelay: `${settleDelay}ms` }}
      aria-label={`${label ?? `d${faces}`} showing ${display}`}
    >
      <svg viewBox="0 0 100 100" role="img" aria-hidden="true">
        {shape.rounded ? (
          <rect x="6" y="6" width="88" height="88" rx="16" className="body" />
        ) : (
          <polygon points={shape.points} className="body" />
        )}
        {shape.facets?.map((d, i) => (
          <polyline key={i} points={d} className="facet" />
        ))}

        {isPipped ? (
          PIPS[Number(display)]?.map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="8" className="pip" />
          ))
        ) : (
          <text
            x="50"
            /* d4 reads from the base of the triangle, everything else centers. */
            y={faces === 4 ? 70 : 50}
            className="value"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={display.length > 2 ? 32 : 40}
          >
            {display}
          </text>
        )}
      </svg>
      <figcaption>{label ?? `d${faces}`}</figcaption>
    </figure>
  );
}
