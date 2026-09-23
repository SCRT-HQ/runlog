import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import type { Diagnostic } from "@runlog/rules-schema";
import { describe } from "./describe.ts";
import { help as appHelp, schemaPath as normalizeSchemaPath } from "./help.ts";
import { Severity } from "../ui/Severity.tsx";

/**
 * Form pieces for the pack editor.
 *
 * Two things they all share. Help written for the editing task is preferred,
 * with the schema's own description kept as reference and fallback. And every
 * field can carry the linter's diagnostics for its own path, so a problem is
 * reported *at* the thing that caused it instead of in a list at the bottom.
 */

export interface FieldProps {
  label: string;
  /** Dotted path into the pack. Also what diagnostics are matched against. */
  path: string;
  /** Schema path to use when the control edits only part of a schema value. */
  schemaPath?: string;
  /** Diagnostic path to match when a synthetic control edits part of a value. */
  diagnosticPath?: string;
  help?: string;
  diagnostics?: readonly Diagnostic[];
  /**
   * Something to say about the value that is not a problem with it.
   *
   * Drawn after the label element rather than inside it. A label names the
   * control it wraps out of everything it contains, so a badge put anywhere
   * in there would become part of the input's name; beside it, the word is
   * still read out in its own right and the field is still called what it
   * is called.
   */
  badge?: ReactNode;
  children?: ReactNode;
}

/** Diagnostics belonging to a path, including anything nested beneath it. */
export function at(diagnostics: readonly Diagnostic[], path: string): Diagnostic[] {
  const normalizedPath = path.replace(/\[(\d+)\]/g, ".$1");
  return diagnostics.filter((diagnostic) => {
    const candidate = diagnostic.path.replace(/\[(\d+)\]/g, ".$1");
    return candidate === normalizedPath || candidate.startsWith(`${normalizedPath}.`);
  });
}

/**
 * The DOM id of the field that edits a path.
 *
 * Derived rather than stored, so the Test section can name a field from
 * nothing but the dotted path the linter gave it, without a register of
 * every field the editor has drawn.
 */
export function fieldDomId(path: string): string {
  return `field-${path.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

/**
 * Show the field that edits a path, and put the keyboard in it.
 *
 * A diagnostic's path is often coarser than any one field: the linter
 * says `tables.setback.entries[3]` where the editor has an id, a range
 * and a text. So the exact field is tried first and the first field
 * underneath it second, which is the row the problem is about either way.
 */
export function focusField(path: string): boolean {
  const exact = document.getElementById(fieldDomId(path));
  const found =
    exact ??
    Array.from(document.querySelectorAll<HTMLElement>("[data-path]")).find((el) => {
      const own = el.dataset.path ?? "";
      return own.startsWith(`${path}.`) || own.startsWith(`${path}[`);
    });
  if (!found) return false;
  found.scrollIntoView?.({ block: "center" });
  const control =
    found.querySelector<HTMLElement>("input, select, textarea") ??
    (found.matches("input, select, textarea") ? found : null) ??
    found.querySelector<HTMLElement>("button, [tabindex]") ??
    (found.matches("button, [tabindex]") ? found : null);
  control?.focus();
  return true;
}

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
};

function joinIds(...values: Array<string | undefined>): string | undefined {
  const ids = values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? []);
  return ids.length > 0 ? [...new Set(ids)].join(" ") : undefined;
}

function isControl(child: ReactNode): child is ReactElement<ControlProps> {
  return (
    isValidElement<ControlProps>(child) &&
    typeof child.type === "string" &&
    (child.type === "input" || child.type === "select" || child.type === "textarea")
  );
}

function copyFor(path: string | undefined, schemaPath: string | undefined, provided: string | undefined) {
  if (!path) return { shown: provided, reference: undefined };

  const sourcePath = schemaPath ?? path;
  const reference = describe(normalizeSchemaPath(sourcePath));
  const authored = appHelp(sourcePath) ?? provided;
  return {
    shown: authored ?? reference,
    reference: authored && reference && authored !== reference ? reference : undefined,
  };
}

function Notes({
  help,
  helpId,
  diagnostics,
  noteId,
  reference,
}: {
  help: string | undefined;
  helpId: string;
  diagnostics: readonly Diagnostic[];
  noteId: (index: number) => string;
  reference: string | undefined;
}) {
  return (
    <>
      {help && (
        <span className="fieldHelp" id={helpId}>
          {help}
        </span>
      )}
      {diagnostics.map((diagnostic, index) => (
        <span key={index} className={`fieldNote ${diagnostic.level}`} id={noteId(index)}>
          <Severity level={diagnostic.level} show="glyph" />
          {diagnostic.message}
        </span>
      ))}
      {reference && (
        <details className="fieldReference">
          <summary>Schema reference</summary>
          <p>{reference}</p>
        </details>
      )}
    </>
  );
}

export function Field({ label, path, schemaPath, diagnosticPath, help, diagnostics = [], badge, children }: FieldProps) {
  const instanceId = useId();
  const directControl = Children.toArray(children).find(isControl);
  const controlId = directControl?.props.id ?? `${instanceId}-control`;
  const helpId = `${instanceId}-help`;
  const noteId = (index: number) => `${instanceId}-note-${index}`;
  const mine = at(diagnostics, diagnosticPath ?? path);
  const hasError = mine.some((diagnostic) => diagnostic.level === "error");
  const worst = hasError ? "error" : mine.length > 0 ? "warn" : "";
  const copy = copyFor(path, schemaPath, help);
  const describedBy = joinIds(copy.shown ? helpId : undefined, ...mine.map((_, index) => noteId(index)));

  const control = Children.map(children, (child) => {
    if (!isControl(child)) return child;
    return cloneElement(child, {
      id: controlId,
      "aria-describedby": joinIds(child.props["aria-describedby"], describedBy),
      "aria-invalid": hasError ? true : child.props["aria-invalid"],
    });
  });

  const field = (
    <div className={`field ${worst}`} id={fieldDomId(path)} data-path={path}>
      <label className="fieldLabel" htmlFor={controlId}>
        {label}
      </label>
      {control}
      <Notes help={copy.shown} helpId={helpId} diagnostics={mine} noteId={noteId} reference={copy.reference} />
    </div>
  );

  // Only wrapped where there is something to put beside the label, so the
  // fields that have nothing to say about their value are the same element
  // they have always been.
  return badge ? (
    <div className="fieldWithBadge">
      {field}
      {badge}
    </div>
  ) : (
    field
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  mono,
  ...field
}: FieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <Field {...field}>
      <input
        className={`textInput ${mono ? "mono" : ""}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function AreaField({
  value,
  onChange,
  rows = 3,
  ...field
}: FieldProps & { value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <Field {...field}>
      <textarea className="textInput area" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function NumberField({ value, onChange, ...field }: FieldProps & { value: number; onChange: (value: number) => void }) {
  return (
    <Field {...field}>
      <input
        className="textInput short"
        inputMode="numeric"
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(e) => {
          const next = Number(e.target.value.replace(/[^-0-9]/g, ""));
          onChange(Number.isFinite(next) ? next : 0);
        }}
      />
    </Field>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  ...field
}: FieldProps & {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <Field {...field}>
      <select className="textInput" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField({
  value,
  onChange,
  label,
  path,
  schemaPath,
  help,
  diagnostics = [],
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  path?: string;
  schemaPath?: string;
  help?: string;
  diagnostics?: readonly Diagnostic[];
}) {
  const instanceId = useId();
  const controlId = `${instanceId}-control`;
  const helpId = `${instanceId}-help`;
  const noteId = (index: number) => `${instanceId}-note-${index}`;
  const mine = path ? at(diagnostics, path) : [];
  const hasError = mine.some((diagnostic) => diagnostic.level === "error");
  const worst = hasError ? "error" : mine.length > 0 ? "warn" : "";
  const copy = copyFor(path, schemaPath, help);
  const describedBy = joinIds(copy.shown ? helpId : undefined, ...mine.map((_, index) => noteId(index)));

  return (
    <div className={`toggle designToggle ${worst}`} id={path ? fieldDomId(path) : undefined} data-path={path}>
      <input
        id={controlId}
        type="checkbox"
        checked={value}
        aria-describedby={describedBy}
        aria-invalid={hasError || undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="designToggleText">
        <label htmlFor={controlId}>{label}</label>
        <Notes help={copy.shown} helpId={helpId} diagnostics={mine} noteId={noteId} reference={copy.reference} />
      </div>
    </div>
  );
}

/** A row of small buttons: add, remove, move. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="rowActions">{children}</div>;
}
