import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askedNotTo, beaconBody, countView, resetCount } from "./beacon.ts";

/**
 * What the beacon may and may not do: only on a hosted copy, only where
 * there is an API, never against the browser's wish, never twice for one
 * stay, and never anything but the screen's family and the app's version.
 */
describe("the count", () => {
  beforeEach(() => {
    resetCount();
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_01TEST");
    const location = { protocol: "https:", href: "https://runlog.example.com/play" };
    vi.stubGlobal("location", location);
    vi.stubGlobal("window", { location });
    vi.stubGlobal("navigator", { doNotTrack: "0" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("says the screen and the version, and nothing about anyone", () => {
    expect(JSON.parse(beaconBody("play", "0.1.0"))).toEqual({ t: "view", screen: "play", v: "0.1.0" });
  });

  it("sends once per screen, to the API beside the app, on a hosted copy", () => {
    const sent: string[] = [];
    const send = (url: string, body: string) => {
      sent.push(`${url} ${body}`);
      return true;
    };
    expect(countView("library", { hosted: true, version: "0.1.0", send })).toBe(true);
    expect(countView("library", { hosted: true, version: "0.1.0", send })).toBe(false);
    expect(countView("play", { hosted: true, version: "0.1.0", send })).toBe(true);
    expect(sent).toEqual([
      'https://runlog.example.com/api/beacon {"t":"view","screen":"library","v":"0.1.0"}',
      'https://runlog.example.com/api/beacon {"t":"view","screen":"play","v":"0.1.0"}',
    ]);
  });

  it("sends nothing from a copy that is not hosted", () => {
    const send = vi.fn(() => true);
    expect(countView("library", { hosted: false, version: "0.1.0", send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("respects Do Not Track and Global Privacy Control", () => {
    expect(askedNotTo({ doNotTrack: "1" })).toBe(true);
    expect(askedNotTo({ globalPrivacyControl: true })).toBe(true);
    expect(askedNotTo({ doNotTrack: "0" })).toBe(false);
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    const send = vi.fn(() => true);
    expect(countView("library", { hosted: true, version: "0.1.0", send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
