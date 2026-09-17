import type { ReactNode } from "react";

/**
 * What page this is, said once at the top of it.
 *
 * Every screen currently announces itself differently: an `h2` here, a
 * bare `strong` there, a title that is only the browser tab's. This is
 * the one shape: the page's own `h1` at the page-title role, one line
 * under it if the title needs one, the action the page is for, and the
 * errands beside it.
 *
 * The errands come before the main action in the markup only where the
 * caller writes them that way; both slots are drawn in one row, so the
 * page decides the order and the header decides the spacing.
 */
export function PageHeader({
  title,
  lead,
  primary,
  secondary,
  className,
}: {
  /** The page's name. Drawn as its `h1`. */
  title: ReactNode;
  /** One sentence about what is here. Not a paragraph, and not a sales line. */
  lead?: ReactNode;
  /** The one thing this page is for. */
  primary?: ReactNode;
  /** Everything else that belongs at the top. */
  secondary?: ReactNode;
  /** What the screen's own rules look for, where the header it replaces had a class. */
  className?: string;
}) {
  return (
    <header className={className ? `pageHeader ${className}` : "pageHeader"}>
      <div className="pageHeaderText">
        <h1>{title}</h1>
        {lead && <p className="pageLead">{lead}</p>}
      </div>
      {(secondary || primary) && (
        <div className="pageHeaderActions">
          {secondary}
          {primary}
        </div>
      )}
    </header>
  );
}
