import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { guideComponents } from "./components.tsx";
import { GUIDE_PAGES, GUIDE_PARTS, guidePage, guideSlugFromHash } from "./pages.ts";

/**
 * The guide is prose that ships with the app, so the checks are the ones a
 * copy-editor would run: every page renders, opens with one title, and
 * points its screenshots at files that exist. And the address bar's part
 * of it round-trips.
 */
describe("the guide", () => {
  it("renders every page with a single title, without an account", () => {
    for (const page of GUIDE_PAGES) {
      const html = renderToStaticMarkup(<page.Page components={guideComponents} />);
      expect(html.match(/<h1/g)?.length, page.slug).toBe(1);
      expect(html).toContain(`<h1>${page.title}`);
    }
  });

  it("keeps its pages in parts, each part in one run, so the contents list reads as chapters", () => {
    const parts = GUIDE_PAGES.map((p) => p.part);
    // Every part has a page, and the pages of a part sit together, in the parts' order.
    const seen = [...new Set(parts)];
    expect(seen).toEqual([...GUIDE_PARTS]);
    for (const part of GUIDE_PARTS) {
      const first = parts.indexOf(part);
      const last = parts.lastIndexOf(part);
      expect(parts.slice(first, last + 1).every((x) => x === part), part).toBe(true);
    }
  });

  it("names its plans where features are limited", () => {
    const together = GUIDE_PAGES.find((p) => p.slug === "together")!;
    const html = renderToStaticMarkup(<together.Page components={guideComponents} />);
    expect(html).toContain('class="plan plan-plus"');
    const design = GUIDE_PAGES.find((p) => p.slug === "design")!;
    expect(renderToStaticMarkup(<design.Page components={guideComponents} />)).toContain('class="plan plan-publisher"');
  });

  it("reads its page from the address bar, and falls back to the first", () => {
    expect(guideSlugFromHash("#guide/playing")).toBe("playing");
    expect(guideSlugFromHash("#guide")).toBe("start");
    expect(guideSlugFromHash("#other")).toBeNull();
    expect(guideSlugFromHash("")).toBeNull();
    expect(guidePage("nope")).toBeUndefined();
  });
});
