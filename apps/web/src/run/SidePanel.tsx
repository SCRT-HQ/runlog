import type { ReactNode } from "react";

/**
 * One panel in the run's side column, which folds.
 *
 * The column grew past what fits on a screen, and the only two panels that
 * folded were the two that happened to be written as `details`. This makes
 * every one of them the same shape: a title you can press, a triangle that
 * says which way it is, and the body under it. Open to begin with, since
 * what is in them is why the column is there.
 *
 * Nothing is remembered: a reload opens them all again.
 */
export function SidePanel({
  title,
  className,
  defaultOpen = true,
  children,
}: {
  /** The heading, which may carry the muted span some titles put after the name. */
  title: ReactNode;
  /** What the panel used to carry on its `section`, kept so its own rules still find it. */
  className?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={className ? `panel ${className}` : "panel"} open={defaultOpen}>
      <summary>
        <h3 className="sectionTitle">{title}</h3>
      </summary>
      {children}
    </details>
  );
}
