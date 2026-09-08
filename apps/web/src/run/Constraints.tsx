/**
 * The rules already drawn this unit, in front of the player while they work.
 *
 * `constraintsFor` — what to say — lives in the engine's flow.ts, since the
 * live view and its widgets need it with no page around them at all. This is
 * only how it is shown, and the page's step cards and the floating remote
 * share this one component so the two cannot render it differently.
 */
export function Constraints({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="notice constraints">
      <span className="muted small">The game has already had its say</span>
      <ul>
        {lines.map((line, i) => (
          <li key={i}>
            <strong>{line}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
