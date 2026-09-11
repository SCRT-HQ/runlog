import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredPack } from "../storage/db.ts";
import { LibraryView, type LibraryPack } from "./LibraryView.tsx";

/**
 * The shelf at first paint, rendered static: no storage read, no server.
 *
 * What is checked is which controls each row offers, since a control that
 * is missing is invisible in the markup and a wrong one is a press away
 * from losing something. In particular: a pack of your own offers to take
 * a newer file, a sealed copy does not, and the row's picker will not take
 * a sealed file at all.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const source = readFileSync(join(repoRoot, "packs", "demo", "pack.yaml"), "utf8");

const record = (over: Partial<StoredPack>): StoredPack => ({
  id: "com.example.kiln",
  title: "Kiln Yard",
  version: "1.0.0",
  source,
  format: "yaml",
  filename: "kiln.yaml",
  importedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const shelf = (records: StoredPack[]): LibraryPack[] =>
  records.map((r) => ({ id: r.id, title: r.title, sub: `from your file, v${r.version}`, source: r.source, record: r }));

const noop = () => {};
const paint = (packs: LibraryPack[], withReplace = true) =>
  renderToStaticMarkup(
    <LibraryView
      packs={packs}
      activeId=""
      onOpen={noop}
      onContinue={noop}
      onStartAnother={noop}
      onForgetRun={noop}
      onForgetPack={noop}
      onFile={noop}
      onSyncToggle={noop}
      onMarketplace={noop}
      {...(withReplace ? { onReplace: noop } : {})}
    />,
  );

describe("a pack's row", () => {
  it("offers to take a newer file of a pack that is yours, and says the runs stay", () => {
    const html = paint(shelf([record({})]));
    expect(html).toContain("Replace from a file");
    expect(html).toMatch(/Load a newer file of Kiln Yard; its [a-z]+ are kept/);
    expect(html).toContain("Forget pack");
  });

  it("will not take a sealed file in a pack's place", () => {
    const html = paint(shelf([record({})]));
    const picker = html.match(/<label class="ghost tiny fileButton"[^>]*>Replace from a file<input[^>]*>/)?.[0] ?? "";
    expect(picker).toContain('accept=".yaml,.yml,.json"');
    expect(picker).not.toContain(".rlpack");
  });

  it("does not offer it for a sealed copy, whose update is the publisher's", () => {
    const html = paint(shelf([record({ id: "com.example.sealed", title: "Sealed Copy", sealed: true })]));
    expect(html).not.toContain("Replace from a file");
    expect(html).toContain("Forget pack");
  });

  it("does not offer it where nothing would take the file", () => {
    expect(paint(shelf([record({})]), false)).not.toContain("Replace from a file");
  });

  it("keeps the shelf-wide picker, which still takes a sealed copy", () => {
    const html = paint(shelf([record({})]));
    expect(html).toContain("Load a pack from a file");
    expect(html).toContain('accept=".yaml,.yml,.json,.rlpack"');
  });
});
