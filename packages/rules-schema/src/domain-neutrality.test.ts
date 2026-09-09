import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "./pack.ts";

const here = dirname(fileURLToPath(import.meta.url));
const emitted = JSON.parse(
  readFileSync(join(here, "..", "schema", `pack-${SCHEMA_VERSION}.schema.json`), "utf8"),
) as Record<string, unknown>;

/**
 * The contract must not assume what kind of game it is describing.
 *
 * This project started as a companion for one music game, and the pull toward
 * its vocabulary is constant: `afterCompose` and `silences` both got as far as
 * the published schema before anyone noticed. Prose examples may name any
 * domain, that is how you explain a thing, but an *identifier* naming one
 * domain is a promise the format cannot keep, because a pack author in another
 * field then has to write `afterCompose` about a deadlift.
 *
 * So this guards identifiers only: property names and the closed vocabularies.
 */

/**
 * Words that name one craft rather than the shape of a game.
 *
 * Deliberately excludes terms with a plain-English reading the schema actually
 * relies on: `beats` (what an opposed roll exceeds), `bar` (a progress bar),
 * `note` (something written down), `track` as a verb.
 */
const DOMAIN_WORDS = [
  "compose",
  "composing",
  "music",
  "audio",
  "silence",
  "mute",
  "tempo",
  "melody",
  "chord",
  "midi",
  "daw",
  "timbre",
  "instrument",
  "drum",
  "synth",
  "mixdown",
  "stem",
  "waveform",
];

/** Collect every identifier the format commits to: property names and enums. */
function collectIdentifiers(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node !== "object" || node === null) return;
  const obj = node as Record<string, unknown>;

  const props = obj.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const [key, sub] of Object.entries(props)) {
      out.push([key, `${path}.${key}`]);
      collectIdentifiers(sub, `${path}.${key}`, out);
    }
  }

  if (Array.isArray(obj.enum)) {
    for (const value of obj.enum) {
      if (typeof value === "string") out.push([value, `${path}.enum`]);
    }
  }
  if (typeof obj.const === "string") out.push([obj.const, `${path}.const`]);

  for (const key of ["items", "additionalProperties", "propertyNames", "not"]) {
    if (obj[key]) collectIdentifiers(obj[key], `${path}.${key}`, out);
  }
  for (const key of ["anyOf", "allOf", "oneOf", "prefixItems"]) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      arr.forEach((sub, i) => collectIdentifiers(sub, `${path}.${key}[${i}]`, out));
    }
  }
  const defs = obj.$defs as Record<string, unknown> | undefined;
  if (defs) for (const [key, sub] of Object.entries(defs)) collectIdentifiers(sub, `$defs.${key}`, out);
}

describe("the pack format stays domain-neutral", () => {
  const identifiers: Array<[string, string]> = [];
  collectIdentifiers(emitted, "", identifiers);

  it("finds identifiers to check at all", () => {
    // Guards the guard: a walker that silently collects nothing would pass
    // every assertion below while checking nothing.
    expect(identifiers.length).toBeGreaterThan(80);
  });

  it("names no single craft in any property name or enum value", () => {
    const offenders = identifiers
      .filter(([id]) => DOMAIN_WORDS.some((w) => id.toLowerCase().includes(w)))
      .map(([id, where]) => `  ${id}  (at ${where})`);

    if (offenders.length > 0) {
      throw new Error(
        `${offenders.length} identifier(s) name one craft rather than the shape of a game.\n` +
          `A pack author in another field would have to write these about work that has ` +
          `nothing to do with them:\n${offenders.join("\n")}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the lifecycle points described in terms of the game, not the medium", () => {
    const triggerPoints = identifiers
      .filter(([, where]) => where.endsWith(".enum"))
      .map(([id]) => id);
    expect(triggerPoints).toContain("afterWork");
    expect(triggerPoints).toContain("onFinalize");
    expect(triggerPoints).not.toContain("afterCompose");
  });

  it("keeps state semantics described by effect, not by medium", () => {
    const ids = identifiers.map(([id]) => id);
    expect(ids).toContain("excludesFromResult");
    expect(ids).not.toContain("silences");
  });
});
