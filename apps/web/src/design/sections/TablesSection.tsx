import { useEffect, useId, useState } from "react";
import type { Diagnostic } from "@runlog/rules-schema";
import { describe } from "../describe.ts";
import { help } from "../help.ts";
import { at, AreaField, fieldDomId, NumberField, RowActions, SelectField, TextField } from "../fields.tsx";
import { coverage, coverageSummary } from "../draft.ts";
import { num, str, type SectionProps } from "./shared.ts";

/* ------------------------------------------------------------------ */

export function TablesSection({ draft, diagnostics, edit, focus = null }: SectionProps & { focus?: string | null }) {
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
          focus={focus}
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
  focus,
}: {
  id: string;
  table: Record<string, unknown>;
  diagnostics: Diagnostic[];
  edit: SectionProps["edit"];
  onRemove: () => void;
  /** The pack's requirements, so an entry can say which it needs. */
  requirements: Array<{ id: string; label: string }>;
  /** A path the page is on its way to. A table holding it opens to show it. */
  focus: string | null;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (focus && (focus === `tables.${id}` || focus.startsWith(`tables.${id}.`))) setOpen(true);
  }, [focus, id]);
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
              schemaPath="tables.*.resolution"
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
                schemaPath="tables.*.roll"
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
                      schemaPath="tables.*.entries[].range"
                      diagnostics={diagnostics}
                      value={num((entry.range as number[] | undefined)?.[0], 1)}
                      onChange={(v) => edit(["tables", id, "entries", i, "range"], [v, num((entry.range as number[] | undefined)?.[1], v)])}
                    />
                    <NumberField
                      label="To"
                      path={`tables.${id}.entries[${i}].rangeTo`}
                      diagnosticPath={`tables.${id}.entries[${i}].range`}
                      schemaPath="tables.*.entries[].range"
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
                  schemaPath="tables.*.entries[].points"
                  help={i === 0 ? describe("tables.*.entries[].points") : undefined}
                  diagnostics={diagnostics}
                  value={num(entry.points, 0)}
                  onChange={(v) => edit(["tables", id, "entries", i, "points"], v > 0 ? v : undefined)}
                />
                <NeedsField tableId={id} entryIndex={i} entry={entry} requirements={requirements} diagnostics={diagnostics} edit={edit} />
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

function NeedsField({
  tableId,
  entryIndex,
  entry,
  requirements,
  diagnostics,
  edit,
}: {
  tableId: string;
  entryIndex: number;
  entry: Record<string, unknown>;
  requirements: Array<{ id: string; label: string }>;
  diagnostics: Diagnostic[];
  edit: SectionProps["edit"];
}) {
  const instanceId = useId();
  const needs = Array.isArray(entry.needs) ? (entry.needs as string[]) : [];
  if (requirements.length === 0 && needs.length === 0) return null;

  const path = `tables.${tableId}.entries[${entryIndex}].needs`;
  const mine = at(diagnostics, path);
  const hasError = mine.some((diagnostic) => diagnostic.level === "error");
  const helpId = `${instanceId}-help`;
  const noteId = (index: number) => `${instanceId}-note-${index}`;
  const known = new Set(requirements.map((requirement) => requirement.id));
  const choices = [
    ...requirements.map((requirement) => ({ ...requirement, missing: false })),
    ...[...new Set(needs)].filter((need) => !known.has(need)).map((need) => ({ id: need, label: need, missing: true })),
  ];

  return (
    <fieldset
      className={`field entryNeeds ${hasError ? "error" : mine.length > 0 ? "warn" : ""}`}
      id={fieldDomId(path)}
      data-path={path}
      aria-describedby={[helpId, ...mine.map((_, index) => noteId(index))].join(" ")}
      aria-invalid={hasError ? true : undefined}
      tabIndex={-1}
    >
      <legend className="fieldLabel">Needs</legend>
      <div className="chipRow">
        {choices.map((choice) => {
          const on = needs.includes(choice.id);
          return (
            <button
              key={choice.id}
              type="button"
              className={`chip toggleChip ${on ? "on" : ""}`}
              aria-pressed={on}
              title={choice.missing ? "This requirement no longer exists. Press to remove it." : undefined}
              onClick={() => {
                const next = on ? needs.filter((need) => need !== choice.id) : [...needs, choice.id];
                edit(["tables", tableId, "entries", entryIndex, "needs"], next.length > 0 ? next : undefined);
              }}
            >
              {choice.label || choice.id}
            </button>
          );
        })}
      </div>
      <span className="fieldHelp" id={helpId}>
        {help("tables.*.entries[].needs")}
      </span>
      {mine.map((diagnostic, index) => (
        <span key={index} className={`fieldNote ${diagnostic.level}`} id={noteId(index)}>
          {diagnostic.message}
        </span>
      ))}
      <details className="fieldReference">
        <summary>Schema reference</summary>
        <p>{describe("tables.*.entries[].needs")}</p>
      </details>
    </fieldset>
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
