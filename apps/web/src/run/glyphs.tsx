/**
 * The small marks the people panel draws.
 *
 * Inline SVG rather than a font or a package: there are five of them,
 * they are drawn once each, and the row they sit in has to stay one line
 * on a phone. Every one takes its color from the text around it, so the
 * lit and dim states are a class on the wrapper and nothing here.
 *
 * The svg is hidden from screen readers; what it means is said by the
 * title and label on the element holding it.
 */

const box = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  "aria-hidden": true,
  focusable: "false",
} as const;

const line = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** A Stream Deck: three keys across, two down. */
export function DeckGlyph() {
  return (
    <svg {...box}>
      {[3, 9].map((y) => [0, 6, 12].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width={4} height={4} rx={1} fill="currentColor" />))}
    </svg>
  );
}

/**
 * A plug, for a tool on somebody's game.
 *
 * Two prongs, a half-round body and a stem, spanning 1.2 to 14.8 down the
 * middle: close to the deck grid's weight beside it, rather than the full
 * height of the box, which read as the taller of the two.
 */
export function PlugGlyph() {
  return (
    <svg {...box}>
      <rect x={4.6} y={1.2} width={1.6} height={3.4} rx={0.8} fill="currentColor" />
      <rect x={9.8} y={1.2} width={1.6} height={3.4} rx={0.8} fill="currentColor" />
      <path d="M3.2 4.6h9.6v3.2a4.8 4.8 0 0 1-4.8 4.8 4.8 4.8 0 0 1-4.8-4.8z" fill="currentColor" />
      <rect x={7.2} y={12.1} width={1.6} height={2.7} rx={0.8} fill="currentColor" />
    </svg>
  );
}

/**
 * Two sheets, one over the other: copy.
 *
 * The front sheet is a whole rounded rect and the one behind it is an
 * open bracket that starts and ends on the front sheet's outline, so the
 * two read as one shape tucked behind another. Drawing the back sheet
 * whole and the front one open left the front's outline broken where the
 * back sheet did not reach.
 */
export function CopyGlyph() {
  return (
    <svg {...box}>
      <path d="M4.6 4.4V3.2a2 2 0 0 1 2-2h6.2a2 2 0 0 1 2 2v6.2a2 2 0 0 1-2 2h-2.2" {...line} />
      <rect x={1.2} y={4.4} width={9.4} height={10.4} rx={2} {...line} />
    </svg>
  );
}

/** A check, for the moment after a copy. */
export function CheckGlyph() {
  return (
    <svg {...box}>
      <path d="M2.5 8.6 6.2 12.4 13.5 3.8" {...line} />
    </svg>
  );
}

/** An x, for taking somebody off the run. */
export function XGlyph() {
  return (
    <svg {...box}>
      <path d="M3.6 3.6 12.4 12.4M12.4 3.6 3.6 12.4" {...line} />
    </svg>
  );
}
