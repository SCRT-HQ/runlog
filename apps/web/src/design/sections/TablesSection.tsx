import { useState } from "react";
import type { Diagnostic } from "@runlog/rules-schema";
import { describe } from "../describe.ts";
import { at, AreaField, NumberField, RowActions, SelectField, TextField } from "../fields.tsx";
import { coverage, coverageSummary } from "../draft.ts";
import { num, str, type SectionProps } from "./shared.ts";

/* ------------------------------------------------------------------ */

export function Tables({ draft, diagnostics, edit }: SectionProps) {
  const requirements = (Array.isArray(draft.requires) ? (draft.requires as Record<string, unknown>[]) : [])
    .map((r) => ({ id: str(r.id), label: str(r.label) }))
    .filter((r) => r.id);
  const tables = (draft.tables ?? {}) as Record<string, Record<string, unknown>>;
  const ids = Object.keys(tables);

  const addTable = () => {
    let id = "newTable";
    for (let n = 2; ids.includes(id); n++) id = `newTable${n}`;
    edit(["tables", id], {
      resolution: "lookup",
      title: "New table",
      roll: "d6",
      entries: [{ id: "e1", range: [1, 6], text: "Something happens." }],
    });
  };

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Tables <span className="muted">what the game rolls at you</span>
      </h3>
      {ids.length === 0 && <p className="muted small">No tables yet.</p>}
      {ids.map((id) => (
        <TableEditor
          requirements={requirements}
          key={id}
          id={id}
          table={tables[id]!}
          diagnostics={diagnostics}
          edit={edit}
          onRemove={() => {
            const next = { ...tables };
            delete next[id];
            edit(["tables"], next);
          }}
        />
      ))}
      <RowActions>
        <button className="ghost" onClick={addTable}>
          Add a table
        </button>
      </RowActions>
    </section>
  );
}

function TableEditor({
  id,
  table,
  diagnostics,
  edit,
  onRemove,
  requirements,
}: {
  id: string;
  table: Record<string, unknown>;
  diagnostics: Diagnostic[];
  edit: SectionProps["edit"];
  onRemove: () => void;
  /** The pack's requirements, so an entry can say which it needs. */
  requirements: Array<{ id: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const entries = Array.isArray(table.entries) ? (table.entries as Record<string, unknown>[]) : [];
  const isLookup = table.resolution === "lookup";
  const segments = isLookup ? coverage(str(table.roll), entries) : [];
  const summary = coverageSummary(segments);
  const mine = at(diagnostics, `tables.${id}`);

  return (
    <div className={`subEditor ${mine.some((d) => d.level === "error") ? "error" : ""}`}>
      <div className="row spread subEditorHead">
        <button className="disclose" onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"} <strong>{str(table.title) || id}</strong>
          <span className="muted small">
            {" "}
            · {str(table.resolution)} · {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
        </button>
        {isLookup && summary.text && <span className={`chip ${summary.ok ? "ok" : "warn"}`}>{summary.text}</span>}
      </div>

      {open && (
        <>
          <div className="fieldGrid">
            <TextField
              label="Title"
              path={`tables.${id}.title`}
              help={describe("tables.*.title")}
              diagnostics={diagnostics}
              value={str(table.title)}
              onChange={(v) => edit(["tables", id, "title"], v)}
            />
            <SelectField
              label="Resolution"
              path={`tables.${id}.resolution`}
              help={describe("tables.*.resolution")}
              diagnostics={diagnostics}
              value={str(table.resolution)}
              onChange={(v) => edit(["tables", id, "resolution"], v)}
              options={[
                { value: "lookup", label: "lookup - a range per entry" },
                { value: "bands", label: "bands - outcome tiers" },
                { value: "opposed", label: "opposed - your dice against the game's" },
                { value: "keyed", label: "keyed - by name" },
              ]}
            />
            {isLookup && (
              <TextField
                label="Roll"
                path={`tables.${id}.roll`}
                mono
                help={describe("tables.*.roll")}
                diagnostics={diagnostics}
                value={str(table.roll)}
                onChange={(v) => edit(["tables", id, "roll"], v)}
              />
            )}
          </div>

          {isLookup && <CoverageBar segments={segments} />}

          {entries.map((entry, i) => (
            <div key={i} className="entryEditor">
              <div className="fieldGrid tight">
                <TextField
                  label="Id"
                  path={`tables.${id}.entries[${i}].id`}
                  mono
                  diagnostics={diagnostics}
                  value={str(entry.id)}
                  onChange={(v) => edit(["tables", id, "entries", i, "id"], v)}
                />
                {isLookup && (
                  <>
                    <NumberField
                      label="From"
                      path={`tables.${id}.entries[${i}].range`}
                      diagnostics={diagnostics}
                      value={num((entry.range as number[] | undefined)?.[0], 1)}
                      onChange={(v) => edit(["tables", id, "entries", i, "range"], [v, num((entry.range as number[] | undefined)?.[1], v)])}
                    />
                    <NumberField
                      label="To"
                      path={`tables.${id}.entries[${i}].rangeTo`}
                      diagnostics={diagnostics}
                      value={num((entry.range as number[] | undefined)?.[1], 1)}
                      onChange={(v) => edit(["tables", id, "entries", i, "range"], [num((entry.range as number[] | undefined)?.[0], v), v])}
                    />
                  </>
                )}
              </div>
              <AreaField
                label="What it says"
                path={`tables.${id}.entries[${i}].text`}
                rows={2}
                help={i === 0 ? describe("tables.*.entries[].text") : undefined}
                diagnostics={diagnostics}
                value={str(entry.text)}
                onChange={(v) => edit(["tables", id, "entries", i, "text"], v)}
              />
              <div className="fieldGrid tight">
                <NumberField
                  label="Points"
                  path={`tables.${id}.entries[${i}].points`}
                  help={i === 0 ? describe("tables.*.entries[].points") : undefined}
                  diagnostics={diagnostics}
                  value={num(entry.points, 0)}
                  onChange={(v) => edit(["tables", id, "entries", i, "points"], v > 0 ? v : undefined)}
                />
                {requirements.length > 0 && (
                  <div className="field">
                    <span className="fieldLabel">Needs</span>
                    <div className="chipRow">
                      {requirements.map((r) => {
                        const needs = Array.isArray(entry.needs) ? (entry.needs as string[]) : [];
                        const on = needs.includes(r.id);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            className={`chip toggleChip ${on ? "on" : ""}`}
                            aria-pressed={on}
                            onClick={() => {
                              const next = on ? needs.filter((n) => n !== r.id) : [...needs, r.id];
                              edit(["tables", id, "entries", i, "needs"], next.length > 0 ? next : undefined);
                            }}
                          >
                            {r.label || r.id}
                          </button>
                        );
                      })}
                    </div>
                    {i === 0 && <span className="fieldHelp">{describe("tables.*.entries[].needs")}</span>}
                  </div>
                )}
              </div>
              <RowActions>
                <button
                  className="ghost tiny"
                  onClick={() =>
                    edit(
                      ["tables", id, "entries"],
                      entries.filter((_, j) => j !== i),
                    )
                  }
                >
                  remove
                </button>
              </RowActions>
            </div>
          ))}

          <RowActions>
            <button
              className="ghost"
              onClick={() => {
                const last = entries.at(-1);
                const previousTo = num((last?.range as number[] | undefined)?.[1], 0);
                edit(
                  ["tables", id, "entries"],
                  [
                    ...entries,
                    {
                      id: `e${entries.length + 1}`,
                      // Starts where the last one stopped: the common case is a
                      // table filled in order, and guessing right saves the two
                      // numbers everyone gets wrong.
                      range: [previousTo + 1, previousTo + 1],
                      text: "",
                    },
                  ],
                );
              }}
            >
              Add an entry
            </button>
            <button className="ghost tiny" onClick={onRemove}>
              delete this table
            </button>
          </RowActions>
        </>
      )}
    </div>
  );
}

/**
 * Where the ranges land, drawn to scale.
 *
 * The linter reports gaps and overlaps once you save. Seeing them while the
 * numbers are still in your head is worth more, because that is when the fix
 * is obvious.
 */
function CoverageBar({ segments }: { segments: ReturnType<typeof coverage> }) {
  const total = segments.reduce((n, s) => n + (s.to - s.from + 1), 0);
  if (total === 0) return null;

  return (
    <div className="coverage" aria-label="Range coverage">
      {segments.map((s, i) => {
        const width = ((s.to - s.from + 1) / total) * 100;
        const kind = s.claims === 0 ? "gap" : s.claims > 1 ? "over" : "ok";
        const span = s.from === s.to ? `${s.from}` : `${s.from}-${s.to}`;
        return (
          <span
            key={i}
            className={`coverageSeg ${kind}`}
            style={{ width: `${width}%` }}
            title={
              s.claims === 0
                ? `${span}: nothing covers this`
                : s.claims > 1
                  ? `${span}: claimed by ${s.entries.join(", ")}`
                  : `${span}: ${s.entries[0]}`
            }
          />
        );
      })}
    </div>
  );
}
