// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERTS } from "../alerts/settings.ts";
import { DeviceSettings } from "./DeviceSettings.tsx";

/**
 * The pane outside a run, on Profile, Settings: the same component the
 * run's Settings dialog opens on its `This device` tab, with no `rolling`
 * passed in because there is no run to be about. What matters here is
 * that it still says what it applies to, and that nothing about a run
 * shows up on it when there is none.
 */
describe("device settings outside a run", () => {
  it("says it applies on this device, in every run", () => {
    const html = renderToStaticMarkup(<DeviceSettings alerts={DEFAULT_ALERTS} onAlerts={() => {}} />);
    expect(html).toContain("Applies on this device, in every run.");
  });

  it("shows no run-scoped control: the roll switch is plain and enabled, and there is no seeded sentence", () => {
    const html = renderToStaticMarkup(<DeviceSettings alerts={DEFAULT_ALERTS} onAlerts={() => {}} />);
    expect(html).toContain("Roll for me, without asking");
    expect(html).not.toContain("rolls from its seed");
    const rollSwitch = /<input type="checkbox"([^>]*)\/>\s*<span>Roll for me, without asking<\/span>/.exec(html)?.[1] ?? "";
    expect(rollSwitch).not.toContain("disabled");
    expect(html).toContain("After a roll, carry on by itself");
  });
});
