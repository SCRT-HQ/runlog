import { useState } from "react";
import YAML from "yaml";
import { LICENSE_IDS, LICENSE_LABELS, type Pack } from "@runlog/rules-schema";
import { describe } from "../describe.ts";
import { AreaField, CheckField, RowActions, SelectField, TextField } from "../fields.tsx";
import { packFilename, type Draft } from "../draft.ts";
import { describeLength, encodePackLink } from "../../share/link.ts";
import { SignPanel } from "../SignPanel.tsx";
import { DocsPanel } from "../DocsPanel.tsx";
import { get, str, type SectionProps } from "./shared.ts";

/* ------------------------------------------------------------------ */

/**
 * What it takes to hand the pack to somebody else: what they may do with
 * it, who signed it, the paper that comes with it, and the two ways out,
 * a file and a link.
 */
export function PublishSection({
  draft,
  diagnostics,
  edit,
  pack,
  loads,
  droppedSignature,
}: SectionProps & {
  pack: Pack | null;
  loads: boolean;
  /** Whether an edit has taken a signature off the draft since it was opened. */
  droppedSignature: boolean;
}) {
  return (
    <>
      {droppedSignature && (
        <div className="notice">
          This pack was signed, and your edit removed the signature, it no longer describes what is in the file. Sign the pack again when
          you are finished: <code>runlog sign {packFilename(draft)} --key your-key.json</code>
        </div>
      )}
      <License draft={draft} diagnostics={diagnostics} edit={edit} />
      <Handing draft={draft} />
      <SignPanel draft={draft} pack={pack} loads={loads} />
      <DocsPanel pack={pack} />
    </>
  );
}

/** What a person may do with the pack, and who holds the rights to it. */
function License({ draft, diagnostics, edit }: SectionProps) {
  return (
    <section className="panel">
      <h3 className="sectionTitle">License</h3>
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
      <CheckField
        label="One copy seats the table"
        help={describe("license.tablePlays")}
        value={get(draft, ["license", "tablePlays"]) !== false}
        onChange={(v) => edit(["license", "tablePlays"], v)}
      />
    </section>
  );
}

/**
 * The two ways a draft leaves this browser: as a file, and as a link with
 * the whole pack inside it. Both work on a draft that does not load yet,
 * which is the point of them: a half-written pack is what you send to
 * somebody to ask about.
 */
function Handing({ draft }: { draft: Draft }) {
  const [saved, setSaved] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const download = () => {
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

  return (
    <section className="panel">
      <RowActions>
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
      </RowActions>
      {link && (
        <div className="notice shareNotice">
          <div>
            <strong>Copied.</strong> The whole pack is inside that link, it goes nowhere near a server, so anyone you send it to has your
            game and nothing in between has seen it.
          </div>
          <div className={describeLength(link).ok ? "muted small" : "warnText"}>{describeLength(link).text}</div>
          <input className="textInput mono" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="ghost tiny" onClick={() => setLink(null)}>
            done
          </button>
        </div>
      )}
    </section>
  );
}
