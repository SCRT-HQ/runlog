import type { ButtonHTMLAttributes, ReactNode } from "react";
import { CheckGlyph } from "../run/glyphs.tsx";

/**
 * A button that is one of a set, pressed or not.
 *
 * The pressed state is said once, as `aria-pressed`, and the sheet draws
 * from that attribute, so what is heard and what is seen cannot disagree.
 * One of a single-choice set is drawn with a ring and a bolder label; one
 * of several gets a check in front of its label. Neither leans on color.
 */
export type PickKind = "one" | "many";

/** The check in front of a pressed multi-select label. The label names it; the mark is not read. */
export function PickMark({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span className="pickMark" aria-hidden="true">
      <CheckGlyph />
    </span>
  );
}

export function Pick({
  on,
  kind,
  className,
  children,
  type = "button",
  ...rest
}: { on: boolean; kind: PickKind; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed">) {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={on}
      className={[className, kind === "one" ? "pickOne" : "pickMany"].filter(Boolean).join(" ")}
    >
      {kind === "many" && <PickMark on={on} />}
      {children}
    </button>
  );
}
