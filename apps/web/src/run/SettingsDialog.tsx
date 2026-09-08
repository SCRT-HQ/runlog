import { useEffect, useRef, useState } from "react";
import { AlertsPanel } from "../alerts/AlertsPanel.tsx";
import type { AlertSettings } from "../alerts/settings.ts";
import { Dice3dSwitch } from "../dice/Dice3dSwitch.tsx";
import { carriesOnByItself, setCarriesOnByItself } from "./pace.ts";
import { StreamSettings } from "./StreamPanel.tsx";

/**
 * What is about this device rather than about the run: the sounds, the
 * dice, and the pop-outs for a stream. None of it belongs beside the
 * board, where it sat as two folded headings with air around them; it is
 * one dialog behind one button, opened when wanted and gone when not.
 */
export function SettingsDialog({
  runId,
  race,
  alerts,
  onAlerts,
  rolling,
  onControls,
  onClose,
}: {
  runId: string | null;
  race: boolean;
  alerts: AlertSettings;
  onAlerts: (next: AlertSettings) => void;
  /** Who throws the dice in this run, and whether the run leaves any choice. */
  rolling?: { auto: boolean; seeded: boolean; onAuto: (on: boolean) => void };
  /** Float the run's controls in a window of their own. */
  onControls?: () => void;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const [carryOn, setCarryOn] = useState(carriesOnByItself);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="veil" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="panel settingsDialog" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <div className="dialogBar">
          <h2 id="settingsTitle">Settings</h2>
          <button ref={close} className="ghost tiny" onClick={onClose}>
            Close
          </button>
        </div>

        <section>
          <h3 className="sectionTitle">
            Alerts <span className="muted">and sounds</span>
          </h3>
          <AlertsPanel settings={alerts} onChange={onAlerts} />
          <Dice3dSwitch />
        </section>

        <section>
          <h3 className="sectionTitle">
            Rolls <span className="muted">whose dice, and how fast</span>
          </h3>
          {rolling &&
            (rolling.seeded ? (
              <p className="muted small">This run rolls from its seed, so everyone at it meets the same dice.</p>
            ) : (
              <label className="toggle" title="Off by default: the dice are yours">
                <input type="checkbox" checked={rolling.auto} onChange={(e) => rolling.onAuto(e.target.checked)} />
                <span>Roll for me, without asking</span>
              </label>
            ))}
          <label className="toggle" title="A receipt shows what a roll did; by default it waits for Carry on">
            <input
              type="checkbox"
              checked={carryOn}
              onChange={(e) => {
                setCarriesOnByItself(e.target.checked);
                setCarryOn(e.target.checked);
              }}
            />
            <span>After a roll, carry on by itself</span>
          </label>
        </section>

        {runId && (
          <section>
            <h3 className="sectionTitle">
              Stream <span className="muted">pop-out widgets</span>
            </h3>
            <StreamSettings runId={runId} race={race} onControls={onControls} />
          </section>
        )}
      </section>
    </div>
  );
}
