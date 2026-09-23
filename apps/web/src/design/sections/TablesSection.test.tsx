// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { computeAccessibleDescription } from "dom-accessibility-api";
import type { Diagnostic } from "@runlog/rules-schema";
import { TablesSection } from "./TablesSection.tsx";

afterEach(cleanup);

const draft = {
  requires: [
    { id: "wheel", label: "A wheel" },
    { id: "kiln", label: "A kiln" },
  ],
  tables: {
    form: {
      title: "Form",
      resolution: "lookup",
      roll: "d6",
      entries: [{ id: "cup", range: "1-6", title: "A cup", needs: ["wheel"] }],
    },
  },
};

function openForm(diagnostics: Diagnostic[] = []) {
  const edit = vi.fn();
  render(<TablesSection draft={draft} diagnostics={diagnostics} edit={edit} />);
  fireEvent.click(screen.getByRole("button", { name: /Form/ }));
  return edit;
}

describe("an entry's needs", () => {
  it("presses and checks what the entry needs, and nothing else", () => {
    openForm();
    const wheel = screen.getByRole("button", { name: "A wheel", pressed: true });
    expect(wheel.querySelector(".pickMark svg")).not.toBeNull();
    expect(wheel.classList.contains("toggleChip")).toBe(true);
    expect(screen.getByRole("button", { name: "A kiln", pressed: false }).querySelector(".pickMark")).toBeNull();
  });
});

describe("the table disclose button", () => {
  it("says whether the table is open and what it opens", () => {
    render(<TablesSection draft={draft} diagnostics={[]} edit={vi.fn()} />);
    const disclose = screen.getByRole("button", { name: /Form/ });
    expect(disclose.getAttribute("aria-expanded")).toBe("false");

    const controls = disclose.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toBeNull();

    fireEvent.click(disclose);
    expect(disclose.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(controls!)).not.toBeNull();
  });
});

describe("a table's problems", () => {
  const broken: Diagnostic[] = [
    { level: "error", code: "table/range-gap", path: "tables.form.entries", message: "Nothing covers 7." },
    { level: "warning", code: "entry/needs", path: "tables.form.entries[0].needs", message: "Nothing grants this." },
  ];

  it("counts its errors in words and a glyph while it is closed", () => {
    render(<TablesSection draft={draft} diagnostics={broken} edit={vi.fn()} />);
    const chip = document.querySelector(".subEditorHead .tableErrors")!;
    expect(chip.textContent).toBe("✕1 error");
    expect(chip.querySelector(".severityGlyph")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("names the severity of a needs note for a screen reader", () => {
    openForm(broken);
    const needs = screen.getByRole("group", { name: "Needs" });
    expect(computeAccessibleDescription(needs)).toContain("Warning: Nothing grants this.");
  });
});
