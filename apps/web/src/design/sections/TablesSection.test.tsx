// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
