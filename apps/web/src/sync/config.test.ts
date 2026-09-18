// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setSyncEnabled, syncEnabled } from "./config.ts";

afterEach(() => localStorage.clear());

describe("the device sync preference", () => {
  it("defaults to on and treats only an explicit off choice as off", () => {
    expect(syncEnabled()).toBe(true);

    localStorage.setItem("runlog:sync", "on");
    expect(syncEnabled()).toBe(true);

    localStorage.setItem("runlog:sync", "off");
    expect(syncEnabled()).toBe(false);
  });

  it("persists off and restores the default by removing that choice", () => {
    setSyncEnabled(false);
    expect(localStorage.getItem("runlog:sync")).toBe("off");
    expect(syncEnabled()).toBe(false);

    setSyncEnabled(true);
    expect(localStorage.getItem("runlog:sync")).toBeNull();
    expect(syncEnabled()).toBe(true);
  });
});
