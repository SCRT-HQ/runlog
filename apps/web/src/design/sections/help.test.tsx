// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { computeAccessibleDescription } from "dom-accessibility-api";
import { blankPack } from "../draft.ts";
import { help } from "../help.ts";
import { Overview } from "./Overview.tsx";
import { ModesSection } from "./ModesSection.tsx";
import { TablesSection } from "./TablesSection.tsx";

afterEach(cleanup);

describe("editing help in the real sections", () => {
  it("associates vocabulary help and requirement errors with their actual controls", () => {
    const draft = blankPack();
    draft.requires = [{ id: "wheel", label: "Wheel", kind: "equipment", optional: true }];
    render(
      <Overview
        draft={draft}
        edit={vi.fn()}
        diagnostics={[{ level: "error", code: "test", path: "requires.0.optional", message: "Check this choice." }]}
      />,
    );
    expect(computeAccessibleDescription(screen.getByRole("textbox", { name: "A whole session - one" }))).toBe(help("vocabulary.run"));
    const optional = screen.getByRole("checkbox", { name: "Nice to have, not needed" });
    expect(optional.getAttribute("aria-invalid")).toBe("true");
    expect(computeAccessibleDescription(optional)).toContain(help("requires[].optional"));
    expect(computeAccessibleDescription(optional)).toContain("Check this choice.");
  });

  it("shows seeded help even when a mode id contains dots", () => {
    const draft = blankPack();
    draft.modes = { "shared.practice": { label: "Practice", seeded: true } };
    draft.defaultMode = "shared.practice";
    render(<ModesSection draft={draft} edit={vi.fn()} diagnostics={[]} />);
    expect(computeAccessibleDescription(screen.getByRole("checkbox", { name: "Seeded" }))).toBe(help("modes.*.seeded"));
  });

  it("handles dotted table ids, both range endpoints, and the Needs group", () => {
    const draft = blankPack();
    draft.requires = [{ id: "wheel", label: "Wheel", optional: true }];
    draft.tables = {
      "weather.today": {
        title: "Weather",
        resolution: "lookup",
        roll: "d6",
        entries: [{ id: "one", range: [1, 6], text: "Make a piece.", needs: ["wheel"] }],
      },
    };
    render(
      <TablesSection
        draft={draft}
        edit={vi.fn()}
        diagnostics={[{ level: "error", code: "test", path: "tables.weather.today.entries.0.range", message: "Check the range." }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Weather.*lookup/ }));
    expect(computeAccessibleDescription(screen.getByRole("combobox", { name: "Resolution" }))).toBe(help("tables.*.resolution"));
    for (const name of ["From", "To"]) {
      const input = screen.getByRole("textbox", { name });
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(computeAccessibleDescription(input)).toContain("Check the range.");
      expect(computeAccessibleDescription(input)).toContain(help("tables.*.entries[].range"));
    }
    const needs = screen.getByRole("group", { name: "Needs" });
    expect(computeAccessibleDescription(needs)).toBe(help("tables.*.entries[].needs"));
    expect(screen.getByRole("button", { name: "Wheel" }).getAttribute("aria-pressed")).toBe("true");
  });
});
