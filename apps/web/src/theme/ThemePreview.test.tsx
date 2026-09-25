// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotForBuiltin } from "./appearance.ts";
import { ThemePreview } from "./ThemePreview.tsx";
import { WIDGET_BACKGROUNDS, WIDGET_KINDS } from "../widget/route.ts";

afterEach(cleanup);

describe("theme preview", () => {
  it("applies the snapshot only to nested app and widget hosts and renders real public fixture data", () => {
    document.documentElement.style.setProperty("--bg", "#123456");
    const rootBefore = document.documentElement.style.cssText;
    render(<ThemePreview snapshot={snapshotForBuiltin("stardust")} />);

    const app = screen.getByTestId("theme-app-preview");
    const widget = screen.getByTestId("theme-widget-preview");
    expect(app.style.getPropertyValue("--bg")).not.toBe("");
    expect(widget.style.getPropertyValue("--bg")).not.toBe("");
    expect(screen.getByText(/Scoreboard · 2 racing/)).toBeTruthy();
    expect(screen.getByText("Mira")).toBeTruthy();
    expect(screen.getByLabelText("Example input").classList.contains("textInput")).toBe(true);
    expect(document.documentElement.style.cssText).toBe(rootBefore);
  });

  it("offers every widget kind/background, the parser scale range, and four contrast backdrops", () => {
    const changed = vi.fn();
    render(<ThemePreview snapshot={snapshotForBuiltin("daylight")} onBackdropChange={changed} />);

    expect(screen.getByLabelText("Widget kind").querySelectorAll("option")).toHaveLength(WIDGET_KINDS.length);
    expect(screen.getByLabelText("Widget background").querySelectorAll("option")).toHaveLength(WIDGET_BACKGROUNDS.length);
    const scale = screen.getByLabelText("Widget scale") as HTMLInputElement;
    expect([scale.min, scale.max]).toEqual(["0.5", "4"]);
    const backdrop = screen.getByLabelText("Preview backdrop") as HTMLSelectElement;
    expect(backdrop.querySelectorAll("option")).toHaveLength(4);
    // The theme's own page color comes first, is the default, and names its hex.
    const page = snapshotForBuiltin("daylight").colors["surface.page"];
    expect(backdrop.value).toBe("page");
    expect(backdrop.querySelectorAll("option")[0]!.textContent).toBe(`This theme's page · ${page}`);
    expect(changed).toHaveBeenLastCalledWith(page);

    fireEvent.change(screen.getByLabelText("Widget kind"), { target: { value: "race" } });
    expect(screen.getByText(/Studio race/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Widget background"), { target: { value: "none" } });
    expect(screen.getByTestId("theme-widget-preview").getAttribute("data-preview-widget-background")).toBe("none");
    fireEvent.change(scale, { target: { value: "2.5" } });
    expect(screen.getByTestId("theme-widget-scale").getAttribute("style")).toContain("2.5");
    fireEvent.change(screen.getByLabelText("Preview backdrop"), { target: { value: "unknown" } });
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(document.documentElement.dataset.widget).toBeUndefined();
  });

  it("keeps the page backdrop on the theme's page color as it changes", () => {
    const changed = vi.fn();
    const view = render(<ThemePreview snapshot={snapshotForBuiltin("daylight")} onBackdropChange={changed} />);
    const night = snapshotForBuiltin("lights-down");
    view.rerender(<ThemePreview snapshot={night} onBackdropChange={changed} />);
    expect(changed).toHaveBeenLastCalledWith(night.colors["surface.page"]);
    expect(screen.getByRole("region", { name: "Widget preview scroll area" }).style.backgroundColor).not.toBe("");
  });
});
