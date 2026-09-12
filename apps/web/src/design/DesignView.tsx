import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import YAML from "yaml";
import { parsePack, type Diagnostic, type Pack, LICENSE_IDS, LICENSE_LABELS } from "@runlog/rules-schema";
import { describe } from "./describe.ts";
import { at, AreaField, CheckField, NumberField, RowActions, SelectField, TextField } from "./fields.tsx";
import {
  blankPack,
  coverage,
  coverageSummary,
  DRAFT_ID,
  isBlank,
  packFilename,
  type Draft,
} from "./draft.ts";
import { loadDraft, saveDraft } from "../storage/db.ts";
import { describeLength, encodePackLink } from "../share/link.ts";
import { StartFrom } from "./StartFrom.tsx";
import { SignPanel } from "./SignPanel.tsx";
import { DocsPanel } from "./DocsPanel.tsx";
import { StructurePanel } from "./StructurePanel.tsx";

/**
 * Writing a pack without writing YAML.
 *
 * The format is meant to be contributable, and "learn our YAML schema first"
 * is where most contributable formats quietly stop being contributable. This
 * is the same document, edited through fields.
 *
 * Two things make it cheaper than it looks. The linter already produces
 * structured diagnostics with dotted paths, so each problem attaches to the
 * field that caused it rather than needing its own validation. And the schema
 * already documents itself, so the help under every field is the schema's own
 * sentence rather than a second copy of it.
 *
 * It edits the draft freely and validates alongside. An editor that refuses
 * your keystrokes until the document is correct is one nobody finishes a
 * document in.
 */

/** Set a value at a path, cloning the way down. Never mutates the argument. */
function put(draft: Draft, path: (string | number)[], value: unknown): Draft {
  if (path.length === 0) return value as Draft;
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const list = Array.isArray(draft) ? [...(draft as unknown[])] : [];
    list[head] = rest.length === 0 ? value : put((list[head] ?? {}) as Draft, rest, value);
    return list as unknown as Draft;
  }
  const next: Draft = { ...draft };
  next[head!] = rest.length === 0 ? value : put((next[head!] ?? {}) as Draft, rest, value);
  return next;
}

function get(draft: unknown, path: (string | number)[]): unknown {
  let cursor: unknown = draft;
  for (const segment of path) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  return cursor;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback = 0) => (typeof v === "number" ? v : fallback);

export function DesignView({ onTest }: { onTest?: (pack: Pack) => void } = {}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [droppedSignature, setDroppedSignature] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Whether to ask "which pack?" before showing the editor at all. Set once,
  // from what loaded, and never persisted: the choice is for this visit.
  const [atDoor, setAtDoor] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadDraft(DRAFT_ID).then((stored) => {
      const loaded = (stored?.pack as Draft | undefined) ?? blankPack();
      setDraft(loaded);
      setAtDoor(!isBlank(loaded));
    });
  }, []);

  /** Replace the whole draft, keeping the saved copy in step. */
  const replace = useCallback((next: Draft) => {
    setDraft(next);
    setProblem(null);
    setDroppedSignature(false);
    void saveDraft({ id: DRAFT_ID, pack: next, updatedAt: new Date().toISOString() });
  }, []);

  /**
   * Open a pack that already exists.
   *
   * The point of an editor for a data format is usually the second edit, not
   * the first: fixing a table in something you shipped, or starting from a
   * pack close to what you want. Parsed as YAML, which also reads JSON, and
   * kept as the raw document rather than the validated one, so a pack with a
   * problem in it opens *so you can fix the problem* instead of being refused
   * at the door.
   */
  const open = useCallback(
    async (chosen: File | undefined) => {
      if (!chosen) return;
      let parsed: unknown;
      try {
        parsed = YAML.parse(await chosen.text());
      } catch (e) {
        // Only the first line: a YAML parser's full complaint includes a
        // source excerpt that is unreadable squeezed into a notice.
        const why = e instanceof Error ? e.message.split(/\r?\n/)[0] : "";
        setProblem(`${chosen.name} is not readable as YAML or JSON. ${why}`);
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setProblem(`${chosen.name} does not contain a pack.`);
        return;
      }
      replace(parsed as Draft);
    },
    [replace],
  );

  const edit = useCallback((path: (string | number)[], value: unknown) => {
    setDraft((prev) => {
      if (!prev) return prev;
      let next = put(prev, path, value);

      // An edited pack is no longer the one its author signed, and a stale
      // signature is worse than none: it makes an honest edit look like
      // tampering to everyone who opens it. So the signature comes off the
      // moment the pack changes, and is said out loud rather than done
      // quietly: re-signing is a deliberate act with a private key.
      if (next.signature) {
        const { signature: _dropped, ...rest } = next;
        next = rest;
        setDroppedSignature(true);
      }

      void saveDraft({ id: DRAFT_ID, pack: next, updatedAt: new Date().toISOString() });
      return next;
    });
  }, []);

  const result = useMemo(() => (draft ? parsePack(draft) : null), [draft]);
  const diagnostics: Diagnostic[] = result?.diagnostics ?? [];
  const errors = diagnostics.filter((d) => d.level === "error");
  const warnings = diagnostics.filter((d) => d.level === "warning");

  const download = () => {
    if (!draft) return;
    const text = YAML.stringify(draft, { lineWidth: 90 });
    const url = URL.createObjectURL(new Blob([text], { type: "text/yaml;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = packFilename(draft);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  if (!draft) {
    return (
      <main className="main">
        <section className="panel muted">Opening your draft…</section>
      </main>
    );
  }

  if (atDoor) {
    return (
      <main className="main design">
        <section className="hero runHero">
          <div>
            <h2>Which pack?</h2>
            <p className="muted">The Designer opens on whatever you were last writing.</p>
          </div>
        </section>
        <section className="panel">
          <div className="headerActions">
            <button className="primary" onClick={() => setAtDoor(false)}>
              Continue editing {str(draft.title) || "Untitled"}
            </button>
            <button
              className="ghost"
              onClick={() => {
                if (confirm("Start a new pack? The current draft is replaced.")) {
                  replace(blankPack());
                  setAtDoor(false);
                }
              }}
            >
              New pack
            </button>
          </div>
        </section>
      </main>
    );
  }

  const props = { draft, diagnostics, edit };

  return (
    <main className="main design">
      <section className="hero runHero">
        <div>
          <h2>{str(draft.title) || "Untitled"}</h2>
          <p className="muted">
            {str(draft.id)} · v{str(draft.version)}
            {errors.length === 0 ? (
              <span className="chip ok"> loads</span>
            ) : (
              <span className="chip warn">
                {" "}
                {errors.length} {errors.length === 1 ? "error" : "errors"}
              </span>
            )}
            {warnings.length > 0 && <span className="chip"> {warnings.length} to look at</span>}
          </p>
        </div>
        <div className="headerActions">
          <button
            className="ghost"
            onClick={() => {
              if (confirm("Start again from a blank pack? Your draft is replaced.")) {
                replace(blankPack());
              }
            }}
          >
            New pack
          </button>
          <button className="ghost" onClick={() => file.current?.click()}>
            Open a file…
          </button>
          <button className="ghost" onClick={() => setStarting((s) => !s)}>
            Start from a pack…
          </button>
          <input
            ref={file}
            type="file"
            accept=".yaml,.yml,.json"
            className="hiddenInput"
            onChange={(e) => {
              void open(e.target.files?.[0]);
              // Cleared so choosing the same file twice fires again: the
              // obvious thing to do after editing it outside the app.
              e.target.value = "";
            }}
          />
          {onTest && (
            <button
              className="ghost"
              disabled={!result?.ok || errors.length > 0}
              onClick={() => result?.ok && onTest(result.pack)}
              title={errors.length > 0 ? "Fix the problems first; a pack with errors cannot be played" : "Play this draft in a run that is not saved"}
            >
              Try it
            </button>
          )}
          <button className="ghost" onClick={download}>
            {saved ? "saved" : `Download ${packFilename(draft)}`}
          </button>
          <button
            className="ghost"
            onClick={() => {
              void (async () => {
                const made = await encodePackLink(draft);
                setLink(made);
                try {
                  await navigator.clipboard?.writeText(made);
                } catch {
                  // No clipboard permission: the link is shown below to copy
                  // by hand, so this is not worth interrupting anyone about.
                }
              })();
            }}
          >
            Copy a link
          </button>
        </div>
      </section>

      {problem && <div className="notice">{problem}</div>}

      {starting && (
        <StartFrom
          onPick={(doc) => {
            replace(doc as Draft);
            setStarting(false);
          }}
          onClose={() => setStarting(false)}
        />
      )}

      {link && (
        <div className="notice shareNotice">
          <div>
            <strong>Copied.</strong> The whole pack is inside that link, it goes nowhere
            near a server, so anyone you send it to has your game and nothing in between
            has seen it.
          </div>
          <div className={describeLength(link).ok ? "muted small" : "warnText"}>
            {describeLength(link).text}
          </div>
          <input className="textInput mono" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="ghost tiny" onClick={() => setLink(null)}>
            done
          </button>
        </div>
      )}

      {droppedSignature && (
        <div className="notice">
          This pack was signed, and your edit removed the signature, it no longer
          describes what is in the file. Sign the pack again when you are finished:{" "}
          <code>runlog sign {packFilename(draft)} --key your-key.json</code>
        </div>
      )}

      <div className="columns">
        <div className="col wide">
          <Identity {...props} />
          <Requirements {...props} />
          <Vocabulary {...props} />
          <Tables {...props} />
          <Phases {...props} />
          <Modes {...props} />
        </div>
        <div className="col">
          <Problems diagnostics={diagnostics} />
          <SignPanel draft={draft} pack={result?.ok ? result.pack : null} loads={errors.length === 0} />
          <DocsPanel pack={result?.ok ? result.pack : null} />
          {result?.ok && <StructurePanel pack={result.pack} warnings={result.diagnostics} random={() => Math.random} />}
        </div>
      </div>
    </main>
  );
}

interface SectionProps {
  draft: Draft;
  diagnostics: Diagnostic[];
  edit: (path: (string | number)[], value: unknown) => void;
}

/* ------------------------------------------------------------------ */

function Identity({ draft, diagnostics, edit }: SectionProps) {
  return (
    <section className="panel">
      <h3 className="sectionTitle">What it is</h3>
      <div className="fieldGrid">
        <TextField
          label="Title"
          path="title"
          help={describe("title")}
          diagnostics={diagnostics}
          value={str(draft.title)}
          onChange={(v) => edit(["title"], v)}
        />
        <TextField
          label="Id"
          path="id"
          mono
          help={describe("id")}
          diagnostics={diagnostics}
          value={str(draft.id)}
          onChange={(v) => edit(["id"], v)}
        />
        <TextField
          label="Version"
          path="version"
          mono
          help={describe("version")}
          diagnostics={diagnostics}
          value={str(draft.version)}
          onChange={(v) => edit(["version"], v)}
        />
        <TextField
          label="Author"
          path="author"
          help={describe("author")}
          diagnostics={diagnostics}
          value={str(draft.author)}
          onChange={(v) => edit(["author"], v)}
        />
        <TextField
          label="Category"
          path="category"
          help={describe("category")}
          diagnostics={diagnostics}
          value={str(draft.category)}
          onChange={(v) => edit(["category"], v || undefined)}
        />
        <TextField
          label="Tags"
          path="tags"
          help={`${describe("tags") ?? ""} Separate them with commas.`}
          diagnostics={diagnostics}
          value={Array.isArray(draft.tags) ? draft.tags.map(String).join(", ") : ""}
          onChange={(v) => {
            const list = v.split(",").map((t) => t.trim()).filter(Boolean);
            edit(["tags"], list.length > 0 ? list : undefined);
          }}
        />
      </div>
      <AreaField
        label="Description"
        path="description"
        help={describe("description")}
        diagnostics={diagnostics}
        value={str(draft.description)}
        onChange={(v) => edit(["description"], v)}
      />

      <h4 className="stepLabel">License</h4>
      <div className="fieldGrid">
        <SelectField
          label="License"
          path="license.id"
          help={describe("license.id")}
          diagnostics={diagnostics}
          value={str(get(draft, ["license", "id"]))}
          options={LICENSE_IDS.map((id) => ({ value: id, label: LICENSE_LABELS[id] }))}
          onChange={(v) => edit(["license", "id"], v)}
        />
        <TextField
          label="Rights holder"
          path="license.holder"
          help={describe("license.holder")}
          diagnostics={diagnostics}
          value={str(get(draft, ["license", "holder"]))}
          onChange={(v) => edit(["license", "holder"], v || undefined)}
        />
      </div>
      <AreaField
        label="License text"
        path="license.text"
        rows={get(draft, ["license", "id"]) === "proprietary" || get(draft, ["license", "id"]) === "custom" ? 8 : 3}
        help={describe("license.text")}
        diagnostics={diagnostics}
        value={str(get(draft, ["license", "text"]))}
        onChange={(v) => edit(["license", "text"], v || undefined)}
      />
      <CheckField
        label="Its text may travel"
        help={describe("license.redistributable")}
        value={get(draft, ["license", "redistributable"]) !== false}
        onChange={(v) => edit(["license", "redistributable"], v)}
      />
    </section>
  );
}

const REQUIREMENT_KINDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "game", label: "a game" },
  { value: "platform", label: "a platform: a PC, a console, a phone" },
  { value: "software", label: "software: a mod, a training pack, an app" },
  { value: "equipment", label: "equipment: a wheel, an oven, a bike" },
  { value: "supplies", label: "supplies: clay, flour, film" },
  { value: "space", label: "a space: a kitchen, a room, a court" },
  { value: "other", label: "something else" },
];

/**
 * What a person needs before they play. The marketplace says it on the card
 * and the setup screen asks about the optional ones, so results that need
 * an absent thing are drawn again. Entries name a requirement by id in
 * `needs`, which is why the id is shown beside the label.
 */
function Requirements({ draft, diagnostics, edit }: SectionProps) {
  const requires = Array.isArray(draft.requires) ? (draft.requires as Record<string, unknown>[]) : [];
  const set = (i: number, key: string, value: unknown) => edit(["requires", i, key], value === "" ? undefined : value);
  return (
    <section className="panel">
      <h3 className="sectionTitle">What a person needs</h3>
      <p className="fieldHelp">{describe("requires")}</p>
      {requires.map((r, i) => (
        <div key={i} className="entryEditor">
          <div className="fieldGrid tight">
            <TextField label="Id" path={`requires[${i}].id`} mono diagnostics={diagnostics} value={str(r.id)} onChange={(v) => set(i, "id", v)} />
            <TextField label="What it is" path={`requires[${i}].label`} help={i === 0 ? describe("requires[].label") : undefined} diagnostics={diagnostics} value={str(r.label)} onChange={(v) => set(i, "label", v)} />
            <SelectField label="Kind" path={`requires[${i}].kind`} diagnostics={diagnostics} value={str(r.kind) || "other"} options={REQUIREMENT_KINDS} onChange={(v) => set(i, "kind", v === "other" ? undefined : v)} />
          </div>
          <div className="fieldGrid tight">
            <TextField label="Note" path={`requires[${i}].note`} help={i === 0 ? describe("requires[].note") : undefined} diagnostics={diagnostics} value={str(r.note)} onChange={(v) => set(i, "note", v)} />
            <TextField label="Where to find it" path={`requires[${i}].url`} mono diagnostics={diagnostics} value={str(r.url)} onChange={(v) => set(i, "url", v)} placeholder="https://" />
          </div>
          <CheckField label="Nice to have, not needed" help={i === 0 ? describe("requires[].optional") : undefined} value={r.optional === true} onChange={(v) => set(i, "optional", v ? true : undefined)} />
          <RowActions>
            <button className="ghost tiny" onClick={() => edit(["requires"], requires.length > 1 ? requires.filter((_, j) => j !== i) : undefined)}>
              remove
            </button>
          </RowActions>
        </div>
      ))}
      <RowActions>
        <button className="ghost" onClick={() => edit(["requires"], [...requires, { id: `need-${requires.length + 1}`, label: "" }])}>
          + add a requirement
        </button>
      </RowActions>
    </section>
  );
}

function Vocabulary({ draft, diagnostics, edit }: SectionProps) {
  const words = [
    { key: "run", label: "A whole session", hint: "a firing, a draft, a training block" },
    { key: "unit", label: "One turn of it", hint: "a stage, a scene, a session" },
    { key: "subject", label: "What a turn makes", hint: "a piece, a passage, a set" },
  ] as const;

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Your words <span className="muted">the whole interface speaks these</span>
      </h3>
      {words.map(({ key, label, hint }) => (
        <div key={key} className="fieldGrid">
          <TextField
            label={`${label} - one`}
            path={`vocabulary.${key}.one`}
            diagnostics={diagnostics}
            help={hint}
            value={str(get(draft, ["vocabulary", key, "one"]))}
            onChange={(v) => edit(["vocabulary", key, "one"], v)}
          />
          <TextField
            label="many"
            path={`vocabulary.${key}.many`}
            diagnostics={diagnostics}
            value={str(get(draft, ["vocabulary", key, "many"]))}
            onChange={(v) => edit(["vocabulary", key, "many"], v)}
          />
        </div>
      ))}
      <TextField
        label="The verb for closing a turn"
        path="vocabulary.finalize"
        help={describe("vocabulary.finalize")}
        diagnostics={diagnostics}
        value={str(get(draft, ["vocabulary", "finalize"]))}
        onChange={(v) => edit(["vocabulary", "finalize"], v)}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Tables({ draft, diagnostics, edit }: SectionProps) {
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
            · {str(table.resolution)} · {entries.length}{" "}
            {entries.length === 1 ? "entry" : "entries"}
          </span>
        </button>
        {isLookup && summary.text && (
          <span className={`chip ${summary.ok ? "ok" : "warn"}`}>{summary.text}</span>
        )}
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
                      onChange={(v) =>
                        edit(
                          ["tables", id, "entries", i, "range"],
                          [v, num((entry.range as number[] | undefined)?.[1], v)],
                        )
                      }
                    />
                    <NumberField
                      label="To"
                      path={`tables.${id}.entries[${i}].rangeTo`}
                      diagnostics={diagnostics}
                      value={num((entry.range as number[] | undefined)?.[1], 1)}
                      onChange={(v) =>
                        edit(
                          ["tables", id, "entries", i, "range"],
                          [num((entry.range as number[] | undefined)?.[0], v), v],
                        )
                      }
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
                  onClick={() => edit(["tables", id, "entries"], entries.filter((_, j) => j !== i))}
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
                edit(["tables", id, "entries"], [
                  ...entries,
                  {
                    id: `e${entries.length + 1}`,
                    // Starts where the last one stopped: the common case is a
                    // table filled in order, and guessing right saves the two
                    // numbers everyone gets wrong.
                    range: [previousTo + 1, previousTo + 1],
                    text: "",
                  },
                ]);
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

/* ------------------------------------------------------------------ */

function Phases({ draft, diagnostics, edit }: SectionProps) {
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
              <button
                className="ghost tiny"
                onClick={() =>
                  edit(["phases", i, "steps"], [...steps, { kind: "manual", label: "Do it." }])
                }
              >
                add a step
              </button>
              <button className="ghost tiny" onClick={() => move(i, i - 1)} disabled={i === 0}>
                ↑
              </button>
              <button
                className="ghost tiny"
                onClick={() => move(i, i + 1)}
                disabled={i === phases.length - 1}
              >
                ↓
              </button>
              <button
                className="ghost tiny"
                onClick={() => edit(["phases"], phases.filter((_, k) => k !== i))}
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
          onClick={() =>
            edit(["phases"], [
              ...phases,
              { id: `phase${phases.length + 1}`, label: "New phase", steps: [] },
            ])
          }
        >
          Add a phase
        </button>
      </RowActions>
    </section>
  );
}

function Modes({ draft, diagnostics, edit }: SectionProps) {
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
 * Everything the linter has to say, in one place.
 *
 * Duplicated deliberately: each problem also appears against its own field,
 * which is where it gets fixed, but a list is how you find out there is one at
 * all in a section you have not scrolled to.
 */
/**
 * The roles the seats take: the thrower and the caller, the cook and the
 * taster. One player holds each per unit, and they pass around the table
 * or stay put as the mode says above. Optional: seats without roles are
 * just seats.
 */
function Roles({ id, base, players, diagnostics, edit }: { id: string; base: (string | number)[]; players: Record<string, unknown>; diagnostics: Diagnostic[]; edit: SectionProps["edit"] }) {
  const roles = Array.isArray(players.roles) ? (players.roles as Record<string, unknown>[]) : [];
  const path = [...base, "players", "roles"];
  return (
    <div className="rolesEditor">
      <h5 className="stepLabel">Roles</h5>
      <p className="fieldHelp">{describe("modes.*.players.roles")}</p>
      {roles.map((r, i) => (
        <div key={i} className="entryEditor">
          <div className="fieldGrid tight">
            <TextField label="Id" path={`modes.${id}.players.roles[${i}].id`} mono diagnostics={diagnostics} value={str(r.id)} onChange={(v) => edit([...path, i, "id"], v)} />
            <TextField label="Name" path={`modes.${id}.players.roles[${i}].label`} help={i === 0 ? describe("modes.*.players.roles[].label") : undefined} diagnostics={diagnostics} value={str(r.label)} onChange={(v) => edit([...path, i, "label"], v)} />
          </div>
          <TextField label="What it does" path={`modes.${id}.players.roles[${i}].description`} help={i === 0 ? describe("modes.*.players.roles[].description") : undefined} diagnostics={diagnostics} value={str(r.description)} onChange={(v) => edit([...path, i, "description"], v || undefined)} />
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

function Problems({ diagnostics }: { diagnostics: Diagnostic[] }) {
  return (
    <section className="panel">
      <h3 className="sectionTitle">
        What it says <span className="muted">the same checks the CLI runs</span>
      </h3>
      {diagnostics.length === 0 ? (
        <p className="agreeing">Nothing to report. This pack loads.</p>
      ) : (
        <ul className="problemList">
          {diagnostics.map((d, i) => (
            <li key={i} className={d.level}>
              <code>{d.path || "pack"}</code>
              <span>{d.message}</span>
              <span className="muted small">{d.code}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
  const shape = units.fixed !== undefined ? "fixed" : units.roll ? "roll" : units.min !== undefined || units.max !== undefined ? "range" : "open";
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
          onChange={(v) => edit([...base, "units"], v === "open" ? undefined : v === "fixed" ? { fixed: 5 } : v === "range" ? { min: 1, max: 12 } : { roll: "d6+2" })}
        />
        {shape === "fixed" && (
          <NumberField label="Units" path={`modes.${id}.units.fixed`} diagnostics={diagnostics} value={num(units.fixed, 5)} onChange={(v) => edit([...base, "units"], { fixed: Math.max(1, v) })} />
        )}
        {shape === "range" && (
          <>
            <NumberField label="Fewest" path={`modes.${id}.units.min`} diagnostics={diagnostics} value={num(units.min, 1)} onChange={(v) => edit([...base, "units", "min"], Math.max(1, v))} />
            <NumberField label="Most" path={`modes.${id}.units.max`} diagnostics={diagnostics} value={num(units.max, 12)} onChange={(v) => edit([...base, "units", "max"], Math.max(1, v))} />
          </>
        )}
        {shape === "roll" && (
          <TextField label="Dice for the count" path={`modes.${id}.units.roll`} mono diagnostics={diagnostics} value={str(units.roll)} onChange={(v) => edit([...base, "units", "roll"], v)} />
        )}
        <CheckField label="Seeded" help={describe("modes.*.seeded")} value={mode.seeded === true} onChange={(v) => edit([...base, "seeded"], v ? true : undefined)} />
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
            else edit([...base, "players"], { min: Math.min(num(players?.min, 2), max), max, rotate: str(players?.rotate) || "clockwise", ...(players?.roles ? { roles: players.roles } : {}) });
          }}
        />
        {players && (
          <>
            <NumberField label="Fewest players" path={`modes.${id}.players.min`} diagnostics={diagnostics} value={num(players.min, 2)} onChange={(v) => edit([...base, "players", "min"], Math.max(1, Math.min(v, num(players.max, 2))))} />
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
            <NumberField label="Fewest contestants" path={`modes.${id}.moderated.contestants.min`} diagnostics={diagnostics} value={num(contestants.min, 2)} onChange={(v) => edit([...base, "moderated", "contestants", "min"], Math.max(1, v))} />
            <NumberField label="Most contestants" path={`modes.${id}.moderated.contestants.max`} diagnostics={diagnostics} value={num(contestants.max, 10)} onChange={(v) => edit([...base, "moderated", "contestants", "max"], Math.max(1, v))} />
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
              <NumberField label="Bonus for first" path={`modes.${id}.moderated.firstBonus`} help={describe("modes.*.moderated.firstBonus")} diagnostics={diagnostics} value={num(moderated.firstBonus, 0)} onChange={(v) => edit([...base, "moderated", "firstBonus"], v > 0 ? v : undefined)} />
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
          onChange={(v) => edit([...base, "clock"], v === "none" ? undefined : v === "timer" ? { kind: "timer", minutes: num(clock?.minutes, 25) } : { kind: "stopwatch" })}
        />
        {clock?.kind === "timer" && (
          <NumberField label="Minutes" path={`modes.${id}.clock.minutes`} diagnostics={diagnostics} value={num(clock.minutes, 25)} onChange={(v) => edit([...base, "clock", "minutes"], Math.max(1, v))} />
        )}
        {clock && (
          <>
            <TextField label="Called" path={`modes.${id}.clock.label`} help={describe("modes.*.clock.label")} diagnostics={diagnostics} value={str(clock.label)} onChange={(v) => edit([...base, "clock", "label"], v || undefined)} />
            <CheckField label="Starts with the unit" help={describe("modes.*.clock.auto")} value={clock.auto !== false} onChange={(v) => edit([...base, "clock", "auto"], v ? undefined : false)} />
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
          const lines = v.split("\n").map((l) => l.trim()).filter(Boolean);
          edit([...base, "notes"], lines.length > 0 ? lines : undefined);
        }}
      />
    </div>
  );
}
