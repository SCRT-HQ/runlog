import { z } from "zod";
import { PackId } from "./primitives.ts";
import type { Diagnostic } from "./lint.ts";

/**
 * A setup: how a run is configured before the first roll.
 *
 * A pack says what the dice can do. A setup says what a tool attached to
 * the game is set to while the run lasts, and what the player is handed
 * to start with: no shields, half damage dealt, fifty thousand runes.
 *
 * It is its own document because it depends on none of the things a pack
 * depends on. The same setup fits every pack for the same game, a mode
 * can name a different one, and one person can write it and everybody
 * else can use it. Held against a pack it would be none of those.
 *
 * What it names is a tool and its operations, which is why it is not part
 * of the pack format: a pack that named `speffect.apply` would be a pack
 * that only plays with one Windows program attached to one game, and the
 * schema has a test against exactly that.
 */

/** One thing to do when a tool attaches. */
export const SetupOp = z
  .object({
    op: z
      .string()
      .min(1)
      .max(64)
      .describe(
        "The operation, in the tool's own vocabulary: `flag.set`, `runes.give`. A tool refuses by name anything its build does not have.",
      ),
    args: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("What the operation takes. Its shape is the tool's business, not this format's."),
    once: z
      .boolean()
      .optional()
      .describe(
        "Given one time in a run rather than every time a tool attaches. The terms go out on every attach, because a tool that restarted is holding none of them and a setting applied twice is the same setting. A gift is not: runes handed over on every reconnect is a different game by the third one.",
      ),
  })
  .strict();

export type SetupOp = z.infer<typeof SetupOp>;

export const Setup = z
  .object({
    kind: z.literal("setup").describe("What this document is. A pack says `pack`; this says `setup`."),
    schemaVersion: z.number().int().positive().describe("The format's major version, as a pack carries one."),
    id: PackId.describe("Reverse-domain id, the way a pack is identified: `com.example.setups.bare-handed`."),
    version: z
      .string()
      .min(1)
      .describe("Semantic version. A setup that changes what it does changes this, or nobody holding it is offered the new one."),
    title: z.string().min(1).max(120).describe("What it is called, on a card and in a chooser."),
    author: z
      .string()
      .max(120)
      .optional()
      .describe("Who wrote it, for a card and a list. A setup travels on its own, so this is the only credit it carries."),
    description: z.string().max(2000).optional().describe("What playing under it is like, in a line or two."),
    /**
     * Which tool this is written for.
     *
     * Operation names say nothing between programs: two tools for two
     * games could both have a `warp.position`, and a setup meant for one
     * of them reaching the other would move somebody for no reason. So a
     * setup names its tool, and anything else listening is sent nothing.
     */
    tool: z.string().min(1).max(64).describe("The tool this is for, by the name that tool calls itself when it attaches."),
    ops: z.array(SetupOp).min(1).max(200).describe("What to do when a tool attaches, in order."),
    license: z
      .object({
        id: z.string().min(1).describe("An SPDX identifier where there is one, else whatever name the terms go by."),
        redistributable: z.boolean().describe("Whether somebody may pass this on. False means it was shared with you, not given to you."),
      })
      .strict()
      .optional()
      .describe("As a pack carries one. Absent means the author said nothing, which is not the same as permission."),
  })
  .strict()
  .describe(
    "What a tool attached to the game is set to while a run lasts, and what the player is handed " +
      "to start with. Written for a tool rather than for a pack, so one fits every pack for the same game.",
  );

export type Setup = z.infer<typeof Setup>;

export type SetupResult = { ok: true; setup: Setup; diagnostics: Diagnostic[] } | { ok: false; setup: null; diagnostics: Diagnostic[] };

/** The major version of this format that this build understands. */
export const SETUP_SCHEMA_VERSION = 1;

/**
 * Validate an untrusted object into a Setup.
 *
 * Two gates rather than the pack's three: a version, and a shape. There
 * is no coherence pass because there is nothing here to be incoherent
 * about — a setup refers to nothing but its tool's vocabulary, and only
 * that tool can say whether it knows a name.
 */
export function parseSetup(input: unknown): SetupResult {
  const fail = (code: string, message: string, path = ""): SetupResult => ({
    ok: false,
    setup: null,
    diagnostics: [{ level: "error", code, path, message }],
  });

  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("setup/shape", "a setup is an object");
  const raw = input as Record<string, unknown>;

  if (raw["kind"] !== "setup")
    return fail("setup/kind", `this is not a setup: kind is ${JSON.stringify(raw["kind"]) ?? "missing"}`, "kind");

  const version = raw["schemaVersion"];
  if (version !== SETUP_SCHEMA_VERSION) {
    return fail(
      "setup/version",
      `this build reads schemaVersion ${SETUP_SCHEMA_VERSION}, and this says ${JSON.stringify(version) ?? "nothing"}`,
      "schemaVersion",
    );
  }

  const parsed = Setup.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      setup: null,
      diagnostics: parsed.error.issues.map((issue) => ({
        level: "error" as const,
        code: `setup/${issue.code}`,
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  return { ok: true, setup: parsed.data, diagnostics: [] };
}

/** Whether a document claims to be a setup, for a reader holding one file and no idea which. */
export function looksLikeSetup(input: unknown): boolean {
  return typeof input === "object" && input !== null && !Array.isArray(input) && (input as Record<string, unknown>)["kind"] === "setup";
}
