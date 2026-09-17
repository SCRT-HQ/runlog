// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { computeAccessibleDescription, computeAccessibleName } from "dom-accessibility-api";
import type { Diagnostic } from "@runlog/rules-schema";
import { describe as schemaDescription } from "./describe.ts";
import { help } from "./help.ts";
import { CheckField, Field, fieldDomId } from "./fields.tsx";

afterEach(cleanup);

function diagnostic(level: Diagnostic["level"], path: string, message: string): Diagnostic {
  return { level, path, message, code: `test/${level}` };
}

describe("a Designer field", () => {
  it("has an exact label and gives the input the task-focused help", () => {
    render(
      <Field label="Id" path="id" help="Old caller help">
        <input />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: "Id" });
    const taskHelp = help("id")!;
    expect(computeAccessibleName(input)).toBe("Id");
    expect(computeAccessibleDescription(input)).toBe(taskHelp);
    expect(screen.getByText(taskHelp).className).toBe("fieldHelp");
    expect(screen.queryByText("Old caller help")).toBeNull();
  });

  it("keeps a differing schema description in a collapsed native disclosure outside the label", () => {
    render(
      <Field label="Id" path="id">
        <input />
      </Field>,
    );

    const details = screen.getByText("Schema reference").closest("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain(schemaDescription("id"));
    expect(details.closest("label")).toBeNull();
    expect(computeAccessibleName(screen.getByRole("textbox"))).toBe("Id");
  });

  it("uses the schema description as fallback without repeating it as reference", () => {
    render(
      <Field label="Title" path="title">
        <input />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: "Title" });
    expect(computeAccessibleDescription(input)).toBe(schemaDescription("title"));
    expect(screen.queryByText("Schema reference")).toBeNull();
  });

  it("uses custom caller help and offers the schema wording as reference", () => {
    render(
      <Field label="Title" path="title" help="The name players see in their library.">
        <input />
      </Field>,
    );

    expect(computeAccessibleDescription(screen.getByRole("textbox", { name: "Title" }))).toBe("The name players see in their library.");
    expect(screen.getByText("Schema reference").closest("details")!.textContent).toContain(schemaDescription("title"));
  });

  it("uses a schema path override for split and synthetic controls", () => {
    render(
      <Field label="To" path="tables.firing.entries[2].rangeTo" schemaPath="tables.*.entries[].range">
        <input />
      </Field>,
    );

    expect(computeAccessibleDescription(screen.getByRole("textbox", { name: "To" }))).toBe(help("tables.firing.entries[2].range"));
    expect(screen.getByText("Schema reference").closest("details")!.textContent).toContain(schemaDescription("tables.*.entries[].range"));
  });

  it("uses an explicit schema path when a map key contains dots", () => {
    render(
      <Field label="Roll" path="tables.weather.today.roll" schemaPath="tables.*.roll">
        <input />
      </Field>,
    );

    expect(computeAccessibleDescription(screen.getByRole("textbox", { name: "Roll" }))).toBe(help("tables.*.roll"));
  });

  it("describes warnings and errors, but marks only errors invalid", () => {
    const { rerender } = render(
      <Field label="Roll" path="tables.firing.roll" diagnostics={[diagnostic("warning", "tables.firing.roll", "This roll is unusual.")]}>
        <input />
      </Field>,
    );

    let input = screen.getByRole("textbox", { name: "Roll" });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(computeAccessibleDescription(input)).toContain("This roll is unusual.");

    rerender(
      <Field
        label="Roll"
        path="tables.firing.roll"
        diagnostics={[
          diagnostic("warning", "tables.firing.roll", "This roll is unusual."),
          diagnostic("error", "tables.firing.roll", "The dice expression cannot be read."),
        ]}
      >
        <input />
      </Field>,
    );
    input = screen.getByRole("textbox", { name: "Roll" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(computeAccessibleDescription(input)).toContain("This roll is unusual.");
    expect(computeAccessibleDescription(input)).toContain("The dice expression cannot be read.");
  });

  it("matches dotted diagnostic indices to bracketed field paths", () => {
    render(
      <Field label="Kind" path="requires[0].kind" diagnostics={[diagnostic("error", "requires.0.kind", "Choose a known kind.")]}>
        <input />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: "Kind" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(computeAccessibleDescription(input)).toContain("Choose a known kind.");
  });

  it("can match diagnostics at the real value while keeping a synthetic focus path", () => {
    render(
      <Field
        label="To"
        path="tables.firing.entries[0].rangeTo"
        diagnosticPath="tables.firing.entries[0].range"
        schemaPath="tables.*.entries[].range"
        diagnostics={[diagnostic("error", "tables.firing.entries.0.range", "This range overlaps another.")]}
      >
        <input />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: "To" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.closest("[data-path]")!.getAttribute("data-path")).toBe("tables.firing.entries[0].rangeTo");
    expect(computeAccessibleDescription(input)).toContain("This range overlaps another.");
  });

  it("gives duplicate paths distinct per-instance association ids", () => {
    render(
      <>
        <Field label="First" path="title" diagnostics={[diagnostic("error", "title", "Fix the first.")]}>
          <input />
        </Field>
        <Field label="Second" path="title" diagnostics={[diagnostic("error", "title", "Fix the second.")]}>
          <input />
        </Field>
      </>,
    );

    const [first, second] = screen.getAllByRole("textbox");
    expect(first!.id).not.toBe(second!.id);
    const firstIds = first!.getAttribute("aria-describedby")!.split(" ");
    const secondIds = second!.getAttribute("aria-describedby")!.split(" ");
    expect(firstIds.every((id) => !secondIds.includes(id))).toBe(true);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
  });

  it("preserves an explicit control id and existing aria description", () => {
    render(
      <>
        <p id="outside-help">Outside context.</p>
        <Field label="Title" path="title">
          <input id="kept-id" aria-describedby="outside-help" aria-controls="preview" />
        </Field>
      </>,
    );

    const input = screen.getByRole("textbox", { name: "Title" });
    expect(input.id).toBe("kept-id");
    expect(document.querySelector("label")!.htmlFor).toBe("kept-id");
    expect(input.getAttribute("aria-controls")).toBe("preview");
    expect(computeAccessibleDescription(input)).toContain("Outside context.");
    expect(computeAccessibleDescription(input)).toContain(schemaDescription("title"));
  });

  it("keeps a badge out of the input's name", () => {
    render(
      <Field label="Id" path="id" badge={<span>Placeholder</span>}>
        <input />
      </Field>,
    );

    expect(computeAccessibleName(screen.getByRole("textbox"))).toBe("Id");
    expect(screen.getByText("Placeholder")).toBeTruthy();
  });
});

describe("a Designer checkbox", () => {
  it("keeps its legacy API while separating its name from its help", () => {
    render(<CheckField label="Starts here" help="Used for the first turn." value={false} onChange={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox", { name: "Starts here" });
    expect(computeAccessibleName(checkbox)).toBe("Starts here");
    expect(computeAccessibleDescription(checkbox)).toBe("Used for the first turn.");
  });

  it("uses path help and diagnostics with a focusable field wrapper", () => {
    render(
      <CheckField
        label="Its text may travel"
        path="license.redistributable"
        diagnostics={[diagnostic("error", "license.redistributable", "Choose whether the text may travel.")]}
        value={true}
        onChange={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Its text may travel" });
    const wrapper = document.getElementById(fieldDomId("license.redistributable"))!;
    expect(wrapper.dataset.path).toBe("license.redistributable");
    expect(checkbox.getAttribute("aria-invalid")).toBe("true");
    expect(computeAccessibleDescription(checkbox)).toContain(help("license.redistributable"));
    expect(computeAccessibleDescription(checkbox)).toContain("Choose whether the text may travel.");
    expect(within(wrapper).getByText("Schema reference").closest("details")!.open).toBe(false);
  });
});
