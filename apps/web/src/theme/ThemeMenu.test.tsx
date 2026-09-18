// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeMenu } from "./ThemeMenu.tsx";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.theme;
});

describe("theme menu", () => {
  it("applies and remembers the selected explicit theme", () => {
    render(<ThemeMenu />);

    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "ember" } });

    expect(document.documentElement.dataset.theme).toBe("ember");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#1a1210");
    expect(localStorage.getItem("runlog.theme")).toBe("ember");
  });

  it("hands presentation back to the system and removes the saved choice", () => {
    localStorage.setItem("runlog.theme", "ember");
    render(<ThemeMenu />);
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "ember" } });

    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "system" } });

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe("");
    expect(localStorage.getItem("runlog.theme")).toBeNull();
  });
});
