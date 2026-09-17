import { useEffect, useState } from "react";
import { Badge } from "../../ui/Badge.tsx";
import { Disclosure } from "../../ui/Disclosure.tsx";
import { describe } from "../describe.ts";
import { isPlaceholderId } from "../draft.ts";
import { AreaField, CheckField, RowActions, SelectField, TextField } from "../fields.tsx";
import { get, str, type SectionProps } from "./shared.ts";

/* ------------------------------------------------------------------ */

/** What the game is, what a person needs to play it, and the words it speaks. */
export function Overview({ focus = null, ...props }: SectionProps & { focus?: string | null }) {
  return (
    <>
      <Identity {...props} />
      <Requirements {...props} />
      <Vocabulary {...props} />
      <TechnicalDetails {...props} focus={focus} />
    </>
  );
}

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
      </div>
      <AreaField
        label="Description"
        path="description"
        help={describe("description")}
        diagnostics={diagnostics}
        value={str(draft.description)}
        onChange={(v) => edit(["description"], v)}
      />
      <div className="fieldGrid">
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
    </section>
  );
}

/**
 * The two fields that are addressing rather than authorship.
 *
 * An id and a version matter at the moment a pack goes somewhere, and
 * at no other moment; put among the title and the premise they are the
 * first two things a new author is asked to decide and the two they are
 * least able to. Folded away here, echoed and reviewable in Publish,
 * and unchanged in what they are or what they write.
 *
 * It opens itself when the page is on its way to one of them, since a
 * diagnostic about the id has to land somewhere a person can type.
 */
function TechnicalDetails({ draft, diagnostics, edit, focus }: SectionProps & { focus: string | null }) {
  // Counted rather than flagged: the fold owns whether it is open once it
  // is drawn, which is what lets a person shut it again, so the only way
  // to open it from out here is to draw a new one. Each arrival at one of
  // these fields is one opening.
  const [openings, setOpenings] = useState(0);
  useEffect(() => {
    if (focus === "id" || focus === "version") setOpenings((n) => n + 1);
  }, [focus]);
  return (
    <Disclosure key={openings} defaultOpen={openings > 0} summary="Technical details">
      <div className="fieldGrid">
        <TextField
          label="Id"
          path="id"
          mono
          help={describe("id")}
          diagnostics={diagnostics}
          badge={isPlaceholderId(draft.id) ? <Badge tone="warn">Placeholder</Badge> : undefined}
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
      </div>
    </Disclosure>
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
