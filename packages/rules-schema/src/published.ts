import { SCHEMA_VERSION } from "./pack.ts";
import { SETUP_SCHEMA_VERSION } from "./setup.ts";

/**
 * Where the published JSON Schemas live.
 *
 * In one place because it was in eight, spelled from memory, and the
 * spelling was wrong: `runlog.dev` is somebody else's domain and always
 * was. It sat in the `$id` of the published schema, in the skeleton the
 * CLI writes, in the generated reference and at the top of every pack in
 * this repository, sending anyone who followed the instructions to a
 * stranger's website.
 *
 * So there is one function that says the address and everything asks it.
 * A schema's URL is part of its contract, and a contract typed out by
 * hand in eight files is eight chances to get it wrong.
 */
const HOME = "https://runlog.scrthq.com/schema";

/** The published address of a schema, which is also its `$id`. */
export function schemaUrl(kind: "pack" | "setup"): string {
  return `${HOME}/${kind}-${kind === "pack" ? SCHEMA_VERSION : SETUP_SCHEMA_VERSION}.schema.json`;
}

/**
 * The line that points an editor at it.
 *
 * `relativeTo` is for a file inside this repository, which has the schema
 * on disk two directories up and does not need the network, a deploy or a
 * domain to be right. Everyone else gets the address.
 */
export function schemaLine(kind: "pack" | "setup", relativeTo?: string): string {
  return `# yaml-language-server: $schema=${relativeTo ? `${relativeTo}/${kind}-${kind === "pack" ? SCHEMA_VERSION : SETUP_SCHEMA_VERSION}.schema.json` : schemaUrl(kind)}`;
}

/** Where a pack or setup in this repository finds the schema, from its own directory. */
export const SCHEMA_IN_REPO = "../../packages/rules-schema/schema";
