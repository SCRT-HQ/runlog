import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { against, marksUsed, parseMapping, MAPPING_SCHEMA_VERSION } from "./mapping.ts";
import { loadMappingText, loadPackText, whichKind } from "./load.ts";

/**
 * A mapping is its own document, and the point of this file is that it
 * stays one and that it stays portable.
 *
 * Portable is the whole claim. The profiles that came before are a
 * hundred and forty rules naming one pack's entries, which is right for
 * what they do and means nothing to the next pack somebody writes. A
 * mapping binds to marks, so the test that matters is that it fires on a
 * pack it has never heard of.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const good = {
  kind: "mapping",
  schemaVersion: MAPPING_SCHEMA_VERSION,
  id: "com.example.mappings.house",
  version: "1.0.0",
  title: "House rules",
  tool: "TarnishedTool",
  rules: [{ mark: "curse", ops: [{ op: "runes.give", args: { amount: -2000 } }] }],
};

describe("a mapping", () => {
  it("is valid on its own, naming a tool and no pack at all", () => {
    const parsed = parseMapping(good);
    expect(parsed.ok).toBe(true);
    expect(parsed.mapping?.tool).toBe("TarnishedTool");
    // `packs` is a note about where it was tried, not a binding. The
    // document must be valid with none, or it is a profile again.
    expect(parsed.mapping?.packs).toBeUndefined();
  });

  it("fires on a mark rather than on an entry, which is what makes it travel", () => {
    // An entry selector is what tied the old profiles to one pack. The
    // schema refuses one rather than quietly ignoring it.
    const parsed = parseMapping({ ...good, rules: [{ entry: "cu-slow", table: "curse", ops: [{ op: "flag.set", args: {} }] }] });
    expect(parsed.ok).toBe(false);
  });

  it("refuses a setup and a pack rather than reading half of one", () => {
    expect(parseMapping({ ...good, kind: "setup" }).diagnostics[0]?.code).toBe("mapping/kind");
    expect(parseMapping({ schemaVersion: 1, id: "com.example.p", title: "A pack", modes: {} }).diagnostics[0]?.code).toBe("mapping/kind");
  });

  it("refuses a version it does not know", () => {
    expect(parseMapping({ ...good, schemaVersion: 99 }).diagnostics[0]?.code).toBe("mapping/version");
  });

  it("will not let a rule last two ways at once", () => {
    expect(parseMapping({ ...good, rules: [{ mark: "curse", for: 30, until: "unit", ops: [{ op: "flag.set", args: {} }] }] }).ok).toBe(false);
  });

  it("wants at least one rule, since a mapping that does nothing is not one", () => {
    expect(parseMapping({ ...good, rules: [] }).ok).toBe(false);
  });
});

describe("telling the three documents apart", () => {
  it("says which kind a file is, so nothing has to try all three", () => {
    const yaml = ["kind: mapping", `schemaVersion: ${MAPPING_SCHEMA_VERSION}`, "id: com.example.m", 'version: "1.0.0"', "title: M", "tool: T", "rules:", "  - { mark: curse, ops: [{ op: x }] }"].join("\n");
    expect(whichKind(yaml, "yaml")).toBe("mapping");
    expect(whichKind("kind: setup\nid: com.example.s", "yaml")).toBe("setup");
    // A pack still declares nothing, and still does not have to.
    expect(whichKind("schemaVersion: 1\nid: com.example.p", "yaml")).toBe("pack");
    expect(whichKind("{{{", "yaml")).toBe("unreadable");
  });
});

describe("holding a mapping against a pack", () => {
  it("says which of its marks that pack declares, and which will do nothing", () => {
    const m = parseMapping({ ...good, rules: [{ mark: "curse", ops: [{ op: "a" }] }, { mark: "blessing", ops: [{ op: "b" }] }, { mark: "nonesuch", ops: [{ op: "c" }] }] });
    expect(m.ok).toBe(true);
    expect(marksUsed(m.mapping!)).toEqual(["blessing", "curse", "nonesuch"]);
    const { fires, idle } = against(m.mapping!, ["curse", "blessing", "objective"]);
    expect(fires).toEqual(["blessing", "curse"]);
    // Said before somebody plays an hour to find out.
    expect(idle).toEqual(["nonesuch"]);
  });

  it("the one we ship fires on every mark the pack it names declares", () => {
    const mapping = loadMappingText(readFileSync(join(repoRoot, "packs", "mappings", "elden-ring-house-rules.yaml"), "utf8"), "yaml");
    expect(mapping.ok).toBe(true);
    const pack = loadPackText(readFileSync(join(repoRoot, "packs", "sketches", "elden-ring-tarnishedtool.yaml"), "utf8"), "yaml");
    expect(pack.ok).toBe(true);

    const { fires, idle } = against(mapping.mapping!, Object.keys(pack.pack!.marks ?? {}));
    // A shipped mapping with a rule that can never fire is a shipped
    // mistake, and this is the check that would have caught the rename.
    expect(idle).toEqual([]);
    expect(fires.length).toBeGreaterThan(0);
  });
});
