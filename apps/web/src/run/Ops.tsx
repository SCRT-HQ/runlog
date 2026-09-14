import { useId, useMemo } from "react";
import { opDef, rangeOfValue, type ArgDef, type ToolCatalog } from "../control/catalog.ts";
import { areasFor, known, type Lists } from "../control/lists.ts";
import type { ProfileOp } from "../control/profile.ts";

/**
 * The editor for a list of operations.
 *
 * It was written inside the settings dialog, because the terms were the
 * only list anybody edited. They are not any more: a run's terms are now
 * seeded from the setups chosen where the run is started, and edited
 * there, before the run exists to have a settings dialog at all.
 *
 * So it lives here, imported by both. Nothing about it changed in the
 * move.
 */

/** A list of operations, which is what both the terms and a rule hold. */
export function Ops({
  catalog,
  lists,
  ops,
  onChange,
}: {
  catalog: ToolCatalog | null;
  lists: Lists;
  ops: ProfileOp[];
  onChange: (ops: ProfileOp[]) => void;
}) {
  const set = (i: number, op: ProfileOp) => onChange(ops.map((o, at) => (at === i ? op : o)));
  const add = () => onChange([...ops, { op: catalog?.ops[0]?.op ?? "", args: {} }]);

  return (
    <>
      {ops.map((op, i) => {
        const def = opDef(catalog, op.op);
        return (
          <div className="padRow opRow" key={i}>
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
              <Arg
                key={arg.name}
                arg={arg}
                op={op}
                lists={lists}
                onChange={(value) => set(i, { ...op, args: { ...op.args, [arg.name]: value } })}
              />
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
        {ops.some((o) => opDef(catalog, o.op)?.oneWay) && (
          <span className="muted small">One of these cannot be undone when the effect ends.</span>
        )}
      </div>
    </>
  );
}

function Arg({ arg, op, lists, onChange }: { arg: ArgDef; op: ProfileOp; lists: Lists; onChange: (value: unknown) => void }) {
  const value = op.args[arg.name];
  // The areas offered depend on the name beside them, so this list is
  // this field's own rather than one of the sheet's shared ones.
  const listId = useId();

  if (arg.kind === "flag") {
    return (
      <label className="toggle" title={arg.note}>
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span>{arg.label}</span>
      </label>
    );
  }

  /**
   * A name out of one of the tool's lists.
   *
   * Typed rather than chosen, because a select with nine hundred
   * options is not a thing anybody scrolls, and a browser's own
   * suggestion list narrows as you type. What the field adds over a
   * plain box is that it says, while you are still in it, whether what
   * you typed is a name the tool will find.
   */
  if (arg.kind === "name") {
    const typed = typeof value === "string" ? value : "";
    const fits = known(lists, arg.list, typed);
    return (
      <input
        type="text"
        value={typed}
        list={arg.list ? `controlNames-${arg.list}` : undefined}
        placeholder={arg.label}
        aria-label={arg.label}
        aria-invalid={fits === false}
        className={fits === false ? "wrongName" : undefined}
        title={fits === false ? `Nothing the tool knows is called that` : arg.note}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      />
    );
  }

  /**
   * The area, which is only ever asked because two places share a name.
   *
   * So it is asked in terms of the name already chosen: one place, and
   * the field says there is nothing to answer; two, and it offers
   * exactly those two rather than every region in the game. An empty
   * name has not narrowed anything yet, and gets all of them.
   */
  if (arg.kind === "area") {
    const areas = areasFor(lists, arg.list, op.args["name"]);
    const settled = areas.length === 1 && typeof op.args["name"] === "string" && op.args["name"].trim().length > 0;
    const typed = typeof value === "string" ? value : "";
    return (
      <>
        <input
          type="text"
          value={typed}
          list={areas.length > 1 ? listId : undefined}
          placeholder={settled ? areas[0] : arg.label}
          aria-label={arg.label}
          disabled={settled}
          title={settled ? `Only one place is called that, so there is nothing to tell apart` : arg.note}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
          style={{ width: "9rem" }}
        />
        {areas.length > 1 && (
          <datalist id={listId}>
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        )}
      </>
    );
  }

  if (arg.kind === "choice") {
    return (
      <select
        className="chipAdd"
        value={String(value ?? "")}
        aria-label={arg.label}
        onChange={(e) => onChange(e.target.value)}
        title={arg.note}
      >
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
  const range =
    op.op === "value.set" && arg.name === "value" ? rangeOfValue(String(op.args["name"] ?? "")) : { least: arg.least, most: arg.most };
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
