import { describe } from "../describe.ts";
import { AreaField, CheckField, RowActions, SelectField, TextField } from "../fields.tsx";
import { get, str, type SectionProps } from "./shared.ts";

/* ------------------------------------------------------------------ */

export function Identity({ draft, diagnostics, edit }: SectionProps) {
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
            const list = v
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
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
export function Requirements({ draft, diagnostics, edit }: SectionProps) {
  const requires = Array.isArray(draft.requires) ? (draft.requires as Record<string, unknown>[]) : [];
  const set = (i: number, key: string, value: unknown) => edit(["requires", i, key], value === "" ? undefined : value);
  return (
    <section className="panel">
      <h3 className="sectionTitle">What a person needs</h3>
      <p className="fieldHelp">{describe("requires")}</p>
      {requires.map((r, i) => (
        <div key={i} className="entryEditor">
          <div className="fieldGrid tight">
            <TextField
              label="Id"
              path={`requires[${i}].id`}
              mono
              diagnostics={diagnostics}
              value={str(r.id)}
              onChange={(v) => set(i, "id", v)}
            />
            <TextField
              label="What it is"
              path={`requires[${i}].label`}
              help={i === 0 ? describe("requires[].label") : undefined}
              diagnostics={diagnostics}
              value={str(r.label)}
              onChange={(v) => set(i, "label", v)}
            />
            <SelectField
              label="Kind"
              path={`requires[${i}].kind`}
              diagnostics={diagnostics}
              value={str(r.kind) || "other"}
              options={REQUIREMENT_KINDS}
              onChange={(v) => set(i, "kind", v === "other" ? undefined : v)}
            />
          </div>
          <div className="fieldGrid tight">
            <TextField
              label="Note"
              path={`requires[${i}].note`}
              help={i === 0 ? describe("requires[].note") : undefined}
              diagnostics={diagnostics}
              value={str(r.note)}
              onChange={(v) => set(i, "note", v)}
            />
            <TextField
              label="Where to find it"
              path={`requires[${i}].url`}
              mono
              diagnostics={diagnostics}
              value={str(r.url)}
              onChange={(v) => set(i, "url", v)}
              placeholder="https://"
            />
          </div>
          <CheckField
            label="Nice to have, not needed"
            help={i === 0 ? describe("requires[].optional") : undefined}
            value={r.optional === true}
            onChange={(v) => set(i, "optional", v ? true : undefined)}
          />
          <RowActions>
            <button
              className="ghost tiny"
              onClick={() => edit(["requires"], requires.length > 1 ? requires.filter((_, j) => j !== i) : undefined)}
            >
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

export function Vocabulary({ draft, diagnostics, edit }: SectionProps) {
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
