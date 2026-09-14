import { z } from "zod";
import { DiceExpr, PackId } from "./primitives.ts";
import { LookupEntry } from "./tables.ts";
import type { Pack } from "./pack.ts";
import type { Diagnostic } from "./lint.ts";

/**
 * A table somebody wrote once, for everybody.
 *
 * The same argument the setup and the mapping documents make. A hundred
 * good Elden Ring curses are a hundred good Elden Ring curses whoever
 * wrote the pack, and copying them into the next pack means the next
 * author maintains a fork of them for ever: a fix to one is a fix to one.
 *
 * Variants are the part that is not obvious. A shared table is rarely one
 * table; it is the same table pitched three ways, because the person who
 * wrote it plays it harsh and somebody else does not. Holding them in one
 * document keeps them together, so a pack can say "these curses, the
 * gentle set" and a run can say "no, the harsh set" without either of
 * them forking anything.
 */

export const TableVariant = z
  .object({
    title: z.string().min(1).max(120).describe("What this pitch of the table is called, where somebody is choosing between them."),
    description: z.string().max(500).optional().describe("Who it is for and how hard it is, in a line."),
    roll: DiceExpr.describe("What is rolled. The entries must cover its whole range, as in a pack's own table."),
    entries: z.array(LookupEntry).min(1).max(1000).describe("The results, each owning a span of the roll."),
  })
  .strict();

export type TableVariant = z.infer<typeof TableVariant>;

export const SharedTables = z
  .object({
    kind: z.literal("tables").describe("What this document is. A pack says nothing; this says `tables`."),
    schemaVersion: z.number().int().positive().describe("The format's major version, as a pack carries one."),
    id: PackId.describe("Reverse-domain id: `com.example.tables.elden-curses`."),
    version: z.string().min(1).describe("Semantic version. Entries changing changes this, or nobody holding it is offered the new ones."),
    title: z.string().min(1).max(120).describe("What the set is called."),
    author: z.string().max(120).optional(),
    description: z.string().max(2000).optional().describe("What is in it, and who it is for."),
    /**
     * Which pitch of the table to use when nobody says.
     *
     * Required rather than "the first one", because the order of a record
     * is not something an author should have to think about and is not
     * something a reader should have to guess.
     */
    defaultVariant: z.string().min(1).max(60).describe("The variant used when a pack or a run does not name one."),
    variants: z
      .record(z.string().min(1).max(60), TableVariant)
      .describe("The same table pitched more than one way, by a short name: `gentle`, `harsh`."),
    license: z
      .object({
        id: z.string().min(1).describe("An SPDX identifier where there is one, else whatever name the terms go by."),
        redistributable: z.boolean().describe("Whether somebody may pass this on."),
      })
      .strict()
      .optional(),
  })
  .strict()
  .describe(
    "Tables written once and used by any pack: the same set pitched several ways, so a pack can choose one and a run can choose another.",
  );

export type SharedTables = z.infer<typeof SharedTables>;

export type SharedTablesResult =
  { ok: true; tables: SharedTables; diagnostics: Diagnostic[] } | { ok: false; tables: null; diagnostics: Diagnostic[] };

export const SHARED_TABLES_SCHEMA_VERSION = 1;

export function parseSharedTables(input: unknown): SharedTablesResult {
  const fail = (code: string, message: string, path = ""): SharedTablesResult => ({
    ok: false,
    tables: null,
    diagnostics: [{ level: "error", code, path, message }],
  });

  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("tables/shape", "a table set is an object");
  const raw = input as Record<string, unknown>;
  if (raw["kind"] !== "tables")
    return fail("tables/kind", `this is not a table set: kind is ${JSON.stringify(raw["kind"]) ?? "missing"}`, "kind");

  const version = raw["schemaVersion"];
  if (version !== SHARED_TABLES_SCHEMA_VERSION) {
    return fail(
      "tables/version",
      `this build reads schemaVersion ${SHARED_TABLES_SCHEMA_VERSION}, and this says ${JSON.stringify(version) ?? "nothing"}`,
      "schemaVersion",
    );
  }

  const parsed = SharedTables.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      tables: null,
      diagnostics: parsed.error.issues.map((issue) => ({
        level: "error" as const,
        code: `tables/${issue.code}`,
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  // A default naming a variant that is not there is the one incoherence
  // this document can have, and it is worth catching: every pack using it
  // and saying nothing would roll on nothing.
  const doc = parsed.data;
  if (!doc.variants[doc.defaultVariant]) {
    return fail(
      "tables/default",
      `defaultVariant is ${doc.defaultVariant}, which is not one of: ${Object.keys(doc.variants).join(", ") || "none"}`,
      "defaultVariant",
    );
  }

  return { ok: true, tables: doc, diagnostics: [] };
}

/** Whether a document claims to be a shared table set. */
export function looksLikeSharedTables(input: unknown): boolean {
  return typeof input === "object" && input !== null && !Array.isArray(input) && (input as Record<string, unknown>)["kind"] === "tables";
}

/**
 * Fold borrowed tables into a pack's own.
 *
 * Done here, at the edge, rather than anywhere downstream. The engine
 * rolls on `pack.tables[id].entries` and should never learn that some of
 * those entries came from somewhere else; a reference that survived into
 * the engine would be a reference every reducer, linter and exporter had
 * to know about.
 *
 * `provide` is how the caller says what it has. The schema package cannot
 * fetch anything and should not try: the app has a shelf, the CLI has a
 * directory, and a test has a map.
 *
 * A run may override which variant it plays, which is what `choose` is
 * for: the same pack, the harsh curses tonight.
 */
export function resolveUses(
  pack: Pack,
  provide: (id: string) => SharedTables | null,
  choose: (use: { from: string; as: string }) => string | undefined = () => undefined,
): { pack: Pack; diagnostics: Diagnostic[] } {
  const uses = pack.use ?? [];
  if (uses.length === 0) return { pack, diagnostics: [] };

  const diagnostics: Diagnostic[] = [];
  const tables: Record<string, unknown> = { ...pack.tables };

  uses.forEach((use, i) => {
    const at = `use[${i}]`;
    const set = provide(use.from);
    if (!set) {
      // Not an error here: a pack whose borrowed set is not on this
      // device is a pack somebody has to go and get the set for, which
      // the app can say better than a parser can.
      diagnostics.push({
        level: "warning",
        code: "use/missing",
        path: at,
        message: `${use.from} is not here, so ${use.as} has only what this pack declares itself`,
      });
      return;
    }

    const wanted = choose(use) ?? use.variant ?? set.defaultVariant;
    const variant = set.variants[wanted];
    if (!variant) {
      diagnostics.push({
        level: "error",
        code: "use/variant",
        path: at,
        message: `${use.from} has no variant called ${wanted}; it has ${Object.keys(set.variants).join(", ")}`,
      });
      return;
    }

    const mine = tables[use.as] as { resolution?: string; entries?: unknown[] } | undefined;
    if (use.merge === "append" && mine && Array.isArray(mine.entries)) {
      /*
       * Appending is only honest between two lookup tables, and only
       * when the borrowed entries do not collide with the pack's own
       * ids. A silent overwrite here is a result that quietly stops
       * coming up, which is the same class of failure as the tag rename.
       */
      if (mine.resolution !== "lookup") {
        diagnostics.push({
          level: "error",
          code: "use/append",
          path: at,
          message: `${use.as} is a ${mine.resolution} table, and entries can only be appended to a lookup table`,
        });
        return;
      }
      const had = new Set((mine.entries as Array<{ id?: string }>).map((e) => e.id));
      const clashes = variant.entries.filter((e) => had.has(e.id)).map((e) => e.id);
      if (clashes.length > 0) {
        diagnostics.push({
          level: "error",
          code: "use/clash",
          path: at,
          message: `${use.as} already has entries called ${clashes.join(", ")}, which would be replaced rather than added`,
        });
        return;
      }
      tables[use.as] = { ...mine, entries: [...(mine.entries as unknown[]), ...variant.entries] };
      return;
    }

    tables[use.as] = {
      resolution: "lookup",
      title: variant.title,
      ...(variant.description ? { description: variant.description } : {}),
      roll: variant.roll,
      entries: variant.entries,
    };
  });

  return { pack: { ...pack, tables: tables as Pack["tables"] }, diagnostics };
}
