// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Field } from "./Field.tsx";

/**
 * A label that is really a label, and a problem the input admits to.
 *
 * None of this is visible, which is why it is tested rather than looked
 * at: `for` is what makes the words above the box its name, and
 * `aria-describedby` is what makes the sentence under it reach anybody
 * who never sees the two sit together.
 */

afterEach(cleanup);

describe("a field", () => {
  it("ties the label to the input", () => {
    render(<Field label="Shown as">{(control) => <input {...control} />}</Field>);
    const input = screen.getByLabelText("Shown as");
    expect(input.tagName).toBe("INPUT");
    expect(input.id).toBeTruthy();
    expect(document.querySelector("label")?.getAttribute("for")).toBe(input.id);
  });

  it("carries help to the input, and does not call it a problem", () => {
    render(
      <Field label="Shown as" help="Two to twenty-four letters.">
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText("Shown as");
    const help = screen.getByText("Two to twenty-four letters.");
    expect(input.getAttribute("aria-describedby")).toBe(help.id);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("marks the input invalid while there is something wrong with it", () => {
    render(
      <Field label="Shown as" help="Two to twenty-four letters." error="That name is taken.">
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText("Shown as");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // Both reach it, and in the order they are read.
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described).toHaveLength(2);
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual(["Two to twenty-four letters.", "That name is taken."]);
  });

  it("says which fields a form insists on", () => {
    render(
      <Field label="Email address" requirement="required">
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText(/Email address/);
    expect(input.hasAttribute("required")).toBe(true);
    expect(document.querySelector("label")?.textContent).toBe("Email address required");
  });

  it("gives two fields on one page two sets of ids", () => {
    render(
      <>
        <Field label="One">{(control) => <input {...control} />}</Field>
        <Field label="Two">{(control) => <input {...control} />}</Field>
      </>,
    );
    expect(screen.getByLabelText("One").id).not.toBe(screen.getByLabelText("Two").id);
  });
});
