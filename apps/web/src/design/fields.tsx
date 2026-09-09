import type { ReactNode } from "react";
import type { Diagnostic } from "@runlog/rules-schema";

/**
 * Form pieces for the pack editor.
 *
 * Two things they all share. Help text comes from the schema's own field
 * descriptions rather than being written again here, so the sentence an author
 * reads in the editor is the same one their code editor shows on hover, and
 * neither can drift from the other. And every field can carry the linter's
 * diagnostics for its own path, so a problem is reported *at* the thing that
 * caused it instead of in a list at the bottom.
 */

export interface FieldProps {
  label: string;
  /** Dotted path into the pack. Also what diagnostics are matched against. */
  path: string;
  help?: string;
  diagnostics?: readonly Diagnostic[];
  children?: ReactNode;
}

/** Diagnostics belonging to a path, including anything nested beneath it. */
export function at(diagnostics: readonly Diagnostic[], path: string): Diagnostic[] {
  return diagnostics.filter((d) => d.path === path || d.path.startsWith(`${path}.`));
}

export function Field({ label, path, help, diagnostics = [], children }: FieldProps) {
  const mine = at(diagnostics, path);
  const worst = mine.some((d) => d.level === "error") ? "error" : mine.length > 0 ? "warn" : "";

  return (
    <label className={`field ${worst}`}>
      <span className="fieldLabel">{label}</span>
      {children}
      {help && <span className="fieldHelp">{help}</span>}
      {mine.map((d, i) => (
        <span key={i} className={`fieldNote ${d.level}`}>
          {d.message}
        </span>
      ))}
    </label>
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
      <textarea
        className="textInput area"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberField({
  value,
  onChange,
  ...field
}: FieldProps & { value: number; onChange: (value: number) => void }) {
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
  help,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  help?: string;
}) {
  return (
    <label className="toggle designToggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {help && <span className="fieldHelp inline">{help}</span>}
      </span>
    </label>
  );
}

/** A row of small buttons: add, remove, move. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="rowActions">{children}</div>;
}
