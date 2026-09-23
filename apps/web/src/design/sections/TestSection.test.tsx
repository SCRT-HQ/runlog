// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TestSection } from "./TestSection.tsx";

afterEach(cleanup);

describe("the Test section's problem list", () => {
  it("says Error or Warning in words in front of every row", () => {
    render(
      <TestSection
        result={{
          ok: false,
          pack: null,
          diagnostics: [
            { level: "error", code: "schema/required", path: "title", message: "A title is needed." },
            { level: "warning", code: "table/unused", path: "tables.loot", message: "Nothing rolls this table." },
          ],
        }}
        onGo={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Error: A title is needed\./ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Warning: Nothing rolls this table\./ })).toBeTruthy();
    expect(document.querySelectorAll(".problemList .severityWord")).toHaveLength(2);
  });
});
