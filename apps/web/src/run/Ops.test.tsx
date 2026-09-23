// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { computeAccessibleDescription } from "dom-accessibility-api";
import { NameField } from "./Ops.tsx";

afterEach(cleanup);

describe("a name the tool does not know", () => {
  it("is invalid, dashed, and described as a warning without growing the row", () => {
    render(<NameField label="Item" typed="Moonveill" fits={false} listId="l" note={undefined} onChange={() => {}} />);
    // A `list` attribute makes this a combobox in the accessibility tree, whether or not the datalist exists.
    const input = screen.getByRole("combobox", { name: "Item" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.classList.contains("wrongName")).toBe(true);
    expect(computeAccessibleDescription(input)).toBe("Warning: Nothing the tool knows is called that");
    expect(document.querySelector(".opNameNote")?.className).toBe("opNameNote visuallyHidden");
  });

  it("says nothing extra for a name it knows", () => {
    render(<NameField label="Item" typed="Moonveil" fits={true} listId="l" note="The weapon" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Item" });
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(document.querySelector(".opNameNote")).toBeNull();
  });
});
