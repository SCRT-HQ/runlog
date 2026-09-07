import { useHosted } from "./HostedProvider.tsx";

/**
 * The foot of every page but a run: where the operator's pages are, and
 * which build this is. A run has no footer because nothing should sit
 * under the board; the pages a person reads do. Nothing at all where the
 * copy is not hosted — a file on disk has no terms to link to.
 */
export function Footer({ onGuide }: { onGuide: () => void }) {
  const hosted = useHosted();
  if (!hosted) return null;
  const { links } = hosted;
  return (
    <footer className="siteFooter">
      <nav aria-label="About this site">
        <a
          href="#guide"
          onClick={(e) => {
            e.preventDefault();
            onGuide();
          }}
        >
          Docs
        </a>
        <a href="./?welcome">What Runlog is</a>
        {links.pricing && <a href={links.pricing}>Pricing</a>}
        <a href={links.terms}>Terms</a>
        <a href={links.privacy}>Privacy</a>
        {links.publishers && <a href={links.publishers}>Publishers</a>}
        {links.about && <a href={links.about}>About</a>}
        <a href={`mailto:${hosted.support}`}>Support</a>
        {links.licenses && <a href={links.licenses}>Licenses</a>}
        {links.source && <a href={links.source}>Source</a>}
      </nav>
      <span className="build">
        {hosted.operator}
        {hosted.version && ` · Runlog ${hosted.version}`}
        {hosted.sha && ` ${hosted.sha.slice(0, 7)}`}
      </span>
    </footer>
  );
}
