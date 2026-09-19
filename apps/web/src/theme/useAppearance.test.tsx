// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_KEY, applyBootAppearance, snapshotForBuiltin, type BootAppearanceV1 } from "./appearance.ts";

afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("data-theme");
  for (const property of [...document.documentElement.style]) {
    if (property.startsWith("--") || property === "color-scheme") document.documentElement.style.removeProperty(property);
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadStore() {
  return import("./useAppearance.ts");
}

describe("device appearance store", () => {
  it("selects recovery System without reading stored custom values", async () => {
    history.replaceState(null, "", "/#themes/recovery");
    const read = vi.spyOn(Storage.prototype, "getItem");

    const { useAppearance } = await loadStore();
    function Probe() {
      const appearance = useAppearance();
      return <output>{appearance.mode}</output>;
    }
    render(<Probe />);

    expect(screen.getByText("system")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it("selects recovery System from the real hosted path before the provider can restore a stored snapshot", async () => {
    const stored = { schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("ember") } as const;
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(stored));
    applyBootAppearance(stored, document.documentElement);
    history.replaceState(null, "", "/themes/recovery");
    const read = vi.spyOn(Storage.prototype, "getItem");

    const { ThemeProvider } = await import("./ThemeProvider.tsx");
    const { useAppearance } = await loadStore();
    function Probe() {
      return <output>{useAppearance().mode}</output>;
    }
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByText("system")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("");
  });

  it("writes and validates before publishing a frozen in-tab value", async () => {
    const { setDeviceAppearance, useAppearance } = await loadStore();
    const seen: BootAppearanceV1[] = [];
    function Probe() {
      const appearance = useAppearance();
      seen.push(appearance);
      return <output>{appearance.mode}</output>;
    }
    render(<Probe />);
    const snapshot = snapshotForBuiltin("ember");

    act(() => setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot }));

    expect(screen.getByText("snapshot")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!)).toEqual({ schemaVersion: 1, mode: "snapshot", snapshot });
    const published = seen.at(-1);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published?.mode === "snapshot" ? published.snapshot : null)).toBe(true);
  });

  it("leaves the prior appearance unpublished when storage rejects the write", async () => {
    const { setDeviceAppearance, useAppearance } = await loadStore();
    function Probe() {
      return <output>{useAppearance().mode}</output>;
    }
    render(<Probe />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(() => setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("ember") })).toThrow(
      "Unable to save appearance",
    );
    expect(screen.getByText("system")).toBeTruthy();
  });

  it("follows storage events with bounded validation and does not clean up invalid data", async () => {
    const { useAppearance } = await loadStore();
    function Probe() {
      return <output>{useAppearance().mode}</output>;
    }
    render(<Probe />);
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    localStorage.setItem(APPEARANCE_KEY, "not json");

    act(() => window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_KEY, storageArea: localStorage })));

    expect(screen.getByText("system")).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();

    const snapshot = snapshotForBuiltin("daylight");
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ schemaVersion: 1, mode: "snapshot", snapshot }));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_KEY, storageArea: localStorage })));
    expect(screen.getByText("snapshot")).toBeTruthy();
  });

  it("attaches one storage listener while subscribed and removes it after the final subscriber", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { useAppearance } = await loadStore();
    function Probe() {
      useAppearance();
      return null;
    }

    const first = render(<Probe />);
    const second = render(<Probe />);
    expect(add.mock.calls.filter(([type]) => type === "storage")).toHaveLength(1);
    first.unmount();
    expect(remove.mock.calls.filter(([type]) => type === "storage")).toHaveLength(0);
    second.unmount();
    expect(remove.mock.calls.filter(([type]) => type === "storage")).toHaveLength(1);
  });
});
