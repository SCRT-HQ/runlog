import { useState, type ReactNode } from "react";

/**
 * A section that folds, on the native `details`.
 *
 * The browser already knows how to do this: the summary is focusable, it
 * answers to Enter and Space, it reports whether it is open, and find-in-page
 * opens it to show a match. Nothing written by hand matches that, so nothing
 * here replaces it.
 *
 * What is added is the two things `details` has no opinion about. A panel can
 * remember whether it was left open, under a key of its own, and a panel that
 * is closed can say it has something worth opening for.
 */

/** Namespaced and versioned, so a later change of what is stored cannot be read as this one. */
const keyFor = (name: string) => `runlog:disclosure.v1:${name}`;

/** Storage is a privilege, not a given: a private window, a blocked origin, or a full quota all throw. */
function recall(name: string, fallback: boolean): boolean {
  try {
    const saved = localStorage.getItem(keyFor(name));
    return saved === null ? fallback : saved === "open";
  } catch {
    return fallback;
  }
}

function keep(name: string, open: boolean) {
  try {
    localStorage.setItem(keyFor(name), open ? "open" : "shut");
  } catch {
    // Nothing is owed here. A preference that cannot be written is a
    // preference the next visit does not have, which is what the panel
    // did before it was offered one.
  }
}

export function Disclosure({
  summary,
  defaultOpen = true,
  remember,
  signal,
  signalLabel = "Something new",
  className,
  children,
}: {
  /** The heading on the fold. May carry the muted span some titles put after the name. */
  summary: ReactNode;
  defaultOpen?: boolean;
  /** Remember this panel's state under this name. Left out, the panel opens as it was written to. */
  remember?: string;
  /** Something arrived while this was folded. The marker shows only while it is folded. */
  signal?: boolean;
  /** What the marker is called, for anyone who is not looking at it. */
  signalLabel?: string;
  /** What the section used to carry on its own element, kept so its rules still find it. */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => (remember ? recall(remember, defaultOpen) : defaultOpen));
  return (
    <details
      className={className ? `panel ${className}` : "panel"}
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        if (remember) keep(remember, now);
      }}
    >
      <summary>
        <h3 className="sectionTitle">
          {summary}
          {signal && !open && <span className="disclosureSignal" role="img" aria-label={signalLabel} />}
        </h3>
      </summary>
      {children}
    </details>
  );
}
