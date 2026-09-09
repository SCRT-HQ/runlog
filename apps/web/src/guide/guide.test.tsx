import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { guideComponents } from "./components.tsx";
import { GuideView } from "./GuideView.tsx";
import { GUIDE_PAGES, GUIDE_PARTS, guidePage, guideSectionFromHash, guideSlugFromHash, slugOf } from "./pages.ts";

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
    const together = GUIDE_PAGES.find((p) => p.slug === "inviting")!;
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
    // A section rides along after the page, and is read apart from it.
    expect(guideSlugFromHash("#guide/streaming/in-obs-and-streamlabs")).toBe("streaming");
    expect(guideSectionFromHash("#guide/streaming/in-obs-and-streamlabs")).toBe("in-obs-and-streamlabs");
    expect(guideSectionFromHash("#guide/streaming")).toBeNull();
  });

  it("gives every section an id from its words, with an anchor, and no two alike on a page", () => {
    expect(slugOf("In OBS and Streamlabs")).toBe("in-obs-and-streamlabs");
    expect(slugOf("Inviting someone (Plus)")).toBe("inviting-someone-plus");
    for (const page of GUIDE_PAGES) {
      const html = renderToStaticMarkup(<page.Page components={guideComponents} />);
      const ids = [...html.matchAll(/<h[23] id="([^"]+)"/g)].map((m) => m[1]);
      expect(ids.length, page.slug).toBe((html.match(/<h[23]\b/g) ?? []).length);
      expect(new Set(ids).size, page.slug).toBe(ids.length);
      for (const id of ids) expect(html, page.slug).toContain(`href="#${id}"`);
    }
    // A badge in the heading is not part of its words.
    const Plans = GUIDE_PAGES.find((p) => p.slug === "plans")!.Page;
    expect(renderToStaticMarkup(<Plans components={guideComponents} />)).toContain('<h2 id="plus">');
  });

  it("lays the contents out as chapters: the open one with its pages and their blurbs, the others by title alone", () => {
    const html = renderToStaticMarkup(<GuideView slug="streaming" onNavigate={() => {}} onBack={() => {}} />);
    expect(html).toContain('class="guidePart open"');
    expect((html.match(/class="guidePart open"/g) ?? []).length).toBe(1);
    const streaming = GUIDE_PAGES.find((p) => p.slug === "streaming")!;
    const start = GUIDE_PAGES.find((p) => p.slug === "start")!;
    expect(html).toContain(streaming.blurb);
    expect(html).not.toContain(start.blurb);
    expect(html).toContain(`>${start.title}<`);
    expect(html).toContain('aria-label="On this page"');
    // A group shows its pages when it holds the open page; the part's other groups show their names alone.
    expect(html).toContain('class="guideRun grouped here"');
    expect(html).toContain(">Streaming<");
    expect(html).toContain(">Playing together<");
    const contents = html.slice(0, html.indexOf("</aside>"));
    expect(contents).not.toContain("Races across devices");
    expect(contents).toContain("StreamElements");
  });

  it("draws a table where a page has one", () => {
    const Obs = GUIDE_PAGES.find((p) => p.slug === "obs")!.Page;
    const html = renderToStaticMarkup(<Obs components={guideComponents} />);
    expect(html).toContain("<table>");
    expect(html).toContain("<td>480 × 200</td>");
  });

  it("keeps every slug unique, and every link between pages pointing at a page", () => {
    const slugs = GUIDE_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const page of GUIDE_PAGES) {
      const html = renderToStaticMarkup(<page.Page components={guideComponents} />);
      for (const m of html.matchAll(/href="#guide\/([a-z-]+)(?:\/[a-z0-9-]+)?"/g)) expect(slugs, `${page.slug} links to ${m[1]}`).toContain(m[1]);
    }
  });
});
