import { useEffect, useRef } from "react";
import { AlertsPanel } from "../alerts/AlertsPanel.tsx";
import type { AlertSettings } from "../alerts/settings.ts";
import { Dice3dSwitch } from "../dice/Dice3dSwitch.tsx";
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
  onControls,
  onClose,
}: {
  runId: string | null;
  race: boolean;
  alerts: AlertSettings;
  onAlerts: (next: AlertSettings) => void;
  /** Float the run's controls in a window of their own. */
  onControls?: () => void;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
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
