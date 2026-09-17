import { useState } from "react";
import YAML from "yaml";
import { LICENSE_IDS, LICENSE_LABELS, type Pack } from "@runlog/rules-schema";
import { Badge } from "../../ui/Badge.tsx";
import { describe } from "../describe.ts";
import { AreaField, CheckField, RowActions, SelectField, TextField } from "../fields.tsx";
import { isPlaceholderId, packFilename, type Draft } from "../draft.ts";
import { describeLength, encodePackLink } from "../../share/link.ts";
import { SignPanel } from "../SignPanel.tsx";
import { DocsPanel } from "../DocsPanel.tsx";
import { get, str, type SectionProps } from "./shared.ts";

/* ------------------------------------------------------------------ */

/**
 * What it takes to hand the pack to somebody else, read top to bottom.
 *
 * The order is the order of the decisions: what this copy is called, what
 * a person may do with it, who says it is yours, the paper that goes with
 * it, and the two ways out. Each part says where it stands in words rather
 * than in a color, and none of them says more than the draft shows: a
 * signature is reported from the key in the draft, and nothing here calls
 * a pack ready.
 */
export function PublishSection({
  draft,
  diagnostics,
  edit,
  pack,
  loads,
  droppedSignature,
  onEditIdentity,
}: SectionProps & {
  pack: Pack | null;
  loads: boolean;
  /** Whether an edit has taken a signature off the draft since it was opened. */
  droppedSignature: boolean;
  /** Show the id and version where they are edited, in Overview's fold. */
  onEditIdentity: () => void;
}) {
  return (
    <>
      {isPlaceholderId(draft.id) && (
        <p className="notice">This pack still has a placeholder id. Give it a domain you control before you sign or share it.</p>
      )}
      <Identifier draft={draft} onEditIdentity={onEditIdentity} />
      <License draft={draft} diagnostics={diagnostics} edit={edit} />
      <Signature draft={draft} droppedSignature={droppedSignature} pack={pack} loads={loads} />
      <DocsPanel pack={pack} />
      <Share draft={draft} />
    </>
  );
}

/**
 * What this pack is called, wherever it ends up.
 *
 * Read-only on purpose: the fields are in Overview and moving them here
 * as well would make two places to change one value. What Publish owes is
 * the last look before the id is in somebody's library for good.
 */
function Identifier({ draft, onEditIdentity }: { draft: Draft; onEditIdentity: () => void }) {
  return (
    <section className="panel">
      <h3 className="sectionTitle">Identifier and version</h3>
      <p className="publishState">
        <span className="mono">{str(draft.id)}</span>
        {isPlaceholderId(draft.id) && <Badge tone="warn">Placeholder</Badge>} <span className="mono">v{str(draft.version)}</span>
      </p>
      <RowActions>
        <button type="button" className="linkButton" onClick={onEditIdentity}>
          Edit in Overview
        </button>
      </RowActions>
    </section>
  );
}

/**
 * What a person may do with the pack, and who holds the rights to it.
 *
 * No state line of its own: the license is whatever the picker says it is,
 * a line above it would be the same words twice, and the two checkboxes
 * under it already read as sentences.
 */
function License({ draft, diagnostics, edit }: SectionProps) {
  const chosen = str(get(draft, ["license", "id"]));
  return (
    <section className="panel">
      <h3 className="sectionTitle">License</h3>
      <div className="fieldGrid">
        <SelectField
          label="License"
          path="license.id"
          help={describe("license.id")}
          diagnostics={diagnostics}
          value={chosen}
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
        rows={chosen === "proprietary" || chosen === "custom" ? 8 : 3}
        help={describe("license.text")}
        diagnostics={diagnostics}
        value={str(get(draft, ["license", "text"]))}
        onChange={(v) => edit(["license", "text"], v || undefined)}
      />
      <CheckField
        label="Its text may travel"
        path="license.redistributable"
        diagnostics={diagnostics}
        help={describe("license.redistributable")}
        value={get(draft, ["license", "redistributable"]) !== false}
        onChange={(v) => edit(["license", "redistributable"], v)}
      />
      <CheckField
        label="One copy seats the table"
        path="license.tablePlays"
        diagnostics={diagnostics}
        help={describe("license.tablePlays")}
        value={get(draft, ["license", "tablePlays"]) !== false}
        onChange={(v) => edit(["license", "tablePlays"], v)}
      />
    </section>
  );
}

/** A date somebody can read, from an ISO one. The bare string if it is not one. */
function day(iso: unknown): string {
  if (typeof iso !== "string") return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Where the draft stands with its signature, said in words.
 *
 * The line reports the draft and nothing else. A signature is on the draft
 * or it is not, and any edit takes it off, so "signed" here cannot mean a
 * signature that stopped describing the file: the state after an edit has
 * a line of its own and the guidance for getting back out of it.
 */
function Signature({
  draft,
  droppedSignature,
  pack,
  loads,
}: {
  draft: Draft;
  droppedSignature: boolean;
  pack: Pack | null;
  loads: boolean;
}) {
  const signature = draft.signature as { signedBy?: unknown; signedAt?: unknown } | undefined;
  const signedBy = typeof signature?.signedBy === "string" ? signature.signedBy : "";
  const when = day(signature?.signedAt);
  const state = droppedSignature
    ? "Signature dropped by an edit"
    : !signature
      ? "Not signed"
      : signedBy
        ? `Signed by ${signedBy} on ${when}`
        : `Signed on ${when}`;

  return (
    <>
      <section className="panel">
        <h3 className="sectionTitle">Signature</h3>
        <p className={droppedSignature ? "publishState warnText" : "publishState"}>{state}</p>
        {droppedSignature && (
          <div className="notice">
            This pack was signed, and your edit removed the signature, it no longer describes what is in the file. Sign the pack again when
            you are finished: <code>runlog sign {packFilename(draft)} --key your-key.json</code>
          </div>
        )}
      </section>
      <SignPanel draft={draft} pack={pack} loads={loads} />
    </>
  );
}

/**
 * The two ways a draft leaves this browser: as a file, and as a link with
 * the whole pack inside it. Both work on a draft that does not load yet,
 * which is the point of them: a half-written pack is what you send to
 * somebody to ask about.
 */
function Share({ draft }: { draft: Draft }) {
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
      <h3 className="sectionTitle">Share</h3>
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
