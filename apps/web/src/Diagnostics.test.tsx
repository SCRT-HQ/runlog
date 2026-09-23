// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Diagnostics } from "./Diagnostics.tsx";

afterEach(cleanup);

describe("the page a pack that did not load shows", () => {
  it("says Error or Warning in words beside each code", () => {
    render(
      <Diagnostics
        diagnostics={[
          { level: "error", code: "schema/required", path: "title", message: "A title is needed." },
          { level: "warning", code: "table/unused", path: "tables.loot", message: "Nothing rolls this table." },
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]!.querySelector(".severityWord")?.textContent).toBe("Error:");
    expect(rows[1]!.querySelector(".severityWord")?.textContent).toBe("Warning:");
    expect(screen.getByRole("heading", { name: "This pack did not load" })).toBeTruthy();
  });
});
