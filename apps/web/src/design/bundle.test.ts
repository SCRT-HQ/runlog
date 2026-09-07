import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, DOC_KINDS } from "@runlog/rules-schema";
import { bundle, bundleEntries, bundleFilename } from "./bundle.ts";
import { unzip } from "../docs/zip.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const r = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!r.ok) throw new Error("could not load the demo pack");
const kiln = r.pack;
const text = (b: Uint8Array | string) => (typeof b === "string" ? b : new TextDecoder().decode(b));

describe("a distribution bundle", () => {
  it("carries the pack file, a note, and every document twice", async () => {
    const entries = await bundleEntries({ pack: kiln, file: { name: "long-kiln-1.0.0.yaml", data: "id: x\n" } });
    const names = entries.map((e) => e.name);
    expect(names[0]).toBe("README.md");
    expect(names[1]).toBe("long-kiln-1.0.0.yaml");
    for (const k of DOC_KINDS) {
      expect(names).toContain(`docs/${k.kind}.html`);
      expect(names).toContain(`docs/${k.kind}.md`);
    }
    expect(names).toHaveLength(2 + DOC_KINDS.length * 2);
    const readme = text(entries[0]!.data);
    expect(readme).toContain(`# ${kiln.title}`);
    expect(readme).toContain("signed by its author");
    expect(readme).not.toContain("license key");
  });

  it("names the buyer on a sealed copy and keeps the key out", async () => {
    const sealed = new Uint8Array([0x52, 0x4c, 0x50, 0x41, 0x43, 0x4b, 1, 2, 3]);
    const bytes = await bundle({ pack: kiln, file: { name: "long-kiln-1.0.0-ada.rlpack", data: sealed }, sealed: { to: "Ada", reference: "ORD-7" } });
    const back = unzip(bytes);
    const readme = text(back.find((e) => e.name === "README.md")!.data);
    expect(readme).toContain("sealed for Ada (order ORD-7)");
    expect(readme).toContain("not in this bundle");
    expect(Array.from(back.find((e) => e.name === "long-kiln-1.0.0-ada.rlpack")!.data as Uint8Array)).toEqual(Array.from(sealed));
    expect(text(back.find((e) => e.name === "docs/rulebook.html")!.data)).toContain("<!doctype html>");
  });

  it("adds a PDF of each document when given a renderer", async () => {
    const fake = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const entries = await bundleEntries({ pack: kiln, file: { name: "long-kiln-1.0.0.yaml", data: "id: x\n" }, pdf: async () => fake });
    const names = entries.map((e) => e.name);
    for (const k of DOC_KINDS) expect(names).toContain(`docs/${k.kind}.pdf`);
    expect(names).toHaveLength(2 + DOC_KINDS.length * 3);
    expect(text(entries[0]!.data)).toContain("docs/rulebook.pdf");
  });

  it("names the archive after the file", () => {
    expect(bundleFilename("long-kiln-1.0.0.yaml")).toBe("long-kiln-1.0.0-bundle.zip");
    expect(bundleFilename("long-kiln-1.0.0-ada.rlpack")).toBe("long-kiln-1.0.0-ada-bundle.zip");
  });
});
