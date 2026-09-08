import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERTS } from "../alerts/settings.ts";
import { SettingsDialog } from "./SettingsDialog.tsx";

/**
 * The sheet at first paint: what this device's choices are, and where the
 * streaming setup went. Static markup, so nothing is read from storage that
 * a test process does not have.
 */
const sheet = (runId: string | null, rolling?: { auto: boolean; seeded: boolean; onAuto: () => void }) =>
  renderToStaticMarkup(<SettingsDialog runId={runId} race={false} alerts={DEFAULT_ALERTS} onAlerts={() => {}} onClose={() => {}} {...(rolling ? { rolling } : {})} />);

describe("the settings sheet", () => {
  it("holds every choice about this device on one tab, with the theme among them", () => {
    const html = sheet("run-1", { auto: false, seeded: false, onAuto: () => {} });
    expect(html).toContain("This device");
    expect(html).toContain("Streaming");
    expect(html).toContain("Theme");
    expect(html).toContain("Alerts");
    expect(html).toContain("Roll for me, without asking");
    expect(html).toContain("carry on by itself");
    expect(html).toContain("Esc");
  });

  it("has no streaming tab outside a run, since the widgets follow one", () => {
    const html = sheet(null);
    expect(html).not.toContain("Streaming");
    expect(html).toContain("Roll for me, without asking");
  });

  it("offers no choice of dice in a seeded run", () => {
    const html = sheet("run-1", { auto: false, seeded: true, onAuto: () => {} });
    expect(html).toContain("rolls from its seed");
    expect(html).not.toContain("Roll for me, without asking");
  });
});
