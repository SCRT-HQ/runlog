import { Pick } from "../ui/Pick.tsx";

export interface EndingOption {
  id: string;
  label: string;
  text?: string;
}

/**
 * How the run can end, one pressed at a time. The chosen one is ringed and
 * pressed; the End button beside it appears once any is. The remote draws
 * the same set as small ghosts with the label alone.
 */
export function EndingChoices({
  endings,
  chosen,
  onChoose,
  compact = false,
}: {
  endings: readonly EndingOption[];
  chosen: string | null;
  onChoose: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "pipChoices" : "choices"} role="group" aria-label="Endings">
      {endings.map((e) => (
        <Pick key={e.id} kind="one" on={chosen === e.id} className={compact ? "ghost small" : "choice"} onClick={() => onChoose(e.id)}>
          {compact ? (
            e.label
          ) : (
            <>
              <strong>{e.label}</strong>
              <span className="muted small">{e.text}</span>
            </>
          )}
        </Pick>
      ))}
    </div>
  );
}
