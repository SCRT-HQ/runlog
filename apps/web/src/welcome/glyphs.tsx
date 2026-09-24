/**
 * The marks on the example's controls: another example, and pausing the
 * turn from one example to the next.
 *
 * Drawn like the people panel's (run/glyphs.tsx): a 16 unit box, the
 * color of the text around them, hidden from screen readers because the
 * button holding each one carries its name.
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
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** An arc of most of a circle with its head at the top right: another one. */
export function RefreshGlyph() {
  return (
    <svg {...box}>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.52-3.68" {...line} />
      <path d="M12.2 1.8v2.9H9.3" {...line} />
    </svg>
  );
}

/** Two bars: pause. */
export function PauseGlyph() {
  return (
    <svg {...box}>
      <rect x={3.6} y={2.8} width={2.8} height={10.4} rx={0.8} fill="currentColor" />
      <rect x={9.6} y={2.8} width={2.8} height={10.4} rx={0.8} fill="currentColor" />
    </svg>
  );
}

/** A triangle pointing on: carry on turning. */
export function ResumeGlyph() {
  return (
    <svg {...box}>
      <path d="M4.6 2.9v10.2a.6.6 0 0 0 .9.5l8-5.1a.6.6 0 0 0 0-1L5.5 2.4a.6.6 0 0 0-.9.5z" fill="currentColor" />
    </svg>
  );
}
