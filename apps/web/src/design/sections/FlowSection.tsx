import { at, CheckField, RowActions, SelectField, TextField } from "../fields.tsx";
import { str, type SectionProps } from "./shared.ts";

/* ------------------------------------------------------------------ */

export function Phases({ draft, diagnostics, edit }: SectionProps) {
  const phases = Array.isArray(draft.phases) ? (draft.phases as Record<string, unknown>[]) : [];
  const tableIds = Object.keys((draft.tables ?? {}) as Record<string, unknown>);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= phases.length) return;
    const next = [...phases];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    edit(["phases"], next);
  };

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        The flow <span className="muted">what happens in a turn, in order</span>
      </h3>
      {at(diagnostics, "phases").map((d, i) => (
        <div key={i} className="notice">
          {d.message}
        </div>
      ))}

      {phases.map((phase, i) => {
        const steps = Array.isArray(phase.steps) ? (phase.steps as Record<string, unknown>[]) : [];
        return (
          <div key={i} className="subEditor">
            <div className="fieldGrid">
              <TextField
                label="Label"
                path={`phases[${i}].label`}
                diagnostics={diagnostics}
                value={str(phase.label)}
                onChange={(v) => edit(["phases", i, "label"], v)}
              />
              <TextField
                label="Id"
                path={`phases[${i}].id`}
                mono
                diagnostics={diagnostics}
                value={str(phase.id)}
                onChange={(v) => edit(["phases", i, "id"], v)}
              />
            </div>

            {steps.map((step, j) => (
              <div key={j} className="fieldGrid tight">
                <SelectField
                  label="Step"
                  path={`phases[${i}].steps[${j}].kind`}
                  diagnostics={diagnostics}
                  value={str(step.kind)}
                  onChange={(v) => edit(["phases", i, "steps", j, "kind"], v)}
                  options={[
                    { value: "rollTable", label: "roll on a table" },
                    { value: "declareSubject", label: "name what you are making" },
                    { value: "manual", label: "do the work" },
                    { value: "actions", label: "run actions" },
                    { value: "finalizeUnit", label: "close the turn" },
                  ]}
                />
                <TextField
                  label="Label"
                  path={`phases[${i}].steps[${j}].label`}
                  diagnostics={diagnostics}
                  value={str(step.label)}
                  onChange={(v) => edit(["phases", i, "steps", j, "label"], v)}
                />
                {step.kind === "manual" && (
                  <CheckField
                    label="Closes the unit"
                    help="Finishing this step closes the unit too: its checklist is the honor check, and its Done offers the next unit or finishing the run. A flow with such a step needs no closing step of its own."
                    value={step.closesUnit === true}
                    onChange={(v) => edit(["phases", i, "steps", j, "closesUnit"], v ? true : undefined)}
                  />
                )}
                {step.kind === "rollTable" && (
                  <SelectField
                    label="Table"
                    path={`phases[${i}].steps[${j}].table`}
                    diagnostics={diagnostics}
                    value={str(step.table)}
                    onChange={(v) => edit(["phases", i, "steps", j, "table"], v)}
                    options={tableIds.map((t) => ({ value: t, label: t }))}
                  />
                )}
              </div>
            ))}

            <RowActions>
              <button className="ghost tiny" onClick={() => edit(["phases", i, "steps"], [...steps, { kind: "manual", label: "Do it." }])}>
                add a step
              </button>
              <button className="ghost tiny" onClick={() => move(i, i - 1)} disabled={i === 0}>
                ↑
              </button>
              <button className="ghost tiny" onClick={() => move(i, i + 1)} disabled={i === phases.length - 1}>
                ↓
              </button>
              <button
                className="ghost tiny"
                onClick={() =>
                  edit(
                    ["phases"],
                    phases.filter((_, k) => k !== i),
                  )
                }
              >
                remove
              </button>
            </RowActions>
          </div>
        );
      })}

      <RowActions>
        <button
          className="ghost"
          onClick={() => edit(["phases"], [...phases, { id: `phase${phases.length + 1}`, label: "New phase", steps: [] }])}
        >
          Add a phase
        </button>
      </RowActions>
    </section>
  );
}
