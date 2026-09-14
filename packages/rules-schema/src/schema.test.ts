import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Pack, SCHEMA_VERSION } from "./pack.ts";
import { SETUP_SCHEMA_VERSION } from "./setup.ts";
import { buildSchemaBody, buildSetupSchemaBody } from "./emit.ts";
import { SCHEMA_IN_REPO, schemaLine, schemaUrl, type SchemaKind } from "./published.ts";
import { loadPackText, loadSetupText } from "./load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "schema", `pack-${SCHEMA_VERSION}.schema.json`);
const repoRoot = join(here, "..", "..", "..");

const emitted = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
const setupSchemaPath = join(here, "..", "schema", `setup-${SETUP_SCHEMA_VERSION}.schema.json`);
const setupEmitted = JSON.parse(readFileSync(setupSchemaPath, "utf8")) as Record<string, unknown>;

// Deliberately the same function the emit script calls. A second copy of the
// pipeline here would let the script grow a step this test never sees, which
// is precisely what a staleness check must not allow.
const regenerate = buildSchemaBody;

/**
 * Walk every property in a schema and collect any a hover would show
 * nothing for. Descriptions are the entire documentation surface for an
 * author, so a missing one is a real defect rather than a nitpick.
 *
 * At module scope, and taking the document it is walking, because both
 * published schemas are checked this way and a copy per schema is how the
 * second one quietly stops being checked.
 */
/** Follow a local $ref, so a reference inherits its target's docs. */
function deref(node: unknown, root: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof node !== "object" || node === null) return null;
  const obj = node as Record<string, unknown>;
  const ref = obj.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/")) return obj;
  let cursor: unknown = root;
  for (const segment of ref.slice(2).split("/")) {
    if (typeof cursor !== "object" || cursor === null) return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "object" && cursor !== null ? (cursor as Record<string, unknown>) : null;
}

function described(node: unknown, root: Record<string, unknown>): boolean {
  const resolved = deref(node, root);
  if (!resolved) return false;
  if (typeof resolved.description === "string" && resolved.description.length > 0) return true;
  // A bare array of refs, as recursive combinators produce, is documented
  // when the thing it points at is.
  if (resolved.items && !resolved.description) return described(resolved.items, root);
  return false;
}

function undocumented(node: unknown, path: string, out: string[], root: Record<string, unknown>): void {
  if (typeof node !== "object" || node === null) return;
  const obj = node as Record<string, unknown>;

  const props = obj.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const [key, sub] of Object.entries(props)) {
      if (!described(sub, root)) out.push(`${path}.${key}`);
      // Do not recurse through a $ref: its target is walked at its own site,
      // and following it here would loop forever on recursive schemas.
      if (typeof (sub as Record<string, unknown>).$ref !== "string") undocumented(sub, `${path}.${key}`, out, root);
    }
  }

  for (const key of ["items", "additionalProperties", "propertyNames", "not"]) {
    if (obj[key]) undocumented(obj[key], `${path}.${key}`, out, root);
  }
  for (const key of ["anyOf", "allOf", "oneOf", "prefixItems"]) {
    const arr = obj[key];
    if (Array.isArray(arr)) arr.forEach((sub, i) => undocumented(sub, `${path}.${key}[${i}]`, out, root));
  }
  const defs = obj.$defs as Record<string, unknown> | undefined;
  if (defs) {
    for (const [key, sub] of Object.entries(defs)) undocumented(sub, `$defs.${key}`, out, root);
  }
}

/**
 * The published JSON Schema is what a pack author's editor reads. These tests
 * guard the two ways it can quietly stop being useful: drifting out of step
 * with the validator that actually runs, and losing the descriptions that make
 * completions self-explanatory.
 */
describe("the emitted JSON Schema", () => {
  it("is not stale: regenerating it produces the committed file", () => {
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
    it("documents every property, so editor completions explain themselves", () => {
      const missing: string[] = [];
      undocumented(emitted, "", missing, emitted);
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

/**
 * The setup schema, which is the other document somebody writes by hand.
 *
 * Same two failures to guard as the pack's, and one more that only a
 * second schema can have: an editor pointed at the wrong one of the two.
 * `kind` is what separates them, and it is a const in both, so a pack
 * validated against this fails at the first field rather than at the
 * fortieth.
 */
describe("the emitted setup schema", () => {
  it("is not stale: regenerating it produces the committed file", () => {
    const { $id, title, ...body } = setupEmitted;
    expect($id).toBe(schemaUrl("setup"));
    expect(title).toBeTypeOf("string");
    expect(body).toEqual(buildSetupSchemaBody());
  });

  it("agrees with the runtime validator about every setup we ship", async () => {
    const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
    const validate = ajv.compile(setupEmitted);
    const { parse } = await importYaml();
    const dir = join(repoRoot, "packs", "setups");

    const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
    expect(files.length, "there should be setups to check").toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(loadSetupText(source, "yaml").ok, `${file} should load`).toBe(true);
      // The raw authored document, not the parsed one: an author's editor
      // sees the text, so the text is what has to pass.
      if (!validate(parse(source))) {
        const said = (validate.errors ?? []).map((e) => `  ${e.instancePath || "<root>"} ${e.message}`);
        throw new Error([`${file} loads at runtime but fails the published schema:`, ...said].join("\n"));
      }
    }
  });

  it("refuses a pack, so an editor pointed at the wrong schema says so at once", async () => {
    const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
    const validate = ajv.compile(setupEmitted);
    const { parse } = await importYaml();
    const pack = parse(readFileSync(join(repoRoot, "packs", "demo", "pack.yaml"), "utf8"));
    expect(validate(pack)).toBe(false);
    expect((validate.errors ?? []).some((e) => e.instancePath === "/kind" || e.params?.["missingProperty"] === "kind")).toBe(true);
  });

  it("documents every property, so an author hovering one sees something", () => {
    const missing: string[] = [];
    undocumented(setupEmitted, "", missing, setupEmitted);
    expect(missing).toEqual([]);
  });
});

/**
 * Every file in this repository an author would copy carries the line
 * that points an editor at the schema.
 *
 * The line is the only reason the schemas are published at all. Docs that
 * tell somebody to add it, over examples that do not have it, teach the
 * opposite of what they say.
 */
describe("the files an author would copy", () => {
  /*
   * The relative form, not the address. These files sit two directories
   * above the schema on disk, so they need no network, no deploy and no
   * domain to be right, and the address they would otherwise carry is one
   * more place for it to be typed wrong. Authors outside this repository
   * get the address, from the docs and from `runlog init`.
   */
  const line = (kind: SchemaKind) => schemaLine(kind, SCHEMA_IN_REPO);

  /** Every authored document in the repository, and which schema it is. */
  const authored = (dir: string, into: Array<[string, SchemaKind]> = []): Array<[string, SchemaKind]> => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      // Not in the repository; a working copy may still hold one, and it
      // is nobody's business here either way.
      if (entry.isDirectory() && entry.name !== "private") authored(full, into);
      // The folder says which, which is also how somebody reading the
      // repository tells them apart.
      else if (entry.isFile() && entry.name.endsWith(".yaml")) {
        const folder = basename(dir);
        const kind: SchemaKind =
          folder === "setups" ? "setup" : folder === "mappings" ? "mapping" : folder === "tables" ? "tables" : "pack";
        into.push([full, kind]);
      }
    }
    return into;
  };

  const files = authored(join(repoRoot, "packs"));

  it("finds them, so an empty list is not a pass", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const [file, kind] of files) {
    it(`${relative(repoRoot, file).split("\\").join("/")} points an editor at the ${kind} schema`, () => {
      expect(readFileSync(file, "utf8")).toContain(line(kind));
    });
  }
});

async function importYaml() {
  return await import("yaml");
}
