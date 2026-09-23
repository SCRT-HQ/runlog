// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RunMenuButton } from "./RunMenuButton.tsx";

afterEach(cleanup);

describe("the phone run menu", () => {
  it("draws a flag and says so in its name when something waits", () => {
    render(<RunMenuButton flagged open={false} noun="firing" onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "This firing, something to see" });
    expect(button.querySelector(".runMenuFlag")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("is plain when nothing waits", () => {
    render(<RunMenuButton flagged={false} open noun="firing" onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "This firing" });
    expect(button.querySelector(".runMenuFlag")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});
