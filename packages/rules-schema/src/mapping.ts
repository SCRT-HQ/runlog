import { z } from "zod";
import { PackId } from "./primitives.ts";
import type { Diagnostic } from "./lint.ts";

/**
 * A mapping: what a tool should do about what the dice said.
 *
 * This existed already, as a block inside a control profile written
 * against one pack, matching mostly by entry id. That works and it does
 * not travel: a hundred and forty rows naming this pack's entries are a
 * hundred and forty rows that mean nothing to the next Elden Ring pack
 * somebody writes, and the second pack starts from nothing.
 *
 * So a mapping is its own document, written for a tool and bound to
 * marks rather than to entries. `curse` means something in any pack that
 * declares it as a mark, and a mapping that fires on `curse` fits every
 * one of them. That is the whole reason `marks` exists: a tag is only
 * something to bind to once a pack has promised to keep the word.
 *
 * Held against a pack it would be none of those things, which is the
 * same argument the setup document makes, for the same reason.
 */

/** One thing to do, in the tool's own vocabulary. */
export const MappingOp = z
  .object({
    op: z
      .string()
      .min(1)
      .max(64)
      .describe(
        "The operation, in the tool's own words: `speffect.apply`, `runes.give`. A tool refuses by name anything its build does not have.",
      ),
    args: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("What the operation takes. Its shape is the tool's business, not this format's."),
  })
  .strict();

export type MappingOp = z.infer<typeof MappingOp>;

/**
 * One rule: what it fires on, and what it does.
 *
 * A mark, not an entry. Matching an entry is what tied the old profiles
 * to one pack, and a mapping that names no pack cannot name a pack's
 * entries. Where a rule really is about one particular result, that rule
 * belongs in a profile for that pack rather than here.
 */
export const MappingRule = z
  .object({
    mark: z.string().min(1).max(40).describe("The mark this fires on. Any pack that declares it and carries it will set this off."),
    label: z.string().min(1).max(120).optional().describe("What to call this rule in a list, where the mark alone is not enough."),
    for: z.number().int().positive().max(86_400).optional().describe("Seconds it lasts. Absent and without `until`, it does not come off."),
    until: z.literal("unit").optional().describe("Lasts until the unit it landed in closes."),
    to: z.string().min(1).max(40).optional().describe("One seat's name, or absent for everybody at the table."),
    ops: z.array(MappingOp).min(1).max(50).describe("What to do when it fires, in order."),
  })
  .strict()
  .refine((r) => !(r.for !== undefined && r.until !== undefined), {
    message: "a rule lasts for seconds or until the unit closes, not both",
  });

export type MappingRule = z.infer<typeof MappingRule>;

export const Mapping = z
  .object({
    kind: z.literal("mapping").describe("What this document is. A pack says nothing, a setup says `setup`, this says `mapping`."),
    schemaVersion: z.number().int().positive().describe("The format's major version, as a pack carries one."),
    id: PackId.describe("Reverse-domain id: `com.example.mappings.elden-ring`."),
    version: z.string().min(1).describe("Semantic version. A mapping that changes what it does changes this."),
    title: z.string().min(1).max(120).describe("What it is called, on a card and in a chooser."),
    author: z.string().max(120).optional().describe("Who wrote it. A mapping travels on its own, so this is the only credit it carries."),
    description: z.string().max(2000).optional().describe("What playing under it is like, in a line or two."),
    tool: z.string().min(1).max(64).describe("The tool this is for, by the name that tool calls itself when it attaches."),
    /**
     * Which packs this was written against.
     *
     * A note, not a gate. A mapping binds to marks and fires on any pack
     * that carries them, which is the point; this is the author saying
     * which packs they actually tried, so a chooser can put the ones
     * written for your game first instead of listing everything.
     */
    packs: z
      .array(PackId)
      .max(50)
      .optional()
      .describe(
        "Packs the author wrote this against, so a chooser can offer the likely ones first. Not a restriction: a mapping fires on any pack carrying the marks it names.",
      ),
    rules: z.array(MappingRule).min(1).max(500).describe("The rules, in order. Every one that matches fires."),
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
    "What a tool attached to the game should do about what the dice said, bound to the marks a pack declares rather than to one pack's entries, so one mapping fits every pack for the same game.",
  );

export type Mapping = z.infer<typeof Mapping>;

export type MappingResult =
  { ok: true; mapping: Mapping; diagnostics: Diagnostic[] } | { ok: false; mapping: null; diagnostics: Diagnostic[] };

/** The major version of this format that this build understands. */
export const MAPPING_SCHEMA_VERSION = 1;

/**
 * Validate an untrusted object into a Mapping.
 *
 * The same two gates a setup gets, and for the same reason: there is no
 * coherence pass because there is nothing here to be incoherent about.
 * Whether a mark exists is a question about a pack, and a mapping names
 * no pack; whether an operation exists is a question only the tool can
 * answer.
 */
export function parseMapping(input: unknown): MappingResult {
  const fail = (code: string, message: string, path = ""): MappingResult => ({
    ok: false,
    mapping: null,
    diagnostics: [{ level: "error", code, path, message }],
  });

  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("mapping/shape", "a mapping is an object");
  const raw = input as Record<string, unknown>;

  if (raw["kind"] !== "mapping")
    return fail("mapping/kind", `this is not a mapping: kind is ${JSON.stringify(raw["kind"]) ?? "missing"}`, "kind");

  const version = raw["schemaVersion"];
  if (version !== MAPPING_SCHEMA_VERSION) {
    return fail(
      "mapping/version",
      `this build reads schemaVersion ${MAPPING_SCHEMA_VERSION}, and this says ${JSON.stringify(version) ?? "nothing"}`,
      "schemaVersion",
    );
  }

  const parsed = Mapping.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      mapping: null,
      diagnostics: parsed.error.issues.map((issue) => ({
        level: "error" as const,
        code: `mapping/${issue.code}`,
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  return { ok: true, mapping: parsed.data, diagnostics: [] };
}

/** Whether a document claims to be a mapping, for a reader holding one file and no idea which. */
export function looksLikeMapping(input: unknown): boolean {
  return typeof input === "object" && input !== null && !Array.isArray(input) && (input as Record<string, unknown>)["kind"] === "mapping";
}

/**
 * Which marks a mapping needs, for holding one against a pack.
 *
 * The check nobody can do inside either document: a mapping fires on
 * marks and a pack declares them, so the answer to "will this do anything
 * for that pack" is the overlap. A chooser uses it to say so before
 * somebody plays an hour to find out.
 */
export function marksUsed(mapping: Mapping): string[] {
  return [...new Set(mapping.rules.map((r) => r.mark))].sort();
}

/** What a mapping would and would not do for a pack, by the marks each names. */
export function against(mapping: Mapping, declared: readonly string[]): { fires: string[]; idle: string[] } {
  const has = new Set(declared);
  const used = marksUsed(mapping);
  return { fires: used.filter((m) => has.has(m)), idle: used.filter((m) => !has.has(m)) };
}
