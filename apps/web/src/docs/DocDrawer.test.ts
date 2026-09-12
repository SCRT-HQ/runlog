import { describe, expect, it } from "vitest";
import { docsFromHash } from "./DocDrawer.tsx";

/**
 * A pack's paper has an address so it can be sent to somebody and survive
 * a reload. What the address has to carry: which section it is read in,
 * which pack, and which of the documents.
 */
describe("the address of a pack's paper", () => {
  it("names the section, the pack and the document", () => {
    expect(docsFromHash("#packs/dev.runlog.kiln/docs")).toEqual({ at: { section: "packs", id: "dev.runlog.kiln" }, kind: "summary" });
    expect(docsFromHash("#packs/dev.runlog.kiln/docs/rulebook")).toEqual({ at: { section: "packs", id: "dev.runlog.kiln" }, kind: "rulebook" });
    expect(docsFromHash("#marketplace/dev.runlog.kiln/docs/quickstart")).toEqual({ at: { section: "marketplace", id: "dev.runlog.kiln" }, kind: "quickstart" });
  });

  it("reads a pack id back exactly as it was written", () => {
    expect(docsFromHash(`#packs/${encodeURIComponent("a pack/with bits")}/docs`)?.at.id).toBe("a pack/with bits");
  });

  it("is not every address that happens to start the same way", () => {
    // The sections themselves, a card, and a document this pack format has
    // no such thing as: none of them open paper.
    expect(docsFromHash("#packs")).toBeNull();
    expect(docsFromHash("#marketplace/dev.runlog.kiln")).toBeNull();
    expect(docsFromHash("#packs/dev.runlog.kiln/docs/invented")).toBeNull();
    expect(docsFromHash("#guide/start")).toBeNull();
    expect(docsFromHash("#packs/dev.runlog.kiln/docs/rulebook/extra")).toBeNull();
  });
});
