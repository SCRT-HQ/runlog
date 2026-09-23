// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModesSection } from "./ModesSection.tsx";

afterEach(cleanup);

const draft = {
  modes: { solo: { label: "Solo", disable: { tables: ["weather"] } } },
  tables: { weather: { title: "Weather" }, loot: { title: "Loot" } },
};

describe("leaving things out of a mode", () => {
  it("presses and checks what is left out, and nothing else", () => {
    const edit = vi.fn();
    render(<ModesSection draft={draft} diagnostics={[]} edit={edit} />);
    const group = screen.getByRole("group", { name: "Leave out: Tables" });
    const weather = within(group).getByRole("button", { name: "weather", pressed: true });
    expect(weather.querySelector(".pickMark svg")).not.toBeNull();
    const loot = within(group).getByRole("button", { name: "loot", pressed: false });
    expect(loot.querySelector(".pickMark")).toBeNull();
    fireEvent.click(loot);
    expect(edit).toHaveBeenCalledWith(["modes", "solo", "disable"], { tables: ["weather", "loot"] });
  });
});
