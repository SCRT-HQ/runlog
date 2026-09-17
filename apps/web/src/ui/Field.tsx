import { useId, type ReactNode } from "react";

/**
 * A labeled input, with its help and its problem attached to it.
 *
 * Forms in the app label their inputs three different ways: a wrapping
 * `label`, an `aria-label` nobody sees, and a `span` above the box that
 * is only a label by where it sits. The first two lose the text a sighted
 * person reads, the third loses the link a screen reader follows. This
 * does it once: a real `label` with a real `for`, help and error carried
 * on `aria-describedby`, and `aria-invalid` set when there is something
 * wrong. The label is always there; a placeholder that vanishes when you
 * type is not a label.
 *
 * The input is written by the caller, because a field wraps a text box, a
 * select, a number and a textarea and has no business knowing which. What
 * it hands back is the wiring, ready to spread.
 */

/** The attributes the input has to wear for the label, help and error to reach it. */
export interface FieldControl {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  required: true | undefined;
}

export function Field({
  label,
  help,
  error,
  requirement,
  className,
  children,
}: {
  /** What the input is, shown above it and tied to it. */
  label: ReactNode;
  /** A sentence under the input: what to write, or what happens next. */
  help?: ReactNode;
  /** What is wrong right now. Its presence is what marks the input invalid. */
  error?: ReactNode;
  /** The word after the label, where a form has some of each. */
  requirement?: "required" | "optional";
  className?: string;
  children: (control: FieldControl) => ReactNode;
}) {
  const base = useId();
  const id = `${base}-input`;
  const helpId = `${base}-help`;
  const errorId = `${base}-error`;
  const described = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ");
  const control: FieldControl = {
    id,
    "aria-describedby": described || undefined,
    "aria-invalid": error ? true : undefined,
    required: requirement === "required" ? true : undefined,
  };
  return (
    <div className={["field", error ? "error" : "", className].filter(Boolean).join(" ")}>
      <label className="fieldLabel" htmlFor={id}>
        {label}
        {requirement && <span className="muted"> {requirement}</span>}
      </label>
      {children(control)}
      {help && (
        <span className="fieldHelp" id={helpId}>
          {help}
        </span>
      )}
      {error && (
        <span className="fieldNote error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}
