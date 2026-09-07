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
import { buildSchemaDocument } from "../src/emit.ts";
import { SCHEMA_VERSION } from "../src/pack.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "schema");
const outFile = join(outDir, `pack-${SCHEMA_VERSION}.schema.json`);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, `${JSON.stringify(buildSchemaDocument(), null, 2)}\n`, "utf8");
console.log(`wrote ${outFile}`);
