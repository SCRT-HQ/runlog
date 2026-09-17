import type { Diagnostic } from "@runlog/rules-schema";
import { describe } from "../describe.ts";
import { AreaField, CheckField, NumberField, RowActions, SelectField, TextField } from "../fields.tsx";
import { num, str, type SectionProps } from "./shared.ts";

/* ------------------------------------------------------------------ */

export function ModesSection({ draft, diagnostics, edit }: SectionProps) {
  const modes = (draft.modes ?? {}) as Record<string, Record<string, unknown>>;
  const ids = Object.keys(modes);

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Ways to play <span className="muted">deltas over the base rules, not separate games</span>
      </h3>
      {ids.map((id) => (
        <div key={id} className="subEditor">
          <div className="fieldGrid">
            <TextField
              label="Label"
              path={`modes.${id}.label`}
              diagnostics={diagnostics}
              value={str(modes[id]!.label)}
              onChange={(v) => edit(["modes", id, "label"], v)}
            />
            <TextField
              label="Id"
              path={`modes.${id}`}
              mono
              diagnostics={diagnostics}
              value={id}
              onChange={(v) => {
                if (!v || v === id) return;
                // Renaming a key means rebuilding the map; a mode is
                // referenced by `defaultMode`, which follows it.
                const next: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(modes)) next[key === id ? v : key] = value;
                edit(["modes"], next);
                if (draft.defaultMode === id) edit(["defaultMode"], v);
              }}
            />
          </div>
          <AreaField
            label="Description"
            path={`modes.${id}.description`}
            rows={2}
            diagnostics={diagnostics}
            value={str(modes[id]!.description)}
            onChange={(v) => edit(["modes", id, "description"], v)}
          />
          <ModeDetails draft={draft} id={id} mode={modes[id]!} diagnostics={diagnostics} edit={edit} />
          {ids.length > 1 && (
            <RowActions>
              <button
                className="ghost tiny"
                onClick={() => {
                  const next = { ...modes };
                  delete next[id];
                  edit(["modes"], next);
                  if (draft.defaultMode === id) edit(["defaultMode"], Object.keys(next)[0]);
                }}
              >
                remove
              </button>
            </RowActions>
          )}
        </div>
      ))}

      <SelectField
        label="Offered first"
        path="defaultMode"
        help={describe("defaultMode")}
        diagnostics={diagnostics}
        value={str(draft.defaultMode)}
        onChange={(v) => edit(["defaultMode"], v)}
        options={ids.map((id) => ({ value: id, label: str(modes[id]!.label) || id }))}
      />

      <RowActions>
        <button
          className="ghost"
          onClick={() => {
            let id = "variant";
            for (let n = 2; ids.includes(id); n++) id = `variant${n}`;
            edit(["modes", id], { label: "New mode", description: "" });
          }}
        >
          Add a mode
        </button>
      </RowActions>
    </section>
  );
}

/**
 * The roles the seats take: the thrower and the caller, the cook and the
 * taster. One player holds each per unit, and they pass around the table
 * or stay put as the mode says above. Optional: seats without roles are
 * just seats.
 */
function Roles({
  id,
  base,
  players,
  diagnostics,
  edit,
}: {
  id: string;
  base: (string | number)[];
  players: Record<string, unknown>;
  diagnostics: Diagnostic[];
  edit: SectionProps["edit"];
}) {
  const roles = Array.isArray(players.roles) ? (players.roles as Record<string, unknown>[]) : [];
  const path = [...base, "players", "roles"];
  return (
    <div className="rolesEditor">
      <h5 className="stepLabel">Roles</h5>
      <p className="fieldHelp">{describe("modes.*.players.roles")}</p>
      {roles.map((r, i) => (
        <div key={i} className="entryEditor">
          <div className="fieldGrid tight">
            <TextField
              label="Id"
              path={`modes.${id}.players.roles[${i}].id`}
              mono
              diagnostics={diagnostics}
              value={str(r.id)}
              onChange={(v) => edit([...path, i, "id"], v)}
            />
            <TextField
              label="Name"
              path={`modes.${id}.players.roles[${i}].label`}
              help={i === 0 ? describe("modes.*.players.roles[].label") : undefined}
              diagnostics={diagnostics}
              value={str(r.label)}
              onChange={(v) => edit([...path, i, "label"], v)}
            />
          </div>
          <TextField
            label="What it does"
            path={`modes.${id}.players.roles[${i}].description`}
            help={i === 0 ? describe("modes.*.players.roles[].description") : undefined}
            diagnostics={diagnostics}
            value={str(r.description)}
            onChange={(v) => edit([...path, i, "description"], v || undefined)}
          />
          <RowActions>
            <button className="ghost tiny" onClick={() => edit(path, roles.length > 1 ? roles.filter((_, j) => j !== i) : undefined)}>
              remove
            </button>
          </RowActions>
        </div>
      ))}
      <RowActions>
        <button className="ghost" onClick={() => edit(path, [...roles, { id: `role-${roles.length + 1}`, label: "" }])}>
          + add a role
        </button>
      </RowActions>
    </div>
  );
}

/**
 * What a mode changes about the base rules: its length, its seed, who sits
 * at the table, its clock, whether it is moderated, and what it leaves out.
 * Every field maps to one key under `modes.<id>`, and a thing switched off
 * is removed from the draft rather than written as false, so the YAML stays
 * as short as the author would have written it.
 */
function ModeDetails({ draft, id, mode, diagnostics, edit }: SectionProps & { id: string; mode: Record<string, unknown> }) {
  const base = ["modes", id];
  const units = (mode.units ?? {}) as Record<string, unknown>;
  const shape =
    units.fixed !== undefined ? "fixed" : units.roll ? "roll" : units.min !== undefined || units.max !== undefined ? "range" : "open";
  const players = (mode.players ?? null) as Record<string, unknown> | null;
  const clock = (mode.clock ?? null) as Record<string, unknown> | null;
  const moderated = (mode.moderated ?? null) as Record<string, unknown> | null;
  const contestants = ((moderated?.contestants ?? {}) as Record<string, unknown>) ?? {};
  const disable = (mode.disable ?? {}) as Record<string, string[] | undefined>;
  const notes = (mode.notes ?? []) as string[];
  const keysOf = (key: string) => Object.keys((draft[key] ?? {}) as Record<string, unknown>);
  const phaseIds = ((draft.phases ?? []) as Array<{ id?: string }>).map((ph) => ph.id ?? "").filter(Boolean);

  const leaveOut = (kind: string, value: string) => {
    const list = disable[kind] ?? [];
    const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    const nextDisable: Record<string, string[] | undefined> = { ...disable, [kind]: next.length > 0 ? next : undefined };
    for (const k of Object.keys(nextDisable)) if (!nextDisable[k]?.length) delete nextDisable[k];
    edit([...base, "disable"], Object.keys(nextDisable).length > 0 ? nextDisable : undefined);
  };

  const groups: Array<{ kind: string; label: string; ids: string[] }> = [
    { kind: "tables", label: "Tables", ids: keysOf("tables") },
    { kind: "decks", label: "Decks", ids: keysOf("decks") },
    { kind: "counters", label: "Counters", ids: keysOf("counters") },
    { kind: "phases", label: "Phases", ids: phaseIds },
  ].filter((g) => g.ids.length > 0);

  return (
    <div className="modeDetails">
      <h5 className="stepLabel">Length and dice</h5>
      <div className="fieldGrid">
        <SelectField
          label="Length"
          path={`modes.${id}.units`}
          help={describe("modes.*.units")}
          diagnostics={diagnostics}
          value={shape}
          options={[
            { value: "open", label: "As many as the pack allows" },
            { value: "fixed", label: "A fixed number" },
            { value: "range", label: "Between two numbers" },
            { value: "roll", label: "Rolled at the start" },
          ]}
          onChange={(v) =>
            edit(
              [...base, "units"],
              v === "open" ? undefined : v === "fixed" ? { fixed: 5 } : v === "range" ? { min: 1, max: 12 } : { roll: "d6+2" },
            )
          }
        />
        {shape === "fixed" && (
          <NumberField
            label="Units"
            path={`modes.${id}.units.fixed`}
            diagnostics={diagnostics}
            value={num(units.fixed, 5)}
            onChange={(v) => edit([...base, "units"], { fixed: Math.max(1, v) })}
          />
        )}
        {shape === "range" && (
          <>
            <NumberField
              label="Fewest"
              path={`modes.${id}.units.min`}
              diagnostics={diagnostics}
              value={num(units.min, 1)}
              onChange={(v) => edit([...base, "units", "min"], Math.max(1, v))}
            />
            <NumberField
              label="Most"
              path={`modes.${id}.units.max`}
              diagnostics={diagnostics}
              value={num(units.max, 12)}
              onChange={(v) => edit([...base, "units", "max"], Math.max(1, v))}
            />
          </>
        )}
        {shape === "roll" && (
          <TextField
            label="Dice for the count"
            path={`modes.${id}.units.roll`}
            mono
            diagnostics={diagnostics}
            value={str(units.roll)}
            onChange={(v) => edit([...base, "units", "roll"], v)}
          />
        )}
        <CheckField
          label="Seeded"
          help={describe("modes.*.seeded")}
          value={mode.seeded === true}
          onChange={(v) => edit([...base, "seeded"], v ? true : undefined)}
        />
      </div>

      <h5 className="stepLabel">At the table</h5>
      <div className="fieldGrid">
        <NumberField
          label="Seats"
          path={`modes.${id}.players.max`}
          help={describe("modes.*.players")}
          diagnostics={diagnostics}
          value={num(players?.max, 1)}
          onChange={(v) => {
            const max = Math.max(1, v);
            if (max <= 1) edit([...base, "players"], undefined);
            else
              edit([...base, "players"], {
                min: Math.min(num(players?.min, 2), max),
                max,
                rotate: str(players?.rotate) || "clockwise",
                ...(players?.roles ? { roles: players.roles } : {}),
              });
          }}
        />
        {players && (
          <>
            <NumberField
              label="Fewest players"
              path={`modes.${id}.players.min`}
              diagnostics={diagnostics}
              value={num(players.min, 2)}
              onChange={(v) => edit([...base, "players", "min"], Math.max(1, Math.min(v, num(players.max, 2))))}
            />
            <SelectField
              label="Roles"
              path={`modes.${id}.players.rotate`}
              help={describe("modes.*.players.rotate")}
              diagnostics={diagnostics}
              value={str(players.rotate) || "none"}
              options={[
                { value: "clockwise", label: "Pass to the next seat each unit" },
                { value: "none", label: "Stay with the same seat" },
              ]}
              onChange={(v) => edit([...base, "players", "rotate"], v)}
            />
          </>
        )}
      </div>
      {players && <Roles id={id} base={base} players={players} diagnostics={diagnostics} edit={edit} />}
      <div className="fieldGrid">
        <CheckField
          label="Moderated"
          help={describe("modes.*.moderated")}
          value={moderated !== null}
          onChange={(v) => edit([...base, "moderated"], v ? { contestants: { min: 2, max: 10 }, award: "first" } : undefined)}
        />
        {moderated && (
          <>
            <NumberField
              label="Fewest contestants"
              path={`modes.${id}.moderated.contestants.min`}
              diagnostics={diagnostics}
              value={num(contestants.min, 2)}
              onChange={(v) => edit([...base, "moderated", "contestants", "min"], Math.max(1, v))}
            />
            <NumberField
              label="Most contestants"
              path={`modes.${id}.moderated.contestants.max`}
              diagnostics={diagnostics}
              value={num(contestants.max, 10)}
              onChange={(v) => edit([...base, "moderated", "contestants", "max"], Math.max(1, v))}
            />
            <SelectField
              label="Who scores"
              path={`modes.${id}.moderated.award`}
              help={describe("modes.*.moderated.award")}
              diagnostics={diagnostics}
              value={str(moderated.award) || "first"}
              options={[
                { value: "first", label: "The first to finish" },
                { value: "everyone", label: "Everyone who finishes" },
              ]}
              onChange={(v) => edit([...base, "moderated", "award"], v)}
            />
            {moderated.award === "everyone" && (
              <NumberField
                label="Bonus for first"
                path={`modes.${id}.moderated.firstBonus`}
                help={describe("modes.*.moderated.firstBonus")}
                diagnostics={diagnostics}
                value={num(moderated.firstBonus, 0)}
                onChange={(v) => edit([...base, "moderated", "firstBonus"], v > 0 ? v : undefined)}
              />
            )}
          </>
        )}
      </div>

      <h5 className="stepLabel">Clock</h5>
      <div className="fieldGrid">
        <SelectField
          label="Every unit runs"
          path={`modes.${id}.clock`}
          help={describe("modes.*.clock")}
          diagnostics={diagnostics}
          value={str(clock?.kind) || "none"}
          options={[
            { value: "none", label: "No clock of its own" },
            { value: "stopwatch", label: "A stopwatch" },
            { value: "timer", label: "A timer" },
          ]}
          onChange={(v) =>
            edit(
              [...base, "clock"],
              v === "none" ? undefined : v === "timer" ? { kind: "timer", minutes: num(clock?.minutes, 25) } : { kind: "stopwatch" },
            )
          }
        />
        {clock?.kind === "timer" && (
          <NumberField
            label="Minutes"
            path={`modes.${id}.clock.minutes`}
            diagnostics={diagnostics}
            value={num(clock.minutes, 25)}
            onChange={(v) => edit([...base, "clock", "minutes"], Math.max(1, v))}
          />
        )}
        {clock && (
          <>
            <TextField
              label="Called"
              path={`modes.${id}.clock.label`}
              help={describe("modes.*.clock.label")}
              diagnostics={diagnostics}
              value={str(clock.label)}
              onChange={(v) => edit([...base, "clock", "label"], v || undefined)}
            />
            <CheckField
              label="Starts with the unit"
              help={describe("modes.*.clock.auto")}
              value={clock.auto !== false}
              onChange={(v) => edit([...base, "clock", "auto"], v ? undefined : false)}
            />
          </>
        )}
      </div>

      {groups.length > 0 && (
        <>
          <h5 className="stepLabel">Leave out</h5>
          <p className="muted small">{describe("modes.*.disable")}</p>
          {groups.map((g) => (
            <div key={g.kind} className="leaveOut">
              <span className="muted small">{g.label}</span>
              <div className="options">
                {g.ids.map((x) => (
                  <button key={x} className={`chip pick ${disable[g.kind]?.includes(x) ? "on" : ""}`} onClick={() => leaveOut(g.kind, x)}>
                    {x}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      <AreaField
        label="Notes"
        path={`modes.${id}.notes`}
        help={`${describe("modes.*.notes") ?? ""} One per line.`}
        rows={2}
        diagnostics={diagnostics}
        value={notes.join("\n")}
        onChange={(v) => {
          const lines = v
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          edit([...base, "notes"], lines.length > 0 ? lines : undefined);
        }}
      />
    </div>
  );
}
