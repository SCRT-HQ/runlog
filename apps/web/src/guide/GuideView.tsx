import { useEffect } from "react";
import { guideComponents } from "./components.tsx";
import { GUIDE_PAGES, GUIDE_PARTS, guidePage } from "./pages.ts";

/**
 * The guide: how to use Runlog, in pages anyone can read without signing
 * in. Prose is MDX, with screenshots and live pieces of the app where a
 * picture would go stale. The sidebar is the table of contents; the page
 * is in the address bar as `#guide/<slug>` so it can be linked to and
 * comes back on reload.
 */
export function GuideView({ slug, onNavigate, onBack }: { slug: string; onNavigate: (slug: string) => void; onBack: () => void }) {
  const page = guidePage(slug) ?? GUIDE_PAGES[0]!;
  const Page = page.Page;
  const at = GUIDE_PAGES.findIndex((p) => p.slug === page.slug);
  const prev = GUIDE_PAGES[at - 1];
  const next = GUIDE_PAGES[at + 1];

  useEffect(() => {
    document.title = `${page.title} · Runlog guide`;
    window.scrollTo({ top: 0 });
    return () => {
      document.title = "Runlog";
    };
  }, [page]);

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
          {GUIDE_PARTS.map((part) => (
            <section key={part} className="guidePart">
              <h3>{part}</h3>
              <ol>
                {GUIDE_PAGES.filter((p) => p.part === part).map((p) => (
                  <li key={p.slug} className={p.slug === page.slug ? "on" : ""}>
                    <a href={`#guide/${p.slug}`} aria-current={p.slug === page.slug ? "page" : undefined} onClick={(e) => { e.preventDefault(); onNavigate(p.slug); }}>
                      {p.title}
                    </a>
                    <span className="muted small">{p.blurb}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </nav>
      </aside>
      <article className="guidePage doc">
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
