import type { ReactNode } from "react";

/**
 * What something is, said beside it.
 *
 * A badge reports; it does not act. The app draws both with `chip`, and
 * the two have been hard to tell apart: a filter that can be pressed and
 * a status that cannot look the same, so people press the status. This is
 * the half that cannot be pressed. It is a `span`, it takes no handler,
 * and the sheet keeps a control's cursor off it. A chip that is really a
 * filter stays a button, and says so with `aria-pressed`.
 */

/** The tones the sheet already draws: plain, fine, a consequence, a state of the run, a capability. */
export type BadgeTone = "neutral" | "ok" | "warn" | "state" | "cap";

export function Badge({
  tone = "neutral",
  title,
  className,
  children,
}: {
  tone?: BadgeTone;
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  const tones = tone === "neutral" ? "" : tone;
  return (
    <span className={["chip badge", tones, className].filter(Boolean).join(" ")} title={title}>
      {children}
    </span>
  );
}
