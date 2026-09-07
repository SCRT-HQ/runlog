/**
 * Emit the field-by-field reference from the published JSON Schema.
 *
 * Every field already carries a `.describe()`, because those descriptions are
 * what an editor shows while someone is typing a pack. Writing them out a
 * second time by hand would produce a document that is wrong within a month
 * and wrong in the worst way: confidently, in the place people go to check.
 *
 * So the reference is generated, and a test fails if the committed copy has
 * fallen behind. The prose that explains *why* you would want any of this
 * lives in docs/authoring.md, written by a person.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "../src/pack.ts";

const here = dirname(fileURLToPath(import.meta.url));
const schemaFile = join(here, "..", "schema", `pack-${SCHEMA_VERSION}.schema.json`);
const outFile = join(here, "..", "..", "..", "docs", "reference.md");

type Node = Record<string, unknown>;

const schema = JSON.parse(readFileSync(schemaFile, "utf8")) as Node;
const defs = (schema.$defs ?? {}) as Record<string, Node>;

/** Follow a `$ref` to the definition it names. */
function deref(node: Node): Node {
  const ref = node.$ref;
  if (typeof ref !== "string") return node;
  const name = ref.replace("#/$defs/", "");
  return defs[name] ?? node;
}

/**
 * A short type for the table: enough to know what to type, not a second copy
 * of the schema. Deep structures link to their own section instead.
 */
function typeOf(node: Node): string {
  if (typeof node.$ref === "string") {
    const name = node.$ref.replace("#/$defs/", "");
    return `[${name}](#${anchor(name)})`;
  }
  if (Array.isArray(node.enum)) {
    return node.enum.map((v) => `\`${String(v)}\``).join(" \\| ");
  }
  if (typeof node.const === "string") return `\`${node.const}\``;

  const union = (node.anyOf ?? node.oneOf) as Node[] | undefined;
  if (Array.isArray(union)) {
    const parts = union.map(typeOf).filter((p) => p !== "`null`");
    return [...new Set(parts)].join(" \\| ");
  }
  if (node.type === "array") {
    return `${typeOf((node.items ?? {}) as Node)}[]`;
  }
  if (node.type === "object" && node.additionalProperties) {
    return `map of ${typeOf(node.additionalProperties as Node)}`;
  }
  if (typeof node.type === "string") return `\`${node.type}\``;
  return "—";
}

const anchor = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** One sentence per field. Newlines would break the table row. */
function describe(node: Node): string {
  const own = typeof node.description === "string" ? node.description : "";
  const inherited = typeof node.$ref === "string" ? "" : "";
  const text = (own || inherited).replace(/\s+/g, " ").trim();
  const withDefault =
    node.default !== undefined
      ? `${text} Default: \`${JSON.stringify(node.default)}\`.`
      : text;
  return withDefault.replace(/\|/g, "\\|");
}

function table(node: Node): string[] {
  const props = (node.properties ?? {}) as Record<string, Node>;
  const names = Object.keys(props);
  if (names.length === 0) return [];

  const required = new Set((node.required as string[] | undefined) ?? []);
  const lines = ["| Field | Type | Required | What it does |", "| --- | --- | --- | --- |"];
  for (const name of names) {
    const field = props[name]!;
    lines.push(
      `| \`${name}\` | ${typeOf(field)} | ${required.has(name) ? "yes" : "—"} | ${describe(field)} |`,
    );
  }
  return lines;
}

/**
 * Sections to document, gathered by walking the schema.
 *
 * Zod inlines almost everything rather than emitting `$ref`s, so the shapes an
 * author actually types — a table, a phase, a step — exist only nested inside
 * the root. Without this walk the reference would say "object" nineteen times
 * and document none of them. Sections are named by the path that reaches them,
 * because that is how an author finds the thing in their own file.
 */
interface Section {
  path: string;
  node: Node;
}

const sections: Section[] = [];
const seen = new Set<string>();

function collect(node: Node, path: string, depth: number): void {
  // Deep enough to reach a checklist item's own fields: phases → steps →
  // a step → checklist → an item. Anything deeper is not a shape an author
  // types by hand.
  if (depth > 5) return;
  const resolved = deref(node);

  // A `$ref` already has a section of its own under Definitions.
  if (typeof node.$ref === "string") return;

  const props = (resolved.properties ?? {}) as Record<string, Node>;
  if (Object.keys(props).length > 0) {
    // A variant whose only field is the literal that selects it says nothing a
    // one-line entry in the union list does not. Twenty such sections bury the
    // shapes that do have something to document.
    const onlyDiscriminant =
      Object.keys(props).length === 1 && variantLabel(resolved) !== null;
    if (onlyDiscriminant) return;

    if (!seen.has(path)) {
      seen.add(path);
      sections.push({ path, node: resolved });
      for (const [name, child] of Object.entries(props)) {
        collect(child, `${path}.${name}`, depth + 1);
      }
    }
    return;
  }

  if (resolved.type === "array" && resolved.items) {
    collect(resolved.items as Node, `${path}[]`, depth);
    return;
  }
  if (resolved.type === "object" && resolved.additionalProperties) {
    collect(resolved.additionalProperties as Node, `${path}.*`, depth);
    return;
  }

  const union = (resolved.anyOf ?? resolved.oneOf) as Node[] | undefined;
  if (Array.isArray(union)) {
    // A discriminated union: each variant is a shape in its own right, named
    // by the literal that selects it where there is one.
    union.forEach((variant, i) => {
      const label = variantLabel(variant) ?? String(i);
      collect(variant, `${path} (${label})`, depth + 1);
    });
  }
}

/** The literal that picks a variant out of a union, e.g. `kind: rollTable`. */
function variantLabel(variant: Node): string | null {
  const props = (deref(variant).properties ?? {}) as Record<string, Node>;
  for (const key of ["kind", "do", "on", "resolution", "strategy", "anchor"]) {
    const value = props[key];
    if (value && typeof value.const === "string") return `${key}: ${value.const}`;
    if (value && Array.isArray(value.enum) && value.enum.length === 1) {
      return `${key}: ${String(value.enum[0])}`;
    }
  }
  return null;
}

/**
 * Document shapes that live inside a variant's own fields.
 *
 * A `branch` action's `cases` and a target reference's `{ var: … }` form are
 * things an author types constantly, and both exist only nested inside a union
 * variant. Without this they were named in no table anywhere.
 */
const documentedShapes = new Set<string>();

function emitNested(node: Node, prefix: string, depth: number): void {
  if (depth > 1) return;
  const props = (node.properties ?? {}) as Record<string, Node>;

  for (const [field, raw] of Object.entries(props)) {
    let child = deref(raw);
    let path = `${prefix}.${field}`;

    if (child.type === "array" && child.items) {
      child = deref(child.items as Node);
      path = `${path}[]`;
    }

    const shapes: Array<[string, Node]> = [];
    const union = (child.anyOf ?? child.oneOf) as Node[] | undefined;
    if (Array.isArray(union)) {
      for (const variant of union) {
        const resolved = deref(variant);
        if (Object.keys((resolved.properties ?? {}) as object).length === 0) continue;
        const label = variantLabel(variant);
        shapes.push([label ? `${path} (${label})` : path, resolved]);
      }
    } else if (Object.keys((child.properties ?? {}) as object).length > 0) {
      shapes.push([path, child]);
    }

    for (const [shapePath, shape] of shapes) {
      const rows = table(shape);
      if (rows.length === 0) continue;
      // Deduped by shape, not by path. The same target reference is accepted
      // by a dozen actions; documenting it a dozen times buries everything
      // else and tells the reader nothing new the other eleven times.
      const shapeKey = JSON.stringify(shape);
      if (documentedShapes.has(shapeKey)) continue;
      documentedShapes.add(shapeKey);
      out.push(`##### \`${shapePath}\``);
      out.push("");
      const summary = shape.description;
      if (typeof summary === "string") {
        out.push(summary.replace(/\s+/g, " ").trim());
        out.push("");
      }
      out.push(...rows);
      out.push("");
      emitNested(shape, shapePath, depth + 1);
    }
  }
}

const out: string[] = [];

out.push("<!-- Generated by packages/rules-schema/scripts/emit-reference.ts. Do not edit. -->");
out.push("");
out.push(`# Pack reference (schema version ${SCHEMA_VERSION})`);
out.push("");
out.push(
  "Every field the format accepts, taken from the schema your editor validates " +
    "against, so this cannot drift from what actually loads. For *why* you would " +
    "reach for any of it, read [the authoring guide](authoring.md).",
);
out.push("");
out.push("Point your pack at the schema and most of this becomes autocomplete:");
out.push("");
out.push("```yaml");
out.push(`# yaml-language-server: $schema=https://runlog.dev/schema/pack-${SCHEMA_VERSION}.schema.json`);
out.push("```");
out.push("");

collect(schema, "pack", 0);

for (const { path, node } of sections) {
  out.push(path === "pack" ? "## The pack" : `## \`${path}\``);
  out.push("");
  const description = typeof node.description === "string" ? node.description : "";
  if (description) {
    out.push(description.replace(/\s+/g, " ").trim());
    out.push("");
  }
  out.push(...table(node));
  out.push("");
}

out.push("## Shared definitions");
out.push("");
out.push(
  "These two recurse, so they are defined once and referenced from everywhere " +
    "they are accepted.",
);
out.push("");

for (const [name, node] of Object.entries(defs).sort(([a], [b]) => a.localeCompare(b))) {
  const resolved = deref(node);
  out.push(`### ${name}`);
  out.push("");
  const description = typeof resolved.description === "string" ? resolved.description : "";
  if (description) {
    out.push(description.replace(/\s+/g, " ").trim());
    out.push("");
  }

  const union = (resolved.anyOf ?? resolved.oneOf) as Node[] | undefined;
  if (Array.isArray(union)) {
    // A contents list first: an author usually arrives knowing roughly what
    // they want and needing the exact spelling of it.
    for (const variant of union) {
      const label = variantLabel(variant);
      const summary = deref(variant).description;
      out.push(
        `- ${label ? "`" + label + "`" : typeOf(variant)}${
          typeof summary === "string" ? ` — ${summary.replace(/\s+/g, " ").trim()}` : ""
        }`,
      );
    }
    out.push("");

    // Then every variant in full. These are the fields an author actually
    // types; leaving them to a bullet list documented none of them.
    for (const variant of union) {
      const resolvedVariant = deref(variant);
      const rows = table(resolvedVariant);
      if (rows.length === 0) continue;
      const label = variantLabel(variant);
      out.push(`#### ${label ? "`" + label + "`" : typeOf(variant)}`);
      out.push("");
      const summary = resolvedVariant.description;
      if (typeof summary === "string") {
        out.push(summary.replace(/\s+/g, " ").trim());
        out.push("");
      }
      out.push(...rows);
      out.push("");
      emitNested(resolvedVariant, label ? `${name} (${label})` : name, 0);
    }
    continue;
  }

  const rows = table(resolved);
  if (rows.length > 0) {
    out.push(...rows);
    out.push("");
  }
}

mkdirSync(dirname(outFile), { recursive: true });
const NL = "\n";
// Collapse runs of blank lines the section walk leaves behind.
const document = out.join(NL).replace(/\n{3,}/g, `${NL}${NL}`);
writeFileSync(outFile, `${document}${NL}`, "utf8");
console.log(`wrote ${outFile}`);
