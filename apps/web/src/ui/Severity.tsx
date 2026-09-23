/**
 * How bad a problem is, said in more than its color.
 *
 * A list has room for the word, so it shows it. A note under a dense field
 * does not, so the word is kept for a screen reader and the glyph stands in
 * for it on the screen: ✕ for an error, ! for a warning.
 */
export type SeverityLevel = "error" | "warning";

const WORD: Record<SeverityLevel, string> = { error: "Error:", warning: "Warning:" };
const GLYPH: Record<SeverityLevel, string> = { error: "✕", warning: "!" };

export function SeverityGlyph({ level }: { level: SeverityLevel }) {
  return (
    <span className={`severityGlyph ${level}`} aria-hidden="true">
      {GLYPH[level]}
    </span>
  );
}

export function Severity({ level, show }: { level: SeverityLevel; show: "word" | "glyph" }) {
  // The space sits outside the span: a name is computed from each element's
  // trimmed text, so a space inside would be lost and the word would run
  // into the note after it.
  return (
    <>
      <span className={`severity ${level}`}>
        <SeverityGlyph level={level} />
        <span className={show === "word" ? "severityWord" : "visuallyHidden"}>{WORD[level]}</span>
      </span>{" "}
    </>
  );
}
