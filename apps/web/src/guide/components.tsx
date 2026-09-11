import { Children, createContext, isValidElement, useContext, useEffect, useState, type ReactNode } from "react";
import { hrefFor } from "../route.ts";
import { guideSlugFromHash, slugOf } from "./pages.ts";

/** The page being shown, so a heading can spell its own address. */
export const GuidePageContext = createContext<string | null>(null);

/**
 * A link in a page. Pages are written with the guide's own spelling,
 * `#guide/<page>` or `#guide/<page>/<section>`, which is the one every
 * copy understands; the rendered link is spelled for this build, a path
 * on the hosted copy, so hovering, copying or opening it in a new tab
 * gives the address the bar would show. The guide's own spelling rides
 * along as data, for the page to navigate by when the link is pressed.
 */
function Link({ href, children, ...rest }: { href?: string; children?: ReactNode }) {
  if (href && guideSlugFromHash(href)) {
    return (
      <a href={hrefFor(href)} data-guide={href} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
import { generateDoc, loadPackText, type Doc } from "@runlog/rules-schema";
import { DocView } from "../docs/DocView.tsx";
import { marketplaceEntry, STARTER_PACK } from "../library/marketplace.ts";
import { useHosted } from "../hosted/HostedProvider.tsx";

/**
 * What a guide page may use besides prose: a screenshot with a caption, a
 * note, a numbered walk-through, and live pieces of the app itself, so the
 * guide shows the real thing rather than a picture of it wherever it can.
 */

export function Screenshot({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  return (
    <figure className="guideShot">
      <img src={`${import.meta.env.BASE_URL}guide/${src}`} alt={alt} loading="lazy" />
      {caption && <figcaption className="muted small">{caption}</figcaption>}
    </figure>
  );
}

export function Note({ children, tone = "note" }: { children: ReactNode; tone?: "note" | "warn" }) {
  return <p className={tone === "warn" ? "notice" : "docNote"}>{children}</p>;
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="guideSteps">{children}</ol>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** The starter pack's catalog summary, generated on the spot: the same document the marketplace's About shows. */
export function SummaryDemo() {
  const [doc, setDoc] = useState<Doc | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const entry = await marketplaceEntry(STARTER_PACK);
      if (!entry) return;
      const loaded = loadPackText(await entry.load(), "yaml");
      if (live && loaded.ok) setDoc(generateDoc(loaded.pack, "summary"));
    })();
    return () => {
      live = false;
    };
  }, []);
  if (!doc) return <p className="muted small">Reading the starter pack…</p>;
  return (
    <div className="guideDemo">
      <DocView doc={doc} heading />
    </div>
  );
}

/** A clock face at rest, the way the run shows one, for the page that explains it. */
export function ClockDemo({ kind = "timer" }: { kind?: "timer" | "stopwatch" }) {
  return (
    <div className="guideDemo">
      <div className={`clock running`}>
        <div className="clockHead">
          <span className="clockLabel">{kind === "timer" ? "This Block" : "Region 3"}</span>
          <span className="chip state">{kind === "timer" ? "left" : "elapsed"}</span>
        </div>
        <div className="clockDigits">{kind === "timer" ? "18:42" : "7:05.3"}</div>
        {kind === "timer" && (
          <div className="clockBar" aria-hidden="true">
            <span style={{ width: "75%" }} />
          </div>
        )}
        <div className="clockButtons">
          <button className="ghost big" disabled>
            Pause
          </button>
          <button className="ghost big" disabled>
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Which plan a feature belongs to. Plans are not switched on yet, so the
 * badge is a promise about the future rather than a gate in the present;
 * the tooltip says so.
 */
export function Plan({ tier }: { tier: "free" | "plus" | "publisher" | "server" }) {
  const hosted = useHosted();
  const label = tier === "free" ? "Free" : tier === "plus" ? "Plus" : tier === "server" ? "Servers" : "Publisher";
  const what =
    tier === "free"
      ? "Free for everyone, always."
      : tier === "plus"
        ? "Part of the Plus plan when plans arrive: hosting a table for other people. Free while Runlog is in preview."
        : tier === "server"
          ? "Runlog for servers: the bot hosts runs in a Discord server you claimed, on the packs you choose. Being built."
          : "Publisher tools: listing and selling packs with a hosted license ledger. Being built.";
  if (hosted?.links.pricing) {
    return (
      <a className={`plan plan-${tier}`} title={what} href={hosted.links.pricing}>
        {label}
      </a>
    );
  }
  return (
    <span className={`plan plan-${tier}`} title={what}>
      {label}
    </span>
  );
}

/** The words of a heading's children: its strings, through any wrapping element, leaving out a badge such as a plan's. */
function wordsOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child) && child.props.children !== undefined) return wordsOf(child.props.children);
      return "";
    })
    .join("");
}

/**
 * A section heading with an id from its words, so the section has an
 * address of its own, and an anchor beside it that a hover shows: a doc
 * can be sent to someone at the right place. The address is the guide's
 * own (`#guide/<page>/<section>`), read by the page; the anchor's href is
 * only the section's id, which the guide rewrites when pressed.
 */
function Heading({ level, children }: { level: 2 | 3; children?: ReactNode }) {
  const page = useContext(GuidePageContext);
  const id = slugOf(wordsOf(children));
  const Tag = level === 2 ? "h2" : "h3";
  if (!id) return <Tag>{children}</Tag>;
  const address = page ? `#guide/${page}/${id}` : `#${id}`;
  return (
    <Tag id={id}>
      {children}
      <a className="anchor" href={page ? hrefFor(address) : address} aria-label="Link to this section" data-section={id}>
        #
      </a>
    </Tag>
  );
}

/** The set of components a page gets, by the names it uses in MDX, and the headings that make its sections. */
export const guideComponents = {
  Screenshot,
  Note,
  Steps,
  Kbd,
  SummaryDemo,
  ClockDemo,
  Plan,
  h2: (props: { children?: ReactNode }) => <Heading level={2} {...props} />,
  h3: (props: { children?: ReactNode }) => <Heading level={3} {...props} />,
  a: Link,
};
