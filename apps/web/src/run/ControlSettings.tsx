import { useMemo, useRef, useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import { apiBase } from "../sync/config.ts";
import type { StoredRun } from "../storage/db.ts";
import { CATALOGS, catalogFor, opDef, rangeOfValue, type ArgDef, type ToolCatalog } from "../control/catalog.ts";
import { complaints, describes, entriesOf, EMPTY, isEmpty, parse, selectorOf, tablesOf, tagsOf, tidy, type ControlProfile, type ProfileOp, type ProfileRow } from "../control/profile.ts";

/**
 * What a tool attached to the game should do about what the dice say.
 *
 * The panel exists because the alternative is writing JSON by hand
 * against two vocabularies at once: a pack's tables and entries, and a
 * program's operation names. It knows both, so it can say which rule will
 * never fire and which argument will be refused before anybody plays an
 * hour to find out.
 *
 * Nothing here is required. A run with no rules sends nothing, which is
 * every run that existed before this panel did.
 */
export function ControlSettings({ pack, record, onControl }: { pack: Pack; record: StoredRun | null; onControl?: (control: unknown) => void | Promise<void> }) {
  const saved = (record?.control as ControlProfile | undefined) ?? undefined;
  const [profile, setProfile] = useState<ControlProfile>(saved && !isEmpty(saved) ? saved : EMPTY);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const file = useRef<HTMLInputElement | null>(null);

  const catalog = catalogFor(profile.tool);
  const tags = useMemo(() => tagsOf(pack), [pack]);
  const tables = useMemo(() => tablesOf(pack), [pack]);
  const said = useMemo(() => complaints(pack, profile), [pack, profile]);

  const update = (next: ControlProfile) => {
    setProfile(next);
    void onControl?.(isEmpty(next) ? undefined : next);
  };

  const setRow = (i: number, row: ProfileRow) => update({ ...profile, rows: (profile.rows ?? []).map((r, at) => (at === i ? row : r)) });
  const dropRow = (i: number) => update({ ...profile, rows: (profile.rows ?? []).filter((_, at) => at !== i) });
  const addRow = () => update({ ...profile, rows: [...(profile.rows ?? []), { tag: tags[0] ?? "", ops: [] }] });

  /** The address the tool dials, with the key left for its owner to paste. */
  const address = (() => {
    const b = (apiBase() ?? "/api").replace(/\/$/, "");
    const origin = /^https?:/.test(b) ? new URL(b).origin : typeof location !== "undefined" ? location.origin : "";
    return `${origin.replace(/^http/, "ws")}/ws?k=REPLACE-WITH-YOUR-WATCH-KEY&as=control`;
  })();

  const exportFile = () => {
    const text = JSON.stringify(tidy(profile), null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pack.id}.control.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (chosen: File | undefined) => {
    if (!chosen) return;
    const read = parse(await chosen.text());
    if (!read) {
      setNote("That file is not a profile.");
      return;
    }

    update(read);
    setNote(`Loaded ${(read.rows ?? []).length} rule${(read.rows ?? []).length === 1 ? "" : "s"}.`);
  };

  return (
    <>
      <h4 className="stepLabel">Control</h4>
      <p className="muted small">
        Make what the dice say happen in the game, through a tool on the machine playing it. Off unless there are rules here; a {pack.vocabulary.run.one.toLowerCase()} with none
        plays exactly as it always has.
      </p>

      <label className="toggle">
        <span>The tool</span>
        <select className="chipAdd" value={profile.tool ?? ""} onChange={(e) => update({ ...profile, tool: e.target.value || undefined })} aria-label="Which tool this is written for">
          <option value="">Anything listening</option>
          {CATALOGS.map((c) => (
            <option key={c.tool} value={c.tool}>
              {c.label} · {c.game}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        {catalog
          ? `Anything else that connects is sent nothing and told why. Written against ${catalog.against}; a tool that reports more than this list knows is fine, and what it reports wins.`
          : "A profile naming no tool is for whatever connects, which is right for a script of your own and wrong for anything shared."}
      </p>

      <div className="askKey">
        <p className="muted small">The address the tool dials. Your watch key goes where it says so; make one under Chat, above.</p>
        <code className="askAddress">{address}</code>
        <div className="padRow">
          <button
            className="ghost tiny"
            onClick={() => {
              void navigator.clipboard?.writeText(address);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <span className="muted small">Add &amp;seat=Name where more than one person is playing.</span>
        </div>
      </div>

      <h4 className="stepLabel">The {pack.vocabulary.run.one.toLowerCase()}&apos;s terms</h4>
      <p className="muted small">Applied when a tool attaches and held until the {pack.vocabulary.run.one.toLowerCase()} ends. The settings that would otherwise be a paragraph nobody reads.</p>
      <Ops catalog={catalog} ops={profile.setup ?? []} onChange={(setup) => update({ ...profile, setup })} />

      <h4 className="stepLabel">Rules</h4>
      {(profile.rows ?? []).length === 0 && <p className="muted small">None. Nothing is sent.</p>}
      {(profile.rows ?? []).map((row, i) => (
        <div className="askKey" key={i}>
          <div className="padRow">
            <select
              className="chipAdd"
              value={selectorOf(row)}
              aria-label="What this rule matches"
              onChange={(e) => {
                const kind = e.target.value;
                const bare: ProfileRow = { ops: row.ops, ...(row.label ? { label: row.label } : {}), ...(row.to ? { to: row.to } : {}), ...(row.for ? { for: row.for } : {}), ...(row.until ? { until: row.until } : {}) };
                if (kind === "tag") setRow(i, { ...bare, tag: tags[0] ?? "" });
                else if (kind === "table") setRow(i, { ...bare, table: tables[0]?.id ?? "" });
                else setRow(i, { ...bare, table: tables[0]?.id ?? "", entry: entriesOf(pack, tables[0]?.id)[0]?.id ?? "" });
              }}
            >
              <option value="entry">One result</option>
              <option value="tag">Anything tagged</option>
              <option value="table">Anything from a table</option>
            </select>

            {row.tag !== undefined && (
              <select className="chipAdd" value={row.tag} aria-label="Which tag" onChange={(e) => setRow(i, { ...row, tag: e.target.value })}>
                {tags.length === 0 && <option value="">this pack tags nothing</option>}
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}

            {row.tag === undefined && (
              <select
                className="chipAdd"
                value={row.table ?? ""}
                aria-label="Which table"
                onChange={(e) => setRow(i, { ...row, table: e.target.value, ...(row.entry !== undefined ? { entry: entriesOf(pack, e.target.value)[0]?.id ?? "" } : {}) })}
              >
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}

            {row.entry !== undefined && (
              <select className="chipAdd" value={row.entry} aria-label="Which result" onChange={(e) => setRow(i, { ...row, entry: e.target.value })}>
                {entriesOf(pack, row.table).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.text.length > 60 ? `${e.text.slice(0, 60)}…` : e.text}
                  </option>
                ))}
              </select>
            )}

            <button className="ghost tiny" onClick={() => dropRow(i)} aria-label="Remove this rule">
              Remove
            </button>
          </div>

          <p className="muted small">{describes(pack, row)}</p>

          <div className="padRow">
            <select
              className="chipAdd"
              aria-label="How long it lasts"
              value={row.for !== undefined ? "seconds" : row.until === "unit" ? "unit" : "held"}
              onChange={(e) => {
                const how = e.target.value;
                const bare = { ...row };
                delete bare.for;
                delete bare.until;
                if (how === "seconds") setRow(i, { ...bare, for: 60 });
                else if (how === "unit") setRow(i, { ...bare, until: "unit" });
                else setRow(i, bare);
              }}
            >
              <option value="held">Until the {pack.vocabulary.run.one.toLowerCase()} ends</option>
              <option value="unit">Until this {pack.vocabulary.unit.one.toLowerCase()} closes</option>
              <option value="seconds">For a while</option>
            </select>
            {row.for !== undefined && (
              <>
                <input type="number" min={1} max={3600} value={row.for} aria-label="Seconds" onChange={(e) => setRow(i, { ...row, for: Number(e.target.value) })} style={{ width: "5rem" }} />
                <span className="muted small">seconds</span>
              </>
            )}
            <input
              type="text"
              value={row.to ?? ""}
              placeholder="everyone"
              aria-label="Who it reaches"
              onChange={(e) => setRow(i, { ...row, to: e.target.value || undefined })}
              style={{ width: "8rem" }}
            />
            <input type="text" value={row.label ?? ""} placeholder="what to call it" aria-label="What to call it" onChange={(e) => setRow(i, { ...row, label: e.target.value || undefined })} />
          </div>

          <Ops catalog={catalog} ops={row.ops} onChange={(ops) => setRow(i, { ...row, ops })} />
        </div>
      ))}

      <div className="padRow">
        <button className="ghost tiny" onClick={addRow}>
          Add a rule
        </button>
        <button className="ghost tiny" onClick={exportFile} disabled={isEmpty(profile)}>
          Export
        </button>
        <button className="ghost tiny" onClick={() => file.current?.click()}>
          Import
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
      </div>

      {said.length > 0 && (
        <div className="askKey">
          <p className="muted small">What is wrong with it:</p>
          <ul className="muted small">
            {said.map((c, i) => (
              <li key={i}>
                <strong>{c.where}</strong> — {c.says}
              </li>
            ))}
          </ul>
        </div>
      )}
      {note && <p className="muted small">{note}</p>}
    </>
  );
}

/** A list of operations, which is what both the terms and a rule hold. */
function Ops({ catalog, ops, onChange }: { catalog: ToolCatalog | null; ops: ProfileOp[]; onChange: (ops: ProfileOp[]) => void }) {
  const set = (i: number, op: ProfileOp) => onChange(ops.map((o, at) => (at === i ? op : o)));
  const add = () => onChange([...ops, { op: catalog?.ops[0]?.op ?? "", args: {} }]);

  return (
    <>
      {ops.map((op, i) => {
        const def = opDef(catalog, op.op);
        return (
          <div className="padRow" key={i}>
            <select
              className="chipAdd"
              value={op.op}
              aria-label="What to do"
              onChange={(e) => {
                // The arguments belong to the operation, so changing it
                // starts them again rather than carrying over something
                // that meant a different thing.
                set(i, { op: e.target.value, args: {} });
              }}
            >
              {!catalog && <option value={op.op}>{op.op}</option>}
              {(catalog?.ops ?? []).map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>

            {(def?.args ?? []).map((arg) => (
              <Arg key={arg.name} arg={arg} op={op} onChange={(value) => set(i, { ...op, args: { ...op.args, [arg.name]: value } })} />
            ))}

            <button className="ghost tiny" onClick={() => onChange(ops.filter((_, at) => at !== i))} aria-label="Remove this">
              ×
            </button>
          </div>
        );
      })}
      <div className="padRow">
        <button className="ghost tiny" onClick={add}>
          Add something to do
        </button>
        {ops.some((o) => opDef(catalog, o.op)?.oneWay) && <span className="muted small">One of these cannot be undone when the effect ends.</span>}
      </div>
    </>
  );
}

function Arg({ arg, op, onChange }: { arg: ArgDef; op: ProfileOp; onChange: (value: unknown) => void }) {
  const value = op.args[arg.name];

  if (arg.kind === "flag") {
    return (
      <label className="toggle" title={arg.note}>
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span>{arg.label}</span>
      </label>
    );
  }

  if (arg.kind === "choice") {
    return (
      <select className="chipAdd" value={String(value ?? "")} aria-label={arg.label} onChange={(e) => onChange(e.target.value)} title={arg.note}>
        <option value="">{arg.label}…</option>
        {(arg.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  // A number, where the range depends on which one is being set.
  const range = op.op === "value.set" && arg.name === "value" ? rangeOfValue(String(op.args["name"] ?? "")) : { least: arg.least, most: arg.most };
  return (
    <input
      type="number"
      value={value === undefined ? "" : String(value)}
      placeholder={arg.label}
      aria-label={arg.label}
      title={range && range.least !== undefined ? `${range.least} to ${range.most}` : arg.note}
      {...(range?.least !== undefined ? { min: range.least } : {})}
      {...(range?.most !== undefined ? { max: range.most } : {})}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      style={{ width: "7rem" }}
    />
  );
}
