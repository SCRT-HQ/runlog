import { describe, expect, it } from "vitest";
import { parseSetup, SETUP_SCHEMA_VERSION } from "./setup.ts";
import { loadSetupText, whichKind } from "./load.ts";

/**
 * A setup is its own document, and the point of this file is that it stays
 * one: it must not need a pack to be valid, it must refuse anything that is
 * not one rather than half-reading it, and a reader holding a file must be
 * able to tell which kind it has without trying both.
 */

const good = {
  kind: "setup",
  schemaVersion: SETUP_SCHEMA_VERSION,
  id: "com.example.setups.bare-handed",
  version: "1.0.0",
  title: "Bare-handed",
  tool: "TarnishedTool",
  ops: [
    { op: "flag.set", args: { name: "player.noRoll", value: true } },
    { op: "runes.give", args: { amount: 50000 }, once: true },
  ],
};

describe("a setup", () => {
  it("is valid on its own, naming a tool and no pack at all", () => {
    const parsed = parseSetup(good);
    expect(parsed.ok).toBe(true);
    expect(parsed.setup?.tool).toBe("TarnishedTool");
    expect(parsed.setup?.ops).toHaveLength(2);
    // The whole reason it is a separate document: nothing in it is about
    // a pack, so the same one fits every pack for the same game.
    expect(JSON.stringify(parsed.setup)).not.toContain("pack");
  });

  it("keeps `once`, which is what stops a gift being handed over twice", () => {
    const parsed = parseSetup(good);
    expect(parsed.setup?.ops[1]?.once).toBe(true);
    expect(parsed.setup?.ops[0]?.once).toBeUndefined();
  });

  it("refuses a pack rather than reading half of one", () => {
    const asPack = { schemaVersion: 1, id: "com.example.pack", version: "1.0.0", title: "A pack", modes: {}, defaultMode: "x" };
    const parsed = parseSetup(asPack);
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics[0]?.code).toBe("setup/kind");
  });

  it("refuses a version it does not know, rather than guessing at the format", () => {
    const parsed = parseSetup({ ...good, schemaVersion: 99 });
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics[0]?.code).toBe("setup/version");
  });

  it("refuses an unknown key, the same as a pack does", () => {
    const parsed = parseSetup({ ...good, rows: [] });
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.some((d) => d.code.startsWith("setup/"))).toBe(true);
  });

  it("wants at least one operation, since a setup that does nothing is not one", () => {
    expect(parseSetup({ ...good, ops: [] }).ok).toBe(false);
  });
});

describe("reading a file somebody handed you", () => {
  const yaml = [
    "kind: setup",
    `schemaVersion: ${SETUP_SCHEMA_VERSION}`,
    "id: com.example.setups.bare-handed",
    'version: "1.0.0"',
    "title: Bare-handed",
    "tool: TarnishedTool",
    "ops:",
    "  - { op: flag.set, args: { name: player.noRoll, value: true } }",
  ].join("\n");

  it("loads from YAML, which is what anybody writes one in", () => {
    const parsed = loadSetupText(yaml, "yaml");
    expect(parsed.ok).toBe(true);
    expect(parsed.setup?.title).toBe("Bare-handed");
  });

  it("says which kind a file is, so nothing has to try both", () => {
    expect(whichKind(yaml, "yaml")).toBe("setup");
    // A pack has never carried a `kind`, and the absence of one is what
    // says pack: the new thing declares itself so the old one need not.
    expect(whichKind("schemaVersion: 1\nid: com.example.p\ntitle: A pack", "yaml")).toBe("pack");
    expect(whichKind("{{{", "yaml")).toBe("unreadable");
  });

  it("says where the trouble is, rather than that there was some", () => {
    const parsed = loadSetupText('kind: setup\nschemaVersion: 1\nid: com.example.s\nversion: "1.0.0"\ntitle: T\nops: []', "yaml");
    expect(parsed.ok).toBe(false);
    // A missing tool and an empty ops list are two complaints, each naming
    // its own field, because "invalid" is not something anybody can fix.
    expect(parsed.diagnostics.map((d) => d.path).sort()).toEqual(["ops", "tool"]);
  });
});
