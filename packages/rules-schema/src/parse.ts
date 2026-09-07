import { Pack, SCHEMA_VERSION } from "./pack.ts";
import { hasErrors, lintPack, type Diagnostic } from "./lint.ts";

/** Schema major versions this build of the engine can load. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [SCHEMA_VERSION];

/** Capabilities this build implements. */
export const IMPLEMENTED_CAPABILITIES = [
  "deferredTriggers",
  "seededRuns",
  "decks",
  "standardDeck",
  "resources",
  "counters",
  "coopRoles",
  "backwardTargeting",
  "timers",
  "journal",
  "bandsResolution",
  "opposedResolution",
  "keyedResolution",
  "moderated",
] as const;

export type ParseResult =
  | { ok: true; pack: Pack; diagnostics: Diagnostic[] }
  | { ok: false; pack: null; diagnostics: Diagnostic[] };

/**
 * Validate an untrusted object into a Pack.
 *
 * Three gates, in order, because each one makes the next meaningful:
 *
 *  1. **Version.** An unknown major version is refused outright. Guessing at a
 *     format we do not know would risk misplaying somebody's game, and quietly
 *     playing a game wrong is worse than refusing to play it.
 *  2. **Shape.** Zod, in strict mode — unknown keys are rejected rather than
 *     ignored, on the same reasoning.
 *  3. **Coherence.** The linter, for dangling references and gapped tables.
 */
export function parsePack(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null) {
    return {
      ok: false,
      pack: null,
      diagnostics: [
        { level: "error", code: "pack/not-an-object", path: "", message: "pack must be an object" },
      ],
    };
  }

  const declared = (input as { schemaVersion?: unknown }).schemaVersion;
  if (typeof declared !== "number" || !SUPPORTED_SCHEMA_VERSIONS.includes(declared)) {
    return {
      ok: false,
      pack: null,
      diagnostics: [
        {
          level: "error",
          code: "pack/unsupported-schema-version",
          path: "schemaVersion",
          message:
            `pack declares schemaVersion ${JSON.stringify(declared)}; ` +
            `this build supports ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`,
        },
      ],
    };
  }

  const parsed = Pack.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      pack: null,
      diagnostics: parsed.error.issues.map((issue) => ({
        level: "error" as const,
        code: `schema/${issue.code}`,
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const pack = parsed.data;
  const diagnostics = lintPack(pack);

  const unsupported = pack.capabilities.filter(
    (c) => !(IMPLEMENTED_CAPABILITIES as readonly string[]).includes(c),
  );
  for (const cap of unsupported) {
    diagnostics.push({
      level: "error",
      code: "pack/unsupported-capability",
      path: "capabilities",
      message: `pack requires the "${cap}" capability, which this build does not implement`,
    });
  }

  if (hasErrors(diagnostics)) return { ok: false, pack: null, diagnostics };
  return { ok: true, pack, diagnostics };
}
