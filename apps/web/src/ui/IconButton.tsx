import type { ButtonHTMLAttributes, ReactNode } from "react";
import { controlClasses, type ButtonSize, type ButtonVariant, type DangerEmphasis } from "./Button.tsx";

/**
 * A button whose label is a shape.
 *
 * A glyph is not a name. Every one of these has to carry the name in
 * `aria-label`, so the type asks for it and there is no way to write one
 * without. The tooltip is a separate thing and stays optional: it is what
 * a mouse finds by waiting, and nobody who cannot see the glyph will ever
 * be shown it.
 *
 * The hit area is the control's compact height, square, whatever the
 * glyph inside measures. Size the target and size the mark separately;
 * an eleven-pixel cross is fine to look at and impossible to press.
 */
export function IconButton({
  label,
  title,
  variant = "quiet",
  size = "compact",
  emphasis,
  className,
  children,
  type,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-label"> & {
  /** The accessible name. Required: a glyph says nothing to anyone who is not looking at it. */
  label: string;
  /** The tooltip, where a longer sentence helps a mouse. Supplemental; the name above is what is read. */
  title?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  emphasis?: DangerEmphasis;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      {...rest}
      type={type ?? "button"}
      className={controlClasses({ variant, size, emphasis }, className ? `iconButton ${className}` : "iconButton")}
      aria-label={label}
      title={title}
    >
      {children}
    </button>
  );
}
