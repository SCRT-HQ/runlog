import { LICENSE_IDS, LICENSE_LABELS } from "@runlog/rules-schema";
import { describe } from "../describe.ts";
import { AreaField, CheckField, SelectField, TextField } from "../fields.tsx";
import { get, str, type SectionProps } from "./shared.ts";

/* ------------------------------------------------------------------ */

/** What a person may do with the pack, and who holds the rights to it. */
export function License({ draft, diagnostics, edit }: SectionProps) {
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
