import { z } from "zod";
import { Pack, SCHEMA_VERSION } from "./pack.ts";
import { Setup, SETUP_SCHEMA_VERSION } from "./setup.ts";
import { Mapping, MAPPING_SCHEMA_VERSION } from "./mapping.ts";
import { SharedTables, SHARED_TABLES_SCHEMA_VERSION } from "./shared-tables.ts";
import { schemaUrl } from "./published.ts";

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
    $id: schemaUrl("pack"),
    title: `Runlog rule pack (schema version ${SCHEMA_VERSION})`,
    description:
      "A declarative description of a dice-driven creative-practice game: its tables, " +
      "decks, states, counters, phases and modes. Packs are data, never code.",
    ...buildSchemaBody(),
  };
}

/**
 * The same, for a setup.
 *
 * A setup is a document somebody writes by hand in YAML, exactly as a
 * pack is, so it gets the same help: point an editor at this and the
 * field names complete themselves and a typo is underlined where it was
 * made rather than found an hour into somebody's run.
 *
 * No renaming pass is needed here. Nothing in a setup recurses, so Zod
 * has no anonymous definitions to hoist and name.
 */
export function buildSetupSchemaBody(): Record<string, unknown> {
  return z.toJSONSchema(Setup, { target: "draft-2020-12", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}

/** The complete published document, as `buildSchemaDocument` is for a pack. */
export function buildSetupSchemaDocument(): Record<string, unknown> {
  return {
    $id: schemaUrl("setup"),
    title: `Runlog setup (schema version ${SETUP_SCHEMA_VERSION})`,
    description:
      "What a tool attached to the game is set to while a run lasts, and what the player is handed " +
      "to start with. Written for a tool rather than for a pack, so one fits every pack for the same game.",
    ...buildSetupSchemaBody(),
  };
}

/** The same again, for a mapping. Nothing in one recurses either. */
export function buildMappingSchemaBody(): Record<string, unknown> {
  return z.toJSONSchema(Mapping, { target: "draft-2020-12", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}

export function buildMappingSchemaDocument(): Record<string, unknown> {
  return {
    $id: schemaUrl("mapping"),
    title: `Runlog mapping (schema version ${MAPPING_SCHEMA_VERSION})`,
    ...buildMappingSchemaBody(),
  };
}

/** And for a shared table set. */
export function buildTablesSchemaBody(): Record<string, unknown> {
  return z.toJSONSchema(SharedTables, { target: "draft-2020-12", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}

export function buildTablesSchemaDocument(): Record<string, unknown> {
  return {
    $id: schemaUrl("tables"),
    title: `Runlog shared tables (schema version ${SHARED_TABLES_SCHEMA_VERSION})`,
    ...buildTablesSchemaBody(),
  };
}
