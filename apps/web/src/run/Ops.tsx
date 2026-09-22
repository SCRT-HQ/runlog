import { useId, useMemo } from "react";
import { opDef, rangeOfValue, type ArgDef, type ToolCatalog } from "../control/catalog.ts";
import { areasFor, known, type Lists } from "../control/lists.ts";
import type { ProfileOp } from "../control/profile.ts";
import { tensionLine, tensionsIn } from "./repeats.ts";

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
  addLabel,
  listsId,
}: {
  catalog: ToolCatalog | null;
  lists: Lists;
  ops: ProfileOp[];
  onChange: (ops: ProfileOp[]) => void;
  /**
   * What the button that adds a row says. The same editor holds three
   * different lists, and "add something to do" is only the right words
   * for the two that are a rule's consequences; on the page where a run
   * starts, the list is what you begin holding.
   */
  addLabel?: string;
  /**
   * The id under which somebody above already drew the tool's lists,
   * one `<Datalists>` for the whole page. Given, this editor draws none
   * of its own and its fields point up at those. Left out, it draws the
   * lists its own rows need, which is right for a page that holds one
   * editor and wrong for one that holds two hundred.
   */
  listsId?: string;
}) {
  const set = (i: number, op: ProfileOp) => onChange(ops.map((o, at) => (at === i ? op : o)));
  const add = () => onChange([...ops, { op: catalog?.ops[0]?.op ?? "", args: {} }]);

  /**
   * The lists these rows have a field for, so the editor carries those
   * options and not eighteen hundred of them.
   *
   * Rendered here rather than by whoever draws the editor. A `name`
   * field is a text box with `list` pointing at a `<datalist>` by id,
   * and an id pointing at nothing is not an error: the box simply
   * stops suggesting, silently, which is how this worked on the page
   * where a run starts while working in Settings. The component that
   * names the id is the one that should provide it.
   *
   * The id is this editor's own rather than a name shared across the
   * page, because a page may draw more than one of these. A fixed name
   * would put the same id on the document a dozen times and leave every
   * field but the first bound to somebody else's list.
   *
   * Settings draws one of these for the terms and one more for every
   * rule, and a shipped profile has two hundred rules. There the sheet
   * draws the lists once and hands the id down as `listsId`, since two
   * hundred copies of the tool's two and a half thousand names is not a
   * page anybody can wait for.
   */
  const own = useId();
  const listId = listsId ?? own;
  /**
   * What two lines are arguing about, where they are.
   *
   * Said rather than settled: the list is what was chosen and stays
   * that way, and a line nobody wants is a line with a button beside
   * it.
   */
  const tension = useMemo(() => tensionLine(tensionsIn(catalog, ops)), [catalog, ops]);
  const inUse = useMemo(() => listsInUse(catalog, ops), [catalog, ops]);

  return (
    <>
      {listsId === undefined && <Datalists id={listId} lists={lists} names={inUse} />}
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
                listId={listId}
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
          {addLabel ?? "Add something to do"}
        </button>
        {ops.some((o) => opDef(catalog, o.op)?.oneWay) && (
          <span className="muted small">One of these cannot be undone when the effect ends.</span>
        )}
      </div>
      {tension && <p className="notice">{tension}</p>}
    </>
  );
}

/** The lists these operations have a field for, in the order first met. */
export function listsInUse(catalog: ToolCatalog | null, ops: ProfileOp[]): string[] {
  const out = new Set<string>();
  for (const op of ops) for (const arg of opDef(catalog, op.op)?.args ?? []) if (arg.list) out.add(arg.list);
  return [...out];
}

/**
 * The tool's lists as `<datalist>`s, one per name, each at `id-name`.
 *
 * A name field points at one of these by id. A list that has not
 * arrived yet is drawn empty rather than left out, so the field's `list`
 * points at something the whole time and starts suggesting the moment
 * the names land.
 */
export function Datalists({ id, lists, names }: { id: string; lists: Lists; names: string[] }) {
  return (
    <>
      {names.map((list) => (
        <datalist id={`${id}-${list}`} key={list}>
          {(lists[list] ?? []).map((n) => (
            <option key={`${n.name}·${n.area ?? ""}`} value={n.name}>
              {n.area ?? (n.max !== undefined ? `to +${n.max}` : "")}
            </option>
          ))}
        </datalist>
      ))}
    </>
  );
}

function Arg({
  arg,
  op,
  lists,
  listId,
  onChange,
}: {
  arg: ArgDef;
  op: ProfileOp;
  lists: Lists;
  /** The editor's own id for its datalists; see `Ops`. */
  listId: string;
  onChange: (value: unknown) => void;
}) {
  const value = op.args[arg.name];
  // The areas offered depend on the name beside them, so this list is
  // this field's own rather than one of the sheet's shared ones.
  const areaListId = useId();

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
        list={arg.list ? `${listId}-${arg.list}` : undefined}
        placeholder={arg.label}
        aria-label={arg.label}
        aria-invalid={fits === false}
        className={`opName${fits === false ? " wrongName" : ""}`}
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
          list={areas.length > 1 ? areaListId : undefined}
          placeholder={settled ? areas[0] : arg.label}
          aria-label={arg.label}
          disabled={settled}
          title={settled ? `Only one place is called that, so there is nothing to tell apart` : arg.note}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
          style={{ width: "9rem" }}
        />
        {areas.length > 1 && (
          <datalist id={areaListId}>
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
  /*
   * Wide enough for the largest number it will hold, and no wider.
   *
   * Every one of these was seven rem, which is right for the rune
   * amount and absurd for a weapon's level: that one is nought to
   * twenty-five and can never be three characters. The width they were
   * all taking came out of the name beside them, which is the field
   * whose length actually varies.
   */
  const digits = Math.max(String(range?.most ?? 999999).replace("-", "").length, String(range?.least ?? 0).replace("-", "").length);
  return (
    <input
      type="number"
      value={value === undefined ? "" : String(value)}
      placeholder={arg.label}
      aria-label={arg.label}
      title={range && range.least !== undefined ? `${range.least} to ${range.most}` : arg.note}
      {...(range?.least !== undefined ? { min: range.least } : {})}
      {...(range?.most !== undefined ? { max: range.most } : {})}
      className="opNum"
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      style={{ width: `calc(${digits}ch + 3rem)` }}
    />
  );
}
