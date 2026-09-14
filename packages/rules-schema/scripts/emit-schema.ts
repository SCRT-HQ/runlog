/**
 * Emit the published JSON Schema from the Zod definition.
 *
 * Zod is the single source of truth: the engine validates against it at
 * runtime, and this script derives the JSON Schema that pack authors point
 * their editor at. Keeping one source means the schema an author autocompletes
 * against cannot drift from the one the app enforces.
 *
 * The building itself is in `src/emit.ts`, so the staleness test checks the
 * same pipeline that writes the file rather than a copy of it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchemaDocument, buildSetupSchemaDocument, buildMappingSchemaDocument, buildTablesSchemaDocument } from "../src/emit.ts";
import { SCHEMA_VERSION } from "../src/pack.ts";
import { SETUP_SCHEMA_VERSION } from "../src/setup.ts";
import { MAPPING_SCHEMA_VERSION } from "../src/mapping.ts";
import { SHARED_TABLES_SCHEMA_VERSION } from "../src/shared-tables.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "schema");
mkdirSync(outDir, { recursive: true });

for (const [name, document] of [
  [`pack-${SCHEMA_VERSION}.schema.json`, buildSchemaDocument()],
  [`setup-${SETUP_SCHEMA_VERSION}.schema.json`, buildSetupSchemaDocument()],
  [`mapping-${MAPPING_SCHEMA_VERSION}.schema.json`, buildMappingSchemaDocument()],
  [`tables-${SHARED_TABLES_SCHEMA_VERSION}.schema.json`, buildTablesSchemaDocument()],
] as const) {
  const outFile = join(outDir, name);
  writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(`wrote ${outFile}`);
}
