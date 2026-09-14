import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERTS } from "../alerts/settings.ts";
import { SettingsDialog } from "./SettingsDialog.tsx";

/**
 * The sheet at first paint: what this device's choices are, and which
 * other tabs there are to go to. Static markup, so nothing is read from
 * storage that a test process does not have.
 */
const sheet = (runId: string | null, rolling?: { auto: boolean; seeded: boolean; onAuto: () => void }) =>
  renderToStaticMarkup(
    <SettingsDialog
      runId={runId}
      race={false}
      alerts={DEFAULT_ALERTS}
      onAlerts={() => {}}
      onClose={() => {}}
      {...(rolling ? { rolling } : {})}
    />,
  );

describe("the settings sheet", () => {
  it("holds every choice about this device on one tab, the theme excepted", () => {
    const html = sheet("run-1", { auto: false, seeded: false, onAuto: () => {} });
    expect(html).toContain("This device");
    expect(html).toContain("Widgets");
    expect(html).toContain("Alerts");
    expect(html).toContain("Roll for me, without asking");
    expect(html).toContain("carry on by itself");
    expect(html).toContain("Esc");
    // The theme moved to the account menu, where trying one does not mean
    // opening and shutting a dialog to see what it did.
    expect(html).not.toContain("Theme");
  });

  it("has no widgets tab outside a run, since the widgets follow one", () => {
    const html = sheet(null);
    expect(html).not.toContain("Widgets");
    expect(html).toContain("Roll for me, without asking");
  });

  it("offers chat and control only where there is a pack to write them against", () => {
    // No pack and no record here, so those two tabs have nothing to show
    // and are not offered; the widgets follow the run and are.
    const html = sheet("run-1");
    expect(html).toContain("Widgets");
    expect(html).not.toContain(">Chat<");
    expect(html).not.toContain(">Control<");
  });

  it("offers no choice of dice in a seeded run", () => {
    const html = sheet("run-1", { auto: false, seeded: true, onAuto: () => {} });
    expect(html).toContain("rolls from its seed");
    expect(html).not.toContain("Roll for me, without asking");
  });
});
