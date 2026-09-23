// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Table } from "@runlog/rules-schema";
import { TableLookList } from "./TableLookList.tsx";

afterEach(cleanup);

const table = { title: "Weather" } as Table;
const lines = [
  { id: "a", value: 1, range: "1-3", title: "Rain" },
  { id: "b", value: 4, range: "4-6", title: "Sun" },
];

describe("the line a roll lands on", () => {
  it("is marked current, with a hidden marker in its range column", () => {
    render(<TableLookList table={table} lines={lines} landing="b" onPick={() => {}} />);
    const sun = screen.getByRole("button", { name: /Sun/ });
    expect(sun.getAttribute("aria-current")).toBe("true");
    const marker = sun.querySelector(".range .lands")!;
    expect(marker.textContent).toBe("▸ ");
    expect(marker.getAttribute("aria-hidden")).toBe("true");
    const rain = screen.getByRole("button", { name: /Rain/ });
    expect(rain.getAttribute("aria-current")).toBeNull();
    expect(rain.querySelector(".lands")).toBeNull();
  });
});
