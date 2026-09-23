/** The phone's run-menu button. Something waiting in the sheet shows as a flag on it and in its name. */
export function RunMenuButton({ flagged, open, noun, onToggle }: { flagged: boolean; open: boolean; noun: string; onToggle: () => void }) {
  return (
    <button type="button" className={`runMenuBtn${flagged ? " flagged" : ""}`} aria-expanded={open} onClick={onToggle}>
      <span aria-hidden="true">···</span>
      {flagged && <span className="runMenuFlag" aria-hidden="true" />}
      <span className="visuallyHidden">
        This {noun}
        {flagged ? ", something to see" : ""}
      </span>
    </button>
  );
}
