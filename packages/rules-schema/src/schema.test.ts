import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Pack, SCHEMA_VERSION } from "./pack.ts";
import { buildSchemaBody } from "./emit.ts";
import { loadPackText } from "./load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "schema", `pack-${SCHEMA_VERSION}.schema.json`);
const repoRoot = join(here, "..", "..", "..");

const emitted = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;

// Deliberately the same function the emit script calls. A second copy of the
// pipeline here would let the script grow a step this test never sees, which
// is precisely what a staleness check must not allow.
const regenerate = buildSchemaBody;

/**
 * The published JSON Schema is what a pack author's editor reads. These tests
 * guard the two ways it can quietly stop being useful: drifting out of step
 * with the validator that actually runs, and losing the descriptions that make
 * completions self-explanatory.
 */
describe("the emitted JSON Schema", () => {
  it("is not stale — regenerating it produces the committed file", () => {
    const fresh = regenerate() as Record<string, unknown>;
    // The committed file adds $id and title on top of the generated body; the
    // description comes from the Pack schema itself, so it must match.
    const { $id, title, ...body } = emitted;
    expect($id).toBeTypeOf("string");
    expect(title).toBeTypeOf("string");
    expect(body).toEqual(fresh);
  });

  it("agrees with the runtime validator about what is legal", async () => {
    // This is the regression guard for a real bug: `z.toJSONSchema` drops regex
    // flags, so a case-insensitive /i pattern shipped as a lowercase-only
    // pattern. The published schema was stricter than the code, and authors got
    // red squiggles on ids that loaded perfectly well.
    // With the formats: the schema marks homepage and the url fields as
    // URIs, and an Ajv without formats ignores them (loudly, on stderr) and
    // checks nothing there. This way a bad address fails here as it would
    // in an author's editor.
    const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
    const validate = ajv.compile(emitted);

    const source = readFileSync(join(repoRoot, "packs", "demo", "pack.yaml"), "utf8");
    const loaded = loadPackText(source, "yaml");
    expect(loaded.ok).toBe(true);

    // Validate the raw authored document, not the parsed one: the author's
    // editor sees the raw text, so that is what must pass.
    const { parse } = await importYaml();
    const raw = parse(source);
    const valid = validate(raw);
    if (!valid) {
      throw new Error(
        `the demo pack loads at runtime but fails the published schema:\n${(validate.errors ?? [])
          .map((e) => `  ${e.instancePath || "<root>"} ${e.message}`)
          .join("\n")}`,
      );
    }
    expect(valid).toBe(true);

    // The URI fields are checked as URIs, not as any string: what an editor
    // would flag, the schema flags.
    expect(validate({ ...(raw as Record<string, unknown>), homepage: "not an address" })).toBe(false);
    expect((validate.errors ?? []).some((e) => e.instancePath === "/homepage" && e.keyword === "format")).toBe(true);
    expect(validate({ ...(raw as Record<string, unknown>), homepage: "https://example.com/kiln" })).toBe(true);
  });

  describe("intellisense coverage", () => {
    /**
     * Walk every property in the schema and collect any that a hover would
     * show nothing for. Descriptions are the entire documentation surface for
     * a pack author, so a missing one is a real defect rather than a nitpick.
     */
    /** Follow a local $ref, so a reference inherits its target's docs. */
    function deref(node: unknown): Record<string, unknown> | null {
      if (typeof node !== "object" || node === null) return null;
      const obj = node as Record<string, unknown>;
      const ref = obj.$ref;
      if (typeof ref !== "string" || !ref.startsWith("#/")) return obj;
      let cursor: unknown = emitted;
      for (const segment of ref.slice(2).split("/")) {
        if (typeof cursor !== "object" || cursor === null) return null;
        cursor = (cursor as Record<string, unknown>)[segment];
      }
      return typeof cursor === "object" && cursor !== null
        ? (cursor as Record<string, unknown>)
        : null;
    }

    const described = (node: unknown): boolean => {
      const resolved = deref(node);
      if (!resolved) return false;
      if (typeof resolved.description === "string" && resolved.description.length > 0) return true;
      // A bare array of refs, as recursive combinators produce, is documented
      // when the thing it points at is.
      if (resolved.items && !resolved.description) return described(resolved.items);
      return false;
    };

    function undocumented(node: unknown, path: string, out: string[]): void {
      if (typeof node !== "object" || node === null) return;
      const obj = node as Record<string, unknown>;

      const props = obj.properties as Record<string, unknown> | undefined;
      if (props) {
        for (const [key, sub] of Object.entries(props)) {
          if (!described(sub)) out.push(`${path}.${key}`);
          // Do not recurse through a $ref: its target is walked at its own site,
          // and following it here would loop forever on recursive schemas.
          if (typeof (sub as Record<string, unknown>).$ref !== "string") {
            undocumented(sub, `${path}.${key}`, out);
          }
        }
      }

      for (const key of ["items", "additionalProperties", "propertyNames", "not"]) {
        if (obj[key]) undocumented(obj[key], `${path}.${key}`, out);
      }
      for (const key of ["anyOf", "allOf", "oneOf", "prefixItems"]) {
        const arr = obj[key];
        if (Array.isArray(arr)) {
          arr.forEach((sub, i) => undocumented(sub, `${path}.${key}[${i}]`, out));
        }
      }
      const defs = obj.$defs as Record<string, unknown> | undefined;
      if (defs) {
        for (const [key, sub] of Object.entries(defs)) undocumented(sub, `$defs.${key}`, out);
      }
    }

    it("documents every property, so editor completions explain themselves", () => {
      const missing: string[] = [];
      undocumented(emitted, "", missing);
      if (missing.length > 0) {
        throw new Error(
          `${missing.length} schema propert${missing.length === 1 ? "y has" : "ies have"} no description; ` +
            `an author hovering these sees nothing:\n${missing.map((m) => `  ${m}`).join("\n")}`,
        );
      }
      expect(missing).toEqual([]);
    });

    it("documents the top-level fields an author meets first", () => {
      const props = emitted.properties as Record<string, { description?: string }>;
      for (const key of [
        "schemaVersion",
        "id",
        "title",
        "license",
        "capabilities",
        "vocabulary",
        "tables",
        "phases",
        "modes",
        "defaultMode",
        "targeting",
      ]) {
        expect(props[key]?.description, `${key} needs a description`).toBeTruthy();
      }
    });

    it("carries the pack-level description on the document itself", () => {
      expect(emitted.description).toContain("game");
    });
  });
});

async function importYaml() {
  return await import("yaml");
}
