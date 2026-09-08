import type { Table } from "@runlog/rules-schema";
import type { TableLine } from "./tableLook.ts";

/**
 * The table's lines, opened beside a roll's pad. A line pressed puts its
 * number on the pad; nothing here answers on its own. Shared by the request
 * panel and the floating remote, both of which build `lines` from
 * `tableLines` in tableLook.ts.
 */
export function TableLookList({
  table,
  lines,
  landing,
  disabled,
  onPick,
}: {
  table: Table;
  lines: TableLine[];
  /** The line the pad's current number would land on, if any. */
  landing: string | null;
  disabled?: boolean;
  onPick: (value: number) => void;
}) {
  if (lines.length === 0) return null;
  return (
    <ol className="tableLook" aria-label={`${table.title}: what the roll can land on`}>
      {lines.map((line) => (
        <li key={line.id} className={landing === line.id ? "on" : ""}>
          <button type="button" className="tableLine" disabled={disabled} onClick={() => onPick(line.value)} title={`Put ${line.value} on the pad`}>
            <span className="range">{line.range}</span>
            <span className="text">{line.title}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
