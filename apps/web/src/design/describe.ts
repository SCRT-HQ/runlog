import schemaText from "../../../../packages/rules-schema/schema/pack-1.schema.json?raw";

/**
 * Help text for a field, taken from the published schema.
 *
 * Every field already carries a description, because that is what an editor
 * shows a pack author on hover. Writing a second set of labels here would mean
 * two descriptions of the same field, drifting apart from the day they were
 * written, and the one in the app, which is where a beginner actually is,
 * would be the one nobody remembered to update.
 *
 * The whole schema is bundled for this. It costs about 16KB compressed, which
 * is a fair price for help that cannot be wrong.
 */

type Node = Record<string, unknown>;

const schema = JSON.parse(schemaText) as Node;
const defs = (schema.$defs ?? {}) as Record<string, Node>;

function deref(node: Node | undefined): Node | undefined {
  if (!node) return undefined;
  const ref = node.$ref;
  if (typeof ref !== "string") return node;
  return defs[ref.replace("#/$defs/", "")];
}

/**
 * Step into a node by one path segment.
 *
 * Unions are searched rather than resolved: at the point a description is
 * wanted, the editor knows which variant it is showing, but the path does not
 * carry that. The first variant that has the field is the right answer often
 * enough: descriptions of a shared field agree across variants.
 */
function step(node: Node | undefined, segment: string): Node | undefined {
  const here = deref(node);
  if (!here) return undefined;

  if (segment === "[]") return deref(here.items as Node | undefined);
  if (segment === "*") return deref(here.additionalProperties as Node | undefined);

  const props = here.properties as Record<string, Node> | undefined;
  if (props?.[segment]) return deref(props[segment]);

  const union = (here.anyOf ?? here.oneOf) as Node[] | undefined;
  if (Array.isArray(union)) {
    for (const variant of union) {
      const found = step(variant, segment);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Split a dotted path into steps, turning map keys and array indices into
 * wildcards: `tables.prompt.entries[0].text` walks the same route as
 * `tables.anything.entries[9].text`, because the schema has one shape for all
 * of them.
 */
function segments(path: string): string[] {
  const out: string[] = [];
  for (const raw of path.split(".")) {
    const [, name, brackets] = /^([^[]*)((?:\[\d*\])*)$/.exec(raw) ?? [];
    if (name) out.push(name);
    if (brackets) for (let i = 0; i < brackets.split("[").length - 1; i++) out.push("[]");
  }
  return out;
}

/**
 * Look up a field's description.
 *
 * Wildcards are supplied by the caller for map keys: pass `tables.*.title`
 * rather than `tables.myTable.title`, since a concrete key is not in the
 * schema. Missing paths give undefined, and the editor simply shows no help
 * rather than an apology.
 */
export function describe(path: string): string | undefined {
  const steps = segments(path);
  // An empty path would otherwise return the whole pack's description, which
  // as help under an unnamed field says nothing and looks like a bug.
  if (steps.length === 0) return undefined;

  let node: Node | undefined = schema;
  for (const segment of steps) {
    node = step(node, segment);
    if (!node) return undefined;
  }
  const description = node?.description;
  return typeof description === "string" ? description : undefined;
}
