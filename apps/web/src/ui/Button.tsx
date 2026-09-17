import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The button, and the link that looks like one.
 *
 * The app writes its controls as `className="primary"` and
 * `className="ghost tiny danger"` in about four hundred places. This is
 * the same thing said once: the classes the stylesheet already draws,
 * behind a name that says what the control is for rather than what it
 * looks like. Nothing about the drawing changes, so a screen can move
 * over one at a time and the rest go on as they were.
 *
 * Two rules are worth the component on their own. A mutation is a
 * `Button` and navigation is a `ButtonLink`, because a link that is
 * really a button loses the middle click, the new tab and the address
 * the browser would have shown. And a button that is working is
 * disabled, says so with `aria-busy`, and keeps the room its label took,
 * so the row it sits in does not jump while it waits.
 */

/** What the control is: the one the page wants pressed, a quiet one beside it, or one that destroys something. */
export type ButtonVariant = "primary" | "quiet" | "danger";

/** How much room it takes. `compact` is the dense row's 32px; the text stays at the control's size. */
export type ButtonSize = "compact" | "default" | "big";

/** How loud a destructive button is. Quiet by default: most of them sit in a row of errands. */
export type DangerEmphasis = "quiet" | "primary";

interface Shape {
  variant?: ButtonVariant;
  size?: ButtonSize;
  emphasis?: DangerEmphasis;
}

/** The class names the stylesheet knows, from what the caller asked for. */
export function controlClasses({ variant = "quiet", size = "default", emphasis = "quiet" }: Shape, extra?: string): string {
  const base =
    variant === "primary" ? "primary" : variant === "danger" ? `${emphasis === "primary" ? "primary" : "ghost"} danger` : "ghost";
  // `small` and `tiny` are the same control now: 32px of height at the
  // control's own size. One word for it here, and `tiny` is the one the
  // sheet's rules are written against.
  const width = size === "compact" ? "tiny" : size === "big" ? "big" : "";
  return [base, width, extra].filter(Boolean).join(" ");
}

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> &
  Shape & {
    /** Working: the button is disabled, marked busy, and says this instead of its label. */
    loading?: boolean;
    /** What it says while it works. Given or not, the button keeps the wider of the two labels' room. */
    loadingLabel?: ReactNode;
    /** Whatever else the screen's own rules look for. */
    className?: string;
    children?: ReactNode;
  };

export function Button({ variant, size, emphasis, loading, loadingLabel, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type ?? "button"}
      className={controlClasses({ variant, size, emphasis }, className)}
      disabled={disabled === true || loading === true}
      aria-busy={loading === true ? true : undefined}
    >
      <Label loading={loading === true} loadingLabel={loadingLabel}>
        {children}
      </Label>
    </button>
  );
}

export type ButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> &
  Shape & {
    /** Where it goes. A `ButtonLink` without one is not a link, and a press with nowhere to go is a `Button`. */
    href: string;
    className?: string;
    children?: ReactNode;
  };

/** Navigation wearing a button's clothes: still an anchor, so the browser's own ways of following it all work. */
export function ButtonLink({ variant, size, emphasis, className, children, ...rest }: ButtonLinkProps) {
  return (
    <a {...rest} className={controlClasses({ variant, size, emphasis }, className)}>
      {children}
    </a>
  );
}

/**
 * The label, and the room it takes.
 *
 * With no second label there is nothing to swap, so the children are the
 * label and that is all. With one, both sit in the same grid cell and the
 * one that is not being read is hidden rather than removed: the button is
 * always as wide as the wider of the two, before and during the wait.
 */
function Label({ loading, loadingLabel, children }: { loading: boolean; loadingLabel?: ReactNode; children?: ReactNode }) {
  if (loadingLabel === undefined) return <>{children}</>;
  return (
    <span className="buttonBusy">
      <span className={loading ? "buttonBusyHidden" : undefined} aria-hidden={loading || undefined}>
        {children}
      </span>
      <span className={loading ? undefined : "buttonBusyHidden"} aria-hidden={loading ? undefined : true}>
        {loadingLabel}
      </span>
    </span>
  );
}
