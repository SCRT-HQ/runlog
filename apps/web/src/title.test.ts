import { describe, expect, it } from "vitest";
import { runTitle, titleFor } from "./title.ts";

describe("titleFor: what the tab reads", () => {
  it("names the platform alone with no page in view", () => {
    expect(titleFor(null, "prd")).toBe("Runlog");
    expect(titleFor(null, undefined)).toBe("Runlog");
    expect(titleFor(null, "dev")).toBe("Runlog (dev)");
    expect(titleFor(null, "local")).toBe("Runlog (local)");
  });

  it("joins the page to the platform with a middle dot", () => {
    expect(titleFor("Packs", "prd")).toBe("Packs · Runlog");
    expect(titleFor("Packs", "dev")).toBe("Packs · Runlog (dev)");
    expect(titleFor("Packs", "local")).toBe("Packs · Runlog (local)");
  });

  it("treats prd and no stage at all the same way", () => {
    expect(titleFor("Packs", "prd")).toBe(titleFor("Packs", undefined));
  });

  it("treats an empty page as none", () => {
    expect(titleFor("", "dev")).toBe("Runlog (dev)");
  });
});

describe("runTitle: a run in hand, named for the tab", () => {
  it("joins the run's own name to the pack's title", () => {
    expect(runTitle("Firing Day Three", "The Long Kiln")).toBe("Firing Day Three · The Long Kiln");
  });

  it("falls back to the pack's title with no name, or only whitespace", () => {
    expect(runTitle(null, "The Long Kiln")).toBe("The Long Kiln");
    expect(runTitle(undefined, "The Long Kiln")).toBe("The Long Kiln");
    expect(runTitle("   ", "The Long Kiln")).toBe("The Long Kiln");
  });

  it("trims a name that carries stray whitespace", () => {
    expect(runTitle("  Firing Day Three  ", "The Long Kiln")).toBe("Firing Day Three · The Long Kiln");
  });
});
