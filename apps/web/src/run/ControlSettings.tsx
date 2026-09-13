import { useEffect, useMemo, useRef, useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import { apiBase } from "../sync/config.ts";
import { useApi } from "../sync/useApi.ts";
import type { StreamKeys } from "../sync/client.ts";
import type { StoredRun } from "../storage/db.ts";
import { CATALOGS, catalogFor, opDef, rangeOfValue, type ArgDef, type ToolCatalog } from "../control/catalog.ts";
import { builtins, forPack, type Builtin } from "../control/builtin.ts";
import { known, listsFor, type Lists } from "../control/lists.ts";
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
export function ControlSettings({
  pack,
  record,
  seats,
  onControl,
}: {
  pack: Pack;
  record: StoredRun | null;
  /** The roster of a moderated run, so each racer can be given their own address. */
  seats?: string[];
  onControl?: (control: unknown) => void | Promise<void>;
}) {
  const saved = (record?.control as ControlProfile | undefined) ?? undefined;
  const [profile, setProfile] = useState<ControlProfile>(saved && !isEmpty(saved) ? saved : EMPTY);
  const [note, setNote] = useState<string | null>(null);
  /** Which address was last copied: the empty string for the table's own. */
  const [copied, setCopied] = useState<string | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const api = useApi();
  /** Whether the account has keys, as the server has it: never the keys. */
  const [keys, setKeys] = useState<StreamKeys>({});
  /**
   * A watch key just minted, held only while this panel is open.
   *
   * The server keeps a hash and nothing else, so an address with the key
   * in it can only be shown in the moment it is made. Which is why the
   * button is here rather than a sentence telling somebody to go and
   * find one: making it and copying the finished address is one motion.
   */
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The profiles that ship with the app, and which of them fits this pack. */
  const [shipped, setShipped] = useState<Builtin[]>([]);
  /**
   * The names this tool will match a frame against.
   *
   * Fetched rather than shipped, and only once a profile names a tool
   * that has any: an empty box asking for one grace out of four hundred
   * is a box nobody can fill without leaving the run.
   */
  const [lists, setLists] = useState<Lists>({});

  useEffect(() => {
    let live = true;
    void builtins().then((all) => live && setShipped(forPack(all, pack.id)), () => {});
    return () => {
      live = false;
    };
  }, [pack.id]);

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.streamKeys().then((k) => live && setKeys(k), () => {});
    return () => {
      live = false;
    };
  }, [api]);

  useEffect(() => {
    let live = true;
    void listsFor(profile.tool).then((l) => live && setLists(l), () => {});
    return () => {
      live = false;
    };
  }, [profile.tool]);

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

  /**
   * The address the tool dials, finished where the key is in hand.
   *
   * One per person where there is a roster. A connection that says which
   * seat it is hears the rules addressed to that seat as well as the ones
   * addressed to nobody, so a race is set up by handing each runner their
   * own line of this and nothing else: one curse can land on one of them
   * and the warp can still land on all of them.
   */
  const addressFor = (seat?: string) => {
    const b = (apiBase() ?? "/api").replace(/\/$/, "");
    const origin = /^https?:/.test(b) ? new URL(b).origin : typeof location !== "undefined" ? location.origin : "";
    const k = key ? encodeURIComponent(key) : "REPLACE-WITH-YOUR-WATCH-KEY";
    const tail = seat ? `&seat=${encodeURIComponent(seat)}` : "";
    return `${origin.replace(/^http/, "ws")}/ws?k=${k}&as=control${tail}`;
  };
  const address = addressFor();
  /**
   * The lists this profile has a field for, so the sheet carries those
   * options and not eighteen hundred of them.
   */
  const inUse = useMemo(() => {
    const out = new Set<string>();
    for (const op of [...(profile.setup ?? []), ...(profile.rows ?? []).flatMap((r) => r.ops)]) {
      for (const arg of opDef(catalog, op.op)?.args ?? []) if (arg.list) out.add(arg.list);
    }
    return [...out];
  }, [catalog, profile]);

  /** The roster, without the blanks and without anybody twice. */
  const roster = useMemo(() => [...new Set((seats ?? []).map((n) => n.trim()).filter(Boolean))], [seats]);

  const copy = (text: string, which: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(which);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const makeKey = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const made = await api.mintStreamKey("watch");
      setKey(made.key);
      setKeys(made.keys);
      setNote(null);
    } catch {
      setNote("Could not make a key just now.");
    } finally {
      setBusy(false);
    }
  };

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

  /** The one written for this pack, where there is one. */
  const itsOwn = shipped.find((b) => b.pack === pack.id) ?? null;

  const use = (b: Builtin) => {
    update(b.profile);
    setNote(`Loaded ${b.title}. It is yours now: edit it, and Export gives you the file back.`);
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
      <h3 className="sectionTitle">
        Control <span className="muted">what a tool does about the dice</span>
      </h3>
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
        <p className="muted small">
          {key
            ? "The address the tool dials, with your key in it. Shown this once."
            : keys.watch
              ? "The address the tool dials. Your key was shown once when it was made; a new one finishes this address and stops the old one working."
              : "The address the tool dials. It needs a watch key, which is what lets a tool read this run."}
        </p>
        <code className="askAddress">{address}</code>
        <div className="padRow">
          <button className="ghost tiny" onClick={() => copy(address, "")}>
            {copied === "" ? "Copied" : "Copy address"}
          </button>
          {api && (
            <button className={key ? "ghost tiny" : "primary tiny"} disabled={busy} onClick={() => void makeKey()}>
              {keys.watch ? "New watch key" : "Make a watch key"}
            </button>
          )}
          {roster.length === 0 && <span className="muted small">Add &amp;seat=Name where more than one person is playing.</span>}
        </div>

        {roster.length > 0 && (
          <>
            <p className="muted small">
              One each, so a rule can be addressed to one person. A tool that dials its own line hears the rules with that name on them and the rules with no name
              on them; the address above hears only the second kind.
            </p>
            {roster.map((name) => (
              <div className="padRow" key={name}>
                <strong className="small">{name}</strong>
                <code className="askAddress">{addressFor(name)}</code>
                <button className="ghost tiny" onClick={() => copy(addressFor(name), name)}>
                  {copied === name ? "Copied" : "Copy"}
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {itsOwn && isEmpty(profile) && (
        <div className="askKey">
          <p className="muted small">
            {pack.title} ships with a profile. It maps every result this pack can draw to something the tool does, and it is a starting point rather than a
            standard: once it is loaded, it is yours to change.
          </p>
          <div className="padRow">
            <button className="primary tiny" onClick={() => use(itsOwn)}>
              Use the one that ships with {pack.title}
            </button>
          </div>
        </div>
      )}

      {shipped.length > 0 && !(itsOwn && isEmpty(profile)) && (
        <div className="padRow">
          <span className="muted small">Start from one that ships:</span>
          <select
            className="chipAdd"
            value=""
            aria-label="A profile that ships with the app"
            onChange={(e) => {
              const found = shipped.find((b) => b.id === e.target.value);
              if (found) use(found);
            }}
          >
            <option value="">choose…</option>
            {shipped.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
                {b.pack === pack.id ? " · for this pack" : ""}
              </option>
            ))}
          </select>
          <span className="muted small">Replaces what is here.</span>
        </div>
      )}

      <h4 className="stepLabel">The {pack.vocabulary.run.one.toLowerCase()}&apos;s terms</h4>
      <p className="muted small">Applied when a tool attaches and held until the {pack.vocabulary.run.one.toLowerCase()} ends. The settings that would otherwise be a paragraph nobody reads.</p>
      <Ops catalog={catalog} lists={lists} ops={profile.setup ?? []} onChange={(setup) => update({ ...profile, setup })} />

      <h4 className="stepLabel">Rules</h4>
      {inUse.map((list) => (
        <datalist id={`controlNames-${list}`} key={list}>
          {(lists[list] ?? []).map((n) => (
            <option key={`${n.name}·${n.area ?? ""}`} value={n.name}>
              {n.area ?? (n.max !== undefined ? `to +${n.max}` : "")}
            </option>
          ))}
        </datalist>
      ))}
      {roster.length > 0 && (
        <datalist id="controlSeats">
          {roster.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
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
              list={roster.length > 0 ? "controlSeats" : undefined}
              onChange={(e) => setRow(i, { ...row, to: e.target.value || undefined })}
              style={{ width: "8rem" }}
            />
            <input type="text" value={row.label ?? ""} placeholder="what to call it" aria-label="What to call it" onChange={(e) => setRow(i, { ...row, label: e.target.value || undefined })} />
          </div>

          <Ops catalog={catalog} lists={lists} ops={row.ops} onChange={(ops) => setRow(i, { ...row, ops })} />
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
function Ops({ catalog, lists, ops, onChange }: { catalog: ToolCatalog | null; lists: Lists; ops: ProfileOp[]; onChange: (ops: ProfileOp[]) => void }) {
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
              <Arg key={arg.name} arg={arg} op={op} lists={lists} onChange={(value) => set(i, { ...op, args: { ...op.args, [arg.name]: value } })} />
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

function Arg({ arg, op, lists, onChange }: { arg: ArgDef; op: ProfileOp; lists: Lists; onChange: (value: unknown) => void }) {
  const value = op.args[arg.name];

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
