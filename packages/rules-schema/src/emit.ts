import { z } from "zod";
import { Pack, SCHEMA_VERSION } from "./pack.ts";

/**
 * Building the published JSON Schema.
 *
 * This lives in `src` rather than in the script that writes the file because
 * two callers need it: the script, and the test that checks the committed copy
 * is not stale. When the test had its own copy of these three lines, adding a
 * step to the script silently stopped the test checking the thing it shipped: 
 * which is the exact failure the staleness test exists to prevent.
 */

/**
 * Real names for the recursive definitions.
 *
 * `Action` and `Predicate` recurse through `z.lazy`, so Zod hoists them into
 * `$defs` under generated names like `__schema0`. Those names reach the
 * published schema, where they are what an editor puts in a validation message
 * and what the generated reference has to title a section. Renaming is
 * cosmetic for the validator and load-bearing for anyone reading it.
 */
const DEF_NAMES: Array<[RegExp, string]> = [
  [/^One step of behavior/, "Action"],
  [/^A condition evaluated against run state/, "Predicate"],
];

function nameDefinitions(schema: Record<string, unknown>): Record<string, unknown> {
  const defs = (schema.$defs ?? {}) as Record<string, { description?: string }>;
  const renames = new Map<string, string>();

  for (const [generated, def] of Object.entries(defs)) {
    if (!/^__schema\d+$/.test(generated)) continue;
    const match = DEF_NAMES.find(([pattern]) => pattern.test(def.description ?? ""));
    if (!match) {
      // Better to stop than to publish a schema with a section called
      // __schema3 and leave the next reader to guess what it was.
      throw new Error(
        `unnamed definition ${generated} with description ` +
          `${JSON.stringify((def.description ?? "").slice(0, 60))}; add it to DEF_NAMES in emit.ts`,
      );
    }
    renames.set(generated, match[1]!);
  }

  if (renames.size === 0) return schema;

  let text = JSON.stringify(schema);
  for (const [generated, name] of renames) {
    // These names appear as a `$defs` key and inside every `$ref` aimed at
    // them, so both forms are replaced as whole tokens.
    text = text.split(`"${generated}"`).join(`"${name}"`);
    text = text.split(`#/$defs/${generated}`).join(`#/$defs/${name}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** The schema body, exactly as published minus the `$id` and `title` wrapper. */
export function buildSchemaBody(): Record<string, unknown> {
  const generated = z.toJSONSchema(Pack, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  });
  return nameDefinitions(generated as Record<string, unknown>);
}

/** The complete published document. */
export function buildSchemaDocument(): Record<string, unknown> {
  return {
    $id: `https://runlog.dev/schema/pack-${SCHEMA_VERSION}.schema.json`,
    title: `Runlog rule pack (schema version ${SCHEMA_VERSION})`,
    description:
      "A declarative description of a dice-driven creative-practice game: its tables, " +
      "decks, states, counters, phases and modes. Packs are data, never code.",
    ...buildSchemaBody(),
  };
}
