import { useEffect, useState } from "react";
import { guideComponents } from "./components.tsx";
import { GUIDE_PAGES, GUIDE_PARTS, guidePage, guideSectionFromHash, guideSlugFromHash, type GuidePage } from "./pages.ts";

/**
 * The guide: how to use Runlog, in pages anyone can read without signing
 * in. Prose is MDX, with screenshots and live pieces of the app where a
 * picture would go stale. Three columns on a wide screen: the contents,
 * as chapters, with the open chapter showing its pages and the open page
 * its sections; the page itself; and the page's own sections beside it,
 * the one in view marked. The page is in the address bar as
 * `#guide/<slug>`, a section as `#guide/<slug>/<section>`, so either can
 * be sent to someone and comes back on reload.
 */
export function GuideView({ slug, section, onNavigate, onBack }: { slug: string; section?: string | null; onNavigate: (slug: string, section?: string) => void; onBack: () => void }) {
  const page = guidePage(slug) ?? GUIDE_PAGES[0]!;
  const Page = page.Page;
  const at = GUIDE_PAGES.findIndex((p) => p.slug === page.slug);
  const prev = GUIDE_PAGES[at - 1];
  const next = GUIDE_PAGES[at + 1];
  const sections = useSections(page);
  const inView = useInView(sections, page);

  useEffect(() => {
    document.title = `${page.title} · Runlog guide`;
    return () => {
      document.title = "Runlog";
    };
  }, [page]);
  // Land on the section the address names, once the page has its headings; at the top otherwise.
  useEffect(() => {
    const target = section ? document.getElementById(section) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else if (!section) window.scrollTo({ top: 0 });
  }, [page, section, sections]);

  const go = (e: React.MouseEvent, to: string, at?: string) => {
    e.preventDefault();
    onNavigate(to, at);
  };
  // A heading's own anchor names only its section, and a page's links to
  // other pages are written as `#guide/<slug>`; pressed, either goes
  // through the guide's address like the lists do, whatever spelling this
  // build keeps in the address bar.
  const onArticleClick = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest?.("a");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.dataset["section"]) return go(e, page.slug, anchor.dataset["section"]);
    const href = anchor.getAttribute("href") ?? "";
    const to = guideSlugFromHash(href);
    if (to) go(e, to, guideSectionFromHash(href) ?? undefined);
  };
  const sectionList = (className: string, label: string) =>
    sections.length > 0 && (
      <ol className={className} aria-label={label}>
        {sections.map((s) => (
          <li key={s.id} className={`${s.level === 3 ? "sub" : ""}${inView === s.id ? " on" : ""}`}>
            <a href={`#guide/${page.slug}/${s.id}`} aria-current={inView === s.id ? "location" : undefined} onClick={(e) => go(e, page.slug, s.id)}>
              {s.text}
            </a>
          </li>
        ))}
      </ol>
    );

  return (
    <main className="main guide">
      <aside className="guideSide" aria-label="Docs contents">
        <div className="guideSideHead">
          <h2>Guide</h2>
          <button className="ghost tiny" onClick={onBack}>
            Back to the app
          </button>
        </div>
        <nav className="guideToc" aria-label="Pages by part">
          {GUIDE_PARTS.map((part) => {
            const open = part === page.part;
            // A part's runs: its groups, each a run of pages on one subject,
            // and its pages that stand alone, in the order they come.
            const runs: Array<{ group: string | null; pages: GuidePage[] }> = [];
            for (const p of GUIDE_PAGES.filter((p) => p.part === part)) {
              const last = runs[runs.length - 1];
              if (last && last.group === (p.group ?? null) && last.group !== null) last.pages.push(p);
              else runs.push({ group: p.group ?? null, pages: [p] });
            }
            return (
              <section key={part} className={`guidePart${open ? " open" : ""}`}>
                <h3>{part}</h3>
                {runs.map((run, n) => {
                  // In the open part, a group shows its pages when it holds the open page, and its name alone otherwise; a closed part shows names and lone titles only.
                  const here = run.pages.some((p) => p.slug === page.slug);
                  const shown = run.group === null || here;
                  return (
                    <div key={run.group ?? `lone-${n}`} className={`guideRun${run.group ? " grouped" : ""}${here ? " here" : ""}`}>
                      {run.group && (
                        <h4>
                          <a href={`#guide/${run.pages[0]!.slug}`} onClick={(e) => go(e, run.pages[0]!.slug)}>
                            {run.group}
                          </a>
                        </h4>
                      )}
                      {shown && (
                        <ol>
                          {run.pages.map((p) => (
                            <li key={p.slug} className={p.slug === page.slug ? "on" : ""}>
                              <a href={`#guide/${p.slug}`} aria-current={p.slug === page.slug ? "page" : undefined} onClick={(e) => go(e, p.slug)}>
                                {p.title}
                              </a>
                              {open && here && <span className="muted small">{p.blurb}</span>}
                              {p.slug === page.slug && sectionList("guideSections", "Sections of this page")}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </nav>
      </aside>
      <nav className="guideOnPage" aria-label="On this page">
        {sections.length > 0 && <h4>On this page</h4>}
        {sectionList("", "Sections")}
      </nav>
      <article className="guidePage doc" onClick={onArticleClick}>
        <Page components={guideComponents} />
        <nav className="guideNav" aria-label="Neighboring pages">
          {prev ? (
            <button className="ghost" onClick={() => onNavigate(prev.slug)}>
              ← {prev.title}
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button className="ghost" onClick={() => onNavigate(next.slug)}>
              {next.title} →
            </button>
          )}
        </nav>
      </article>
    </main>
  );
}

interface Section {
  id: string;
  text: string;
  level: 2 | 3;
}

/** The page's sections, read from its headings once it is on the screen: the ids the heading components gave them, and their words. */
function useSections(page: GuidePage): Section[] {
  const [sections, setSections] = useState<Section[]>([]);
  useEffect(() => {
    const found = Array.from(document.querySelectorAll<HTMLHeadingElement>(".guidePage h2[id], .guidePage h3[id]")).map((h) => ({
      id: h.id,
      text: headingText(h),
      level: h.tagName === "H3" ? (3 as const) : (2 as const),
    }));
    setSections(found);
  }, [page]);
  return sections;
}

/** A heading's words without its anchor and its plan badge. */
function headingText(h: HTMLHeadingElement): string {
  return Array.from(h.childNodes)
    .filter((n) => !(n instanceof HTMLElement && (n.classList.contains("anchor") || n.classList.contains("plan"))))
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();
}

/** Which section is in view as the page scrolls: the last heading above the top third of the window. */
function useInView(sections: Section[], page: GuidePage): string | null {
  const [inView, setInView] = useState<string | null>(null);
  useEffect(() => {
    if (sections.length === 0) {
      setInView(null);
      return;
    }
    const heads = sections.map((s) => document.getElementById(s.id)).filter((h): h is HTMLElement => h !== null);
    const look = () => {
      const line = window.innerHeight / 3;
      let current: string | null = null;
      for (const h of heads) {
        if (h.getBoundingClientRect().top <= line) current = h.id;
        else break;
      }
      setInView(current ?? heads[0]?.id ?? null);
    };
    look();
    window.addEventListener("scroll", look, { passive: true });
    window.addEventListener("resize", look);
    return () => {
      window.removeEventListener("scroll", look);
      window.removeEventListener("resize", look);
    };
  }, [sections, page]);
  return inView;
}
