import { useEffect, useState, type ReactNode } from "react";
import { generateDoc, loadPackText, type Doc } from "@runlog/rules-schema";
import { DocView } from "../docs/DocView.tsx";
import { catalogEntry, STARTER_PACK } from "../library/catalog.ts";
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

/** The starter pack's catalog summary, generated on the spot: the same document the catalog's About shows. */
export function SummaryDemo() {
  const [doc, setDoc] = useState<Doc | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const entry = await catalogEntry(STARTER_PACK);
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

/** The set of components a page gets, by the names it uses in MDX. */
export const guideComponents = { Screenshot, Note, Steps, Kbd, SummaryDemo, ClockDemo, Plan };
