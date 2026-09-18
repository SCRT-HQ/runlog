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
  it("shows renamed preset labels on the legacy values without the old display names", () => {
    render(<ThemeMenu />);

    expect((screen.getByRole("option", { name: "High contrast dark" }) as HTMLOptionElement).value).toBe("high-contrast-dark");
    expect((screen.getByRole("option", { name: "High contrast light" }) as HTMLOptionElement).value).toBe("high-contrast-light");
    expect((screen.getByRole("option", { name: "Linked" }) as HTMLOptionElement).value).toBe("retro-arcade");
    expect((screen.getByRole("option", { name: "Spacewalk" }) as HTMLOptionElement).value).toBe("cyberpunk");
    expect((screen.getByRole("option", { name: "Samurai" }) as HTMLOptionElement).value).toBe("cyberpunk-neon");
    expect(screen.queryByRole("option", { name: "Retro Arcade" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Cyberpunk" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Cyberpunk Neon" })).toBeNull();
  });

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

  it.each(["high-contrast-dark", "high-contrast-light", "retro-arcade", "cyberpunk", "cyberpunk-neon"])(
    "applies and remembers expanded preset %s",
    (id) => {
      render(<ThemeMenu />);

      fireEvent.change(screen.getByLabelText("Theme"), { target: { value: id } });

      expect(document.documentElement.dataset.theme).toBe(id);
      expect(document.documentElement.style.getPropertyValue("--bg")).not.toBe("");
      expect(document.documentElement.style.getPropertyValue("--accent")).not.toBe("");
      expect(document.documentElement.style.getPropertyValue("--font-ui")).not.toBe("");
      expect(document.documentElement.style.getPropertyValue("--font-display")).not.toBe("");
      expect(document.documentElement.style.getPropertyValue("--font-mono")).not.toBe("");
      expect(document.documentElement.style.getPropertyValue("--font-technical")).not.toBe("");
      expect(localStorage.getItem("runlog.theme")).toBe(id);
    },
  );

  it("reads an expanded saved choice after remounting", () => {
    localStorage.setItem("runlog.theme", "retro-arcade");
    const first = render(<ThemeMenu />);
    expect((screen.getByLabelText("Theme") as HTMLSelectElement).value).toBe("retro-arcade");

    first.unmount();
    render(<ThemeMenu />);

    expect((screen.getByLabelText("Theme") as HTMLSelectElement).value).toBe("retro-arcade");
  });
});
