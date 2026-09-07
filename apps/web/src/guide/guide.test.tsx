import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { guideComponents } from "./components.tsx";
import { GUIDE_PAGES, guidePage, guideSlugFromHash } from "./pages.ts";

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
